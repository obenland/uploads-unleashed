/**
 * TUS Resumable Uploader for WordPress
 *
 * @package
 */

import * as tus from 'tus-js-client';

/**
 * Upload expiration time in milliseconds (24 hours).
 * Matches DAY_IN_SECONDS on the server side.
 */
const UPLOAD_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/**
 * Custom URL storage that embeds expiration timestamp in localStorage keys.
 * Key format: tus::{fingerprint}::{expiresAt}::{id}
 */
class ExpiringUrlStorage {
	addUpload(
		uploadFingerprint: string,
		upload: tus.PreviousUpload
	): Promise< string > {
		const id = Math.round( Math.random() * 1e12 );
		const expiresAt = Date.now() + UPLOAD_EXPIRATION_MS;
		const key = `tus::${ uploadFingerprint }::${ expiresAt }::${ id }`;
		localStorage.setItem( key, JSON.stringify( upload ) );
		return Promise.resolve( key );
	}

	findUploadsByFingerprint(
		uploadFingerprint: string
	): Promise< tus.PreviousUpload[] > {
		return Promise.resolve(
			this._findEntries( `tus::${ uploadFingerprint }::` )
		);
	}

	findAllUploads(): Promise< tus.PreviousUpload[] > {
		return Promise.resolve( this._findEntries( 'tus::' ) );
	}

	removeUpload( urlStorageKey: string ): Promise< void > {
		localStorage.removeItem( urlStorageKey );
		return Promise.resolve();
	}

	_findEntries( prefix: string ): tus.PreviousUpload[] {
		const results: tus.PreviousUpload[] = [];
		// Iterate backwards to safely remove items during iteration
		for ( let i = localStorage.length - 1; i >= 0; i-- ) {
			const key = localStorage.key( i );
			if ( ! key?.startsWith( prefix ) ) {
				continue;
			}

			// Parse expiration from key: tus::{fingerprint}::{expiresAt}::{id}
			const parts = key.split( '::' );
			if ( parts.length < 4 ) {
				// Clean up malformed entries with unexpected key format
				localStorage.removeItem( key );
				continue;
			}
			const expiresAt = parseInt( parts[ 2 ], 10 );

			// Skip and clean up expired or invalid entries
			if ( isNaN( expiresAt ) || Date.now() > expiresAt ) {
				localStorage.removeItem( key );
				continue;
			}

			try {
				const upload = JSON.parse(
					localStorage.getItem( key ) || ''
				) as tus.PreviousUpload;
				upload.urlStorageKey = key;
				results.push( upload );
			} catch {
				// Clean up malformed JSON entries
				localStorage.removeItem( key );
			}
		}
		return results;
	}
}

declare global {
	interface Window {
		resumableUploads?: {
			endpoint: string;
			nonce: string;
		};
	}
}

/**
 * Attachment data in REST API format (from WP_REST_Attachments_Controller).
 */
export interface AttachmentData {
	id: number;
	date: string;
	date_gmt: string;
	modified: string;
	modified_gmt: string;
	slug: string;
	status: string;
	type: string;
	link: string;
	title: { raw: string; rendered: string };
	author: number;
	caption: { raw: string; rendered: string };
	alt_text: string;
	media_type: string;
	mime_type: string;
	source_url: string;
	media_details: {
		width?: number;
		height?: number;
		file?: string;
		sizes?: Record<
			string,
			{ source_url: string; width: number; height: number }
		>;
		[ key: string ]: unknown;
	};
	[ key: string ]: unknown;
}

export interface UploadOptions {
	onProgress?: (
		percentage: string,
		bytesUploaded: number,
		bytesTotal: number
	) => void;
	onSuccess?: (
		attachment: AttachmentData | null,
		upload: tus.Upload
	) => void;
	onError?: ( error: Error | tus.DetailedError ) => void;
	chunkSize?: number;
	retryDelays?: number[];
	removeFingerprintOnSuccess?: boolean;
}

export interface UploadResult {
	attachment: AttachmentData | null;
	upload: tus.Upload;
}

/**
 * Generates a fingerprint for resumable uploads.
 *
 * Uses pipe delimiter since it's invalid in filenames on Windows/Mac
 * and won't conflict with the :: delimiter tus-js-client uses for
 * localStorage keys.
 *
 * @param file    The file being uploaded.
 * @param options TUS upload options.
 * @return Fingerprint string.
 */
function fingerprint(
	file: File,
	options: tus.UploadOptions
): Promise< string > {
	return Promise.resolve(
		[
			'tus-br',
			encodeURIComponent( file.name ),
			file.size,
			file.lastModified,
			options.endpoint,
		].join( '|' )
	);
}

/**
 * Default options for the TUS uploader.
 */
const DEFAULT_OPTIONS: Partial< tus.UploadOptions > = {
	chunkSize: 5 * 1024 * 1024, // 5MB chunks
	retryDelays: [ 0, 1000, 3000, 5000, 10000 ],
	removeFingerprintOnSuccess: true,
	fingerprint,
	urlStorage: new ExpiringUrlStorage(),
};

/**
 * Creates a TUS upload for a file.
 * @param file
 * @param options
 */
export function createUpload(
	file: File,
	options: UploadOptions = {}
): tus.Upload {
	const {
		onProgress = () => {},
		onSuccess = () => {},
		onError = () => {},
		...tusOptions
	} = options;

	const upload = new tus.Upload( file, {
		...DEFAULT_OPTIONS,
		...tusOptions,
		endpoint:
			window.resumableUploads?.endpoint || '/wp-json/wp/v2/media/tus',
		headers: {
			'X-WP-Nonce': window.resumableUploads?.nonce || '',
		},
		metadata: {
			filename: file.name,
			filetype: file.type || 'application/octet-stream',
		},
		onProgress: ( bytesUploaded: number, bytesTotal: number ) => {
			const percentage = ( ( bytesUploaded / bytesTotal ) * 100 ).toFixed(
				2
			);
			onProgress( percentage, bytesUploaded, bytesTotal );
		},
		onSuccess: ( payload ) => {
			const status = payload.lastResponse.getStatus();
			const body = payload.lastResponse.getBody();

			// Check if the server returned an error status.
			if ( status >= 400 ) {
				let errorMessage = 'Upload failed';
				try {
					if ( body ) {
						const parsed = JSON.parse( body );
						errorMessage = parsed.message || errorMessage;
					}
				} catch {
					// Ignore parse errors
				}
				onError( new Error( errorMessage ) );
				return;
			}

			// Parse attachment data from response body.
			let attachment: AttachmentData | null = null;
			try {
				if ( body ) {
					attachment = JSON.parse( body ) as AttachmentData;
				}
			} catch {
				// Ignore parse errors
			}

			onSuccess( attachment, upload );
		},
		onError: ( error: Error | tus.DetailedError ) => {
			// Extract a clean error message from TUS errors
			let cleanMessage = error.message || 'Upload failed';

			// Try to extract WordPress error message from response body
			if ( 'originalResponse' in error && error.originalResponse ) {
				try {
					const body = error.originalResponse.getBody();
					if ( body ) {
						const parsed = JSON.parse( body );
						if ( parsed.message ) {
							cleanMessage = parsed.message;
						}
					}
				} catch {
					// Ignore parse errors
				}
			}

			onError( new Error( cleanMessage ) );
		},
	} );

	return upload;
}

/**
 * Uploads a file using TUS protocol.
 * @param file
 * @param options
 */
export function uploadFile(
	file: File,
	options: UploadOptions = {}
): Promise< UploadResult > {
	return new Promise( ( resolve, reject ) => {
		const upload = createUpload( file, {
			...options,
			onSuccess: ( attachment, uploadInstance ) => {
				if ( options.onSuccess ) {
					options.onSuccess( attachment, uploadInstance );
				}
				resolve( { attachment, upload: uploadInstance } );
			},
			onError: ( error ) => {
				if ( options.onError ) {
					options.onError( error );
				}
				reject( error );
			},
		} );

		// Check for previous uploads to resume.
		upload.findPreviousUploads().then( ( previousUploads ) => {
			if ( previousUploads.length > 0 ) {
				// Resume the most recent upload.
				upload.resumeFromPreviousUpload( previousUploads[ 0 ] );
			}
			upload.start();
		} );
	} );
}

/**
 * Aborts an upload.
 * @param upload
 */
export function abortUpload( upload: tus.Upload ): Promise< void > {
	return upload.abort( true );
}

// Export tus for advanced usage.
export { tus };

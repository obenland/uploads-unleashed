/**
 * TUS Resumable Uploader for WordPress
 *
 * @package resumable-uploader
 */

import * as tus from 'tus-js-client';

declare global {
	interface Window {
		resumableUploads?: {
			endpoint: string;
			nonce: string;
		};
	}
}

export interface UploadOptions {
	onProgress?: (
		percentage: string,
		bytesUploaded: number,
		bytesTotal: number
	) => void;
	onSuccess?: ( attachmentId: number | null, upload: tus.Upload ) => void;
	onError?: ( error: Error | tus.DetailedError ) => void;
	chunkSize?: number;
	retryDelays?: number[];
	removeFingerprintOnSuccess?: boolean;
}

export interface UploadResult {
	attachmentId: number | null;
	upload: tus.Upload;
}

/**
 * Default options for the TUS uploader.
 */
const DEFAULT_OPTIONS: Partial< tus.UploadOptions > = {
	chunkSize: 5 * 1024 * 1024, // 5MB chunks
	retryDelays: [ 0, 1000, 3000, 5000 ],
	removeFingerprintOnSuccess: true,
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
			// Extract attachment ID from response header.
			const attachmentId = payload.lastResponse.getHeader(
				'X-WP-Upload-Attachment-ID'
			);
			onSuccess(
				attachmentId ? parseInt( attachmentId, 10 ) : null,
				upload
			);
		},
		onError,
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
			onSuccess: ( attachmentId, uploadInstance ) => {
				if ( options.onSuccess ) {
					options.onSuccess( attachmentId, uploadInstance );
				}
				resolve( { attachmentId, upload: uploadInstance } );
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

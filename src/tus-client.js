/**
 * TUS Client for WordPress
 *
 * Clean API for resumable file uploads using the TUS protocol.
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
 * Get the TUS endpoint URL.
 *
 * @return {string} TUS endpoint URL.
 */
function getEndpoint() {
	return window.uploadsUnleashed?.endpoint || '/wp-json/wp/v2/media';
}

/**
 * Get the WordPress nonce for authentication.
 *
 * @return {string} WordPress REST nonce.
 */
function getNonce() {
	return window.uploadsUnleashed?.nonce || '';
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Custom URL storage that embeds expiration timestamp in localStorage keys.
 * Key format: tus::{fingerprint}::{expiresAt}::{id}
 */
class ExpiringUrlStorage {
	addUpload( uploadFingerprint, previousUpload ) {
		const id = Math.round( Math.random() * 1e12 );
		const expiresAt = Date.now() + UPLOAD_EXPIRATION_MS;
		const key = `tus::${ uploadFingerprint }::${ expiresAt }::${ id }`;
		localStorage.setItem( key, JSON.stringify( previousUpload ) );
		return Promise.resolve( key );
	}

	findUploadsByFingerprint( uploadFingerprint ) {
		return Promise.resolve(
			this._findEntries( `tus::${ uploadFingerprint }::` )
		);
	}

	findAllUploads() {
		return Promise.resolve( this._findEntries( 'tus::' ) );
	}

	removeUpload( urlStorageKey ) {
		localStorage.removeItem( urlStorageKey );
		return Promise.resolve();
	}

	_findEntries( prefix ) {
		const results = [];
		// Iterate backwards to safely remove items during iteration
		for ( let i = localStorage.length - 1; i >= 0; i-- ) {
			const key = localStorage.key( i );
			if ( ! key?.startsWith( prefix ) ) {
				continue;
			}

			// Parse expiration from key: tus::{fingerprint}::{expiresAt}::{id}
			const parts = key.split( '::' );
			if ( parts.length < 4 ) {
				// Clean up malformed entries
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
				const storedUpload = JSON.parse(
					localStorage.getItem( key ) || ''
				);
				storedUpload.urlStorageKey = key;
				results.push( storedUpload );
			} catch {
				// Clean up malformed JSON entries
				localStorage.removeItem( key );
			}
		}
		return results;
	}
}

const urlStorage = new ExpiringUrlStorage();

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Generates a fingerprint for resumable uploads.
 *
 * @param {File}   file    The file to fingerprint.
 * @param {Object} options TUS upload options.
 * @return {Promise<string>} Fingerprint string.
 */
function fingerprint( file, options ) {
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
const DEFAULT_TUS_OPTIONS = {
	chunkSize: 5 * 1024 * 1024, // 5MB chunks
	retryDelays: [ 0, 1000, 3000, 5000, 10000 ],
	removeFingerprintOnSuccess: true,
	fingerprint,
	urlStorage,
};

/**
 * Creates a raw TUS upload instance.
 * For internal use - prefer upload() for the public API.
 *
 * @param {File}     file                   The file to upload.
 * @param {Object}   callbacks              Callback functions.
 * @param {Function} [callbacks.onProgress] Progress callback.
 * @param {Function} callbacks.onSuccess    Success callback.
 * @param {Function} callbacks.onError      Error callback.
 * @return {tus.Upload} TUS upload instance.
 */
function createTusUpload( file, callbacks ) {
	return new tus.Upload( file, {
		...DEFAULT_TUS_OPTIONS,
		endpoint: getEndpoint(),
		headers: {
			'X-WP-Nonce': getNonce(),
		},
		metadata: {
			filename: file.name,
			filetype: file.type || 'application/octet-stream',
		},
		onProgress: ( bytesUploaded, bytesTotal ) => {
			const percent = ( bytesUploaded / bytesTotal ) * 100;
			callbacks.onProgress?.( percent, bytesUploaded, bytesTotal );
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
				callbacks.onError( new Error( errorMessage ) );
				return;
			}

			// Parse attachment data from response body.
			let attachment = null;
			try {
				if ( body ) {
					attachment = JSON.parse( body );
				}
			} catch {
				// Ignore parse errors
			}

			callbacks.onSuccess( attachment );
		},
		onError: ( error ) => {
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

			callbacks.onError( new Error( cleanMessage ) );
		},
	} );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Upload a file using the TUS protocol with automatic resume.
 *
 * This is the main entry point for uploading files. It handles:
 * - Chunked upload via TUS protocol.
 * - Automatic resume of interrupted uploads.
 * - Progress callbacks.
 * - AbortSignal for cancellation.
 *
 * @param {File}        file                 The file to upload.
 * @param {Object}      [options]            Upload options.
 * @param {Function}    [options.onProgress] Progress callback (percent, bytesUploaded, bytesTotal).
 * @param {AbortSignal} [options.signal]     AbortSignal for cancellation.
 * @return {Promise<Object>} Resolves with WordPress attachment data.
 *
 * @example
 * ```js
 * const attachment = await upload( file, {
 *   onProgress: ( percent, loaded, total ) => {
 *     console.log( `${percent.toFixed(0)}% uploaded` );
 *   }
 * });
 * console.log( 'Uploaded:', attachment.id );
 * ```
 */
export async function upload( file, options = {} ) {
	return new Promise( ( resolve, reject ) => {
		// Handle already-aborted signal before creating upload
		if ( options.signal?.aborted ) {
			reject( new Error( 'Upload aborted' ) );
			return;
		}

		let settled = false;

		const tusUpload = createTusUpload( file, {
			onProgress: options.onProgress,
			onSuccess: ( attachment ) => {
				if ( settled ) {
					return;
				}
				settled = true;
				if ( attachment ) {
					resolve( attachment );
				} else {
					reject(
						new Error(
							'Upload completed but no attachment data received'
						)
					);
				}
			},
			onError: ( error ) => {
				if ( settled ) {
					return;
				}
				settled = true;
				reject( error );
			},
		} );

		// Handle AbortSignal
		if ( options.signal ) {
			options.signal.addEventListener( 'abort', () => {
				if ( ! settled ) {
					settled = true;
					tusUpload.abort( true );
					reject( new Error( 'Upload aborted' ) );
				}
			} );
		}

		// Check for previous uploads to resume
		tusUpload.findPreviousUploads().then( ( previousUploads ) => {
			if ( previousUploads.length > 0 ) {
				tusUpload.resumeFromPreviousUpload( previousUploads[ 0 ] );
			}
			tusUpload.start();
		} );
	} );
}

/**
 * Abort an in-progress upload and clean up storage.
 *
 * @param {tus.Upload} tusUpload The TUS upload instance to abort.
 * @return {Promise<void>}
 */
export function abort( tusUpload ) {
	return tusUpload.abort( true );
}

/**
 * Get all pending (resumable) uploads from localStorage.
 *
 * Returns uploads that match the current TUS endpoint and haven't expired.
 * Use this to display a "Resume upload" UI to users.
 *
 * @return {Array<Object>} Array of pending upload objects with key, uploadUrl, filename, size.
 */
export function getPendingUploads() {
	const endpoint = getEndpoint();
	const pending = [];

	// Iterate backwards to safely remove items during iteration
	for ( let i = localStorage.length - 1; i >= 0; i-- ) {
		const key = localStorage.key( i );
		if ( ! key?.startsWith( 'tus::tus-br|' ) ) {
			continue;
		}
		if ( ! key.includes( endpoint ) ) {
			continue;
		}

		try {
			// Parse key: tus::{fingerprint}::{expiresAt}::{id}
			const keyParts = key.split( '::' );
			if ( keyParts.length < 4 ) {
				localStorage.removeItem( key );
				continue;
			}

			// Check expiration
			const expiresAt = parseInt( keyParts[ 2 ], 10 );
			if ( isNaN( expiresAt ) || Date.now() > expiresAt ) {
				localStorage.removeItem( key );
				continue;
			}

			const data = JSON.parse( localStorage.getItem( key ) || '' );

			// Parse fingerprint: tus-br|{filename}|{size}|{lastModified}|{endpoint}
			const fingerprintParts = keyParts[ 1 ].split( '|' );
			if ( fingerprintParts.length !== 5 ) {
				localStorage.removeItem( key );
				continue;
			}

			pending.push( {
				key,
				uploadUrl: data.uploadUrl,
				filename: decodeURIComponent( fingerprintParts[ 1 ] ),
				size: parseInt( fingerprintParts[ 2 ], 10 ),
			} );
		} catch {
			// Clean up malformed entries
			localStorage.removeItem( key );
		}
	}

	return pending;
}

/**
 * Discard a pending upload.
 *
 * Cancels the server-side upload session and removes from localStorage.
 *
 * @param {Object} pendingUpload           The pending upload to discard (from getPendingUploads).
 * @param {string} pendingUpload.key       LocalStorage key.
 * @param {string} pendingUpload.uploadUrl TUS upload URL.
 */
export async function discardPendingUpload( pendingUpload ) {
	// Cancel server-side session
	try {
		await fetch( pendingUpload.uploadUrl, {
			method: 'DELETE',
			headers: { 'X-WP-Nonce': getNonce() },
		} );
	} catch {
		// Ignore errors - session may already be expired
	}

	// Remove from localStorage
	localStorage.removeItem( pendingUpload.key );
}

/**
 * Remove a pending upload entry by localStorage key.
 *
 * @param {string} key LocalStorage key to remove.
 */
export function removePendingUploadByKey( key ) {
	localStorage.removeItem( key );
}

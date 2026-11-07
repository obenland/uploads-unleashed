/**
 * TUS Client for WordPress
 *
 * Clean API for resumable file uploads using the TUS protocol.
 *
 * @package
 */

import * as tus from 'tus-js-client';
import { addFilter } from '@wordpress/hooks';

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

/**
 * Get the ID of the current site, to scope stored uploads to it.
 *
 * @since 1.2.0
 *
 * @return {string} Blog ID.
 */
function getBlogId() {
	return String( window.uploadsUnleashed?.blogId ?? '' );
}

/**
 * Get the ID of the current user, to scope stored uploads to them.
 *
 * @since 1.2.0
 *
 * @return {string} User ID.
 */
function getUserId() {
	return String( window.uploadsUnleashed?.userId ?? '' );
}

// ============================================================================
// Storage
// ============================================================================

/**
 * localStorage access that never throws.
 *
 * Storage can be full or blocked by the browser. Uploads still work then,
 * they just can't be resumed.
 *
 * @since 1.2.0
 */
const storage = {
	/**
	 * Reads a value.
	 *
	 * @since 1.2.0
	 *
	 * @param {string} key Storage key.
	 * @return {string|null} The value, or null if absent or unreadable.
	 */
	get( key ) {
		try {
			return window.localStorage.getItem( key );
		} catch {
			return null;
		}
	},

	/**
	 * Writes a value.
	 *
	 * @since 1.2.0
	 *
	 * @param {string} key   Storage key.
	 * @param {string} value The value.
	 * @return {boolean} Whether the value was stored.
	 */
	set( key, value ) {
		try {
			window.localStorage.setItem( key, value );
			return true;
		} catch {
			return false;
		}
	},

	/**
	 * Removes a value.
	 *
	 * @since 1.2.0
	 *
	 * @param {string} key Storage key.
	 */
	remove( key ) {
		try {
			window.localStorage.removeItem( key );
		} catch {
			// Storage is blocked, so there is nothing to remove.
		}
	},

	/**
	 * Lists all keys, as a snapshot that's safe to remove keys while iterating.
	 *
	 * @since 1.2.0
	 *
	 * @return {Array<string>} Storage keys.
	 */
	keys() {
		try {
			const keys = [];
			for ( let i = 0; i < window.localStorage.length; i++ ) {
				keys.push( window.localStorage.key( i ) );
			}
			return keys;
		} catch {
			return [];
		}
	},
};

/**
 * Removes a stored upload together with its progress.
 *
 * @since 1.2.0
 *
 * @param {string} key The localStorage key of the upload.
 */
function removeStoredUpload( key ) {
	try {
		const { uploadUrl } = JSON.parse( storage.get( key ) || '' );
		if ( uploadUrl ) {
			removeUploadProgress( uploadUrl );
		}
	} catch {
		// Malformed entries have no progress to remove.
	}

	storage.remove( key );
}

/**
 * TUS URL storage that embeds expiration timestamp in localStorage keys.
 *
 * Key format: tus::{fingerprint}::{expiresAt}::{id}
 */
class ExpiringUrlStorage {
	/**
	 * Stores upload state in localStorage with expiration metadata.
	 *
	 * @param {string} uploadFingerprint Unique identifier for the file.
	 * @param {Object} previousUpload    Upload state to persist.
	 * @return {Promise<string|null>} The localStorage key, or null if storage is unavailable.
	 */
	addUpload( uploadFingerprint, previousUpload ) {
		const id = Math.round( Math.random() * 1e12 );
		const expiresAt = Date.now() + UPLOAD_EXPIRATION_MS;
		const key = `tus::${ uploadFingerprint }::${ expiresAt }::${ id }`;

		// Without storage, tus uploads the file without remembering it for resuming.
		const stored = storage.set( key, JSON.stringify( previousUpload ) );

		return Promise.resolve( stored ? key : null );
	}

	/**
	 * Finds stored uploads matching a fingerprint.
	 *
	 * @param {string} uploadFingerprint Fingerprint to search for.
	 * @return {Promise<Array>} Matching upload entries.
	 */
	findUploadsByFingerprint( uploadFingerprint ) {
		return Promise.resolve(
			this._findEntries( `tus::${ uploadFingerprint }::` )
		);
	}

	/**
	 * Returns all stored uploads.
	 *
	 * @return {Promise<Array>} All upload entries.
	 */
	findAllUploads() {
		return Promise.resolve( this._findEntries( 'tus::' ) );
	}

	/**
	 * Removes an upload entry from storage.
	 *
	 * @param {string} urlStorageKey The localStorage key to remove.
	 * @return {Promise<void>}
	 */
	removeUpload( urlStorageKey ) {
		removeStoredUpload( urlStorageKey );

		return Promise.resolve();
	}

	/**
	 * Finds entries by key prefix, cleaning up expired/malformed entries.
	 *
	 * @param {string} prefix Key prefix to match.
	 * @return {Array} Valid upload entries.
	 */
	_findEntries( prefix ) {
		const results = [];

		for ( const key of storage.keys() ) {
			if ( ! key?.startsWith( prefix ) ) {
				continue;
			}

			// Parse expiration from key: tus::{fingerprint}::{expiresAt}::{id}
			const parts = key.split( '::' );
			if ( parts.length < 4 ) {
				// Clean up malformed entries
				removeStoredUpload( key );
				continue;
			}
			const expiresAt = parseInt( parts[ 2 ], 10 );

			// Skip and clean up expired or invalid entries
			if ( isNaN( expiresAt ) || Date.now() > expiresAt ) {
				removeStoredUpload( key );
				continue;
			}

			try {
				const storedUpload = JSON.parse( storage.get( key ) || '' );
				storedUpload.urlStorageKey = key;
				results.push( storedUpload );
			} catch {
				// Clean up malformed JSON entries
				storage.remove( key );
			}
		}

		return results;
	}
}

// ============================================================================
// Progress Storage
// ============================================================================

/**
 * Saves upload progress to localStorage.
 *
 * @param {string} uploadUrl     The TUS upload URL.
 * @param {number} bytesUploaded Bytes uploaded so far.
 */
function saveUploadProgress( uploadUrl, bytesUploaded ) {
	// Progress display is non-critical, so a full or blocked storage is fine.
	storage.set( `tus-progress::${ uploadUrl }`, bytesUploaded );
}

/**
 * Reads upload progress from localStorage.
 *
 * @param {string} uploadUrl The TUS upload URL.
 * @return {number} Bytes uploaded, or 0 if absent.
 */
function getUploadProgress( uploadUrl ) {
	return parseInt( storage.get( `tus-progress::${ uploadUrl }` ), 10 ) || 0;
}

/**
 * Removes upload progress from localStorage.
 *
 * @param {string} uploadUrl The TUS upload URL.
 */
function removeUploadProgress( uploadUrl ) {
	storage.remove( `tus-progress::${ uploadUrl }` );
}

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Generates a fingerprint for resumable uploads.
 *
 * Includes the site and user, so another user of the same browser can't see
 * or resume the upload.
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
			getBlogId(),
			getUserId(),
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
	urlStorage: new ExpiringUrlStorage(),
};

/**
 * Creates a raw TUS upload instance.
 * For internal use - prefer upload() for the public API.
 *
 * @param {File}                                                                 file                   The file to upload.
 * @param {Object}                                                               callbacks              Callback functions.
 * @param {(percent: number, bytesUploaded: number, bytesTotal: number) => void} [callbacks.onProgress] Progress callback.
 * @param {(attachment: Object|null) => void}                                    callbacks.onSuccess    Success callback.
 * @param {(error: Error) => void}                                               callbacks.onError      Error callback.
 * @return {tus.Upload} TUS upload instance.
 */
function createTusUpload( file, callbacks ) {
	const tusUpload = new tus.Upload( file, {
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
			if ( tusUpload.url ) {
				saveUploadProgress( tusUpload.url, bytesUploaded );
			}
			const percent = ( bytesUploaded / bytesTotal ) * 100;
			callbacks.onProgress?.( percent, bytesUploaded, bytesTotal );
		},
		onSuccess: ( payload ) => {
			if ( tusUpload.url ) {
				removeUploadProgress( tusUpload.url );
			}
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

			// Only server responses can mean the session is gone.
			if ( error.originalResponse && tusUpload.url ) {
				forgetUploadIfGone( tusUpload );
			}

			callbacks.onError( new Error( cleanMessage, { cause: error } ) );
		},
	} );

	return tusUpload;
}

/**
 * Removes an upload from localStorage if the server deleted its session, e.g. after rejecting the file.
 *
 * @param {tus.Upload} tusUpload The TUS upload instance.
 * @return {Promise<void>}
 */
async function forgetUploadIfGone( tusUpload ) {
	const uploadUrl = tusUpload.url;

	try {
		const response = await fetch( uploadUrl, {
			method: 'HEAD',
			headers: { 'X-WP-Nonce': getNonce() },
		} );

		// 404: session deleted, 410: session expired.
		if ( 404 !== response.status && 410 !== response.status ) {
			return;
		}
	} catch {
		// Status unknown, keep the upload resumable.
		return;
	}

	removeUploadProgress( uploadUrl );

	const previousUploads = await tusUpload.findPreviousUploads();

	await Promise.all(
		previousUploads
			.filter(
				( previousUpload ) => previousUpload.uploadUrl === uploadUrl
			)
			.map( ( previousUpload ) =>
				DEFAULT_TUS_OPTIONS.urlStorage.removeUpload(
					previousUpload.urlStorageKey
				)
			)
	);
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
 * @param {File}                                                                 file                 The file to upload.
 * @param {Object}                                                               [options]            Upload options.
 * @param {(percent: number, bytesUploaded: number, bytesTotal: number) => void} [options.onProgress] Progress callback.
 * @param {AbortSignal}                                                          [options.signal]     AbortSignal for cancellation.
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
 * Returns uploads of the current user and site that match the current TUS
 * endpoint and haven't expired. Use this to display a "Resume upload" UI to users.
 *
 * @return {Array<Object>} Array of pending upload objects with key, uploadUrl, filename, size, lastModified, bytesUploaded.
 */
export function getPendingUploads() {
	const endpoint = getEndpoint();
	const pending = [];

	for ( const key of storage.keys() ) {
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
				removeStoredUpload( key );
				continue;
			}

			// Check expiration
			const expiresAt = parseInt( keyParts[ 2 ], 10 );
			if ( isNaN( expiresAt ) || Date.now() > expiresAt ) {
				removeStoredUpload( key );
				continue;
			}

			const data = JSON.parse( storage.get( key ) || '' );

			// Parse fingerprint: tus-br|{filename}|{size}|{lastModified}|{endpoint}|{blogId}|{userId}
			const fingerprintParts = keyParts[ 1 ].split( '|' );
			if ( fingerprintParts.length !== 7 ) {
				removeStoredUpload( key );
				continue;
			}

			// Leave other users' uploads alone, they may come back to them.
			if (
				fingerprintParts[ 5 ] !== getBlogId() ||
				fingerprintParts[ 6 ] !== getUserId()
			) {
				continue;
			}

			pending.push( {
				key,
				uploadUrl: data.uploadUrl,
				filename: decodeURIComponent( fingerprintParts[ 1 ] ),
				size: parseInt( fingerprintParts[ 2 ], 10 ),
				lastModified: parseInt( fingerprintParts[ 3 ], 10 ),
				bytesUploaded: getUploadProgress( data.uploadUrl ),
			} );
		} catch {
			// Clean up malformed entries
			storage.remove( key );
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
	removeStoredUpload( pendingUpload.key );
	removeUploadProgress( pendingUpload.uploadUrl );
}

// ============================================================================
// Third-Party Compatibility
// ============================================================================

/**
 * Checks whether VideoPress is actively handling video uploads on this page.
 *
 * Covers three integration paths:
 * - Legacy Jetpack module plupload override (wp.VideoPress global)
 * - VideoPress package block editor integration (videoPressEditorState)
 * - Legacy Jetpack module block editor middleware (script tag detection)
 *
 * @return {boolean} True if VideoPress is intercepting video uploads.
 */
function isVideoPressActive() {
	// Legacy Jetpack module — plupload path.
	if ( window.wp?.VideoPress ) {
		return true;
	}

	// VideoPress package — block editor path.
	const state = window.videoPressEditorState;
	if (
		state?.isVideoPressModuleActive === '1' ||
		state?.isStandaloneActive === '1'
	) {
		return true;
	}

	// Legacy Jetpack module — block editor middleware.
	return !! document.getElementById(
		'jetpack-videopress-gutenberg-override-video-upload-js'
	);
}

// Skip TUS for video files when VideoPress is handling them.
addFilter(
	'uploadsUnleashed.shouldUseTus',
	'uploads-unleashed/videopress-compat',
	( shouldUseTus, file ) => {
		if ( file?.type?.startsWith( 'video/' ) && isVideoPressActive() ) {
			return false;
		}

		return shouldUseTus;
	}
);

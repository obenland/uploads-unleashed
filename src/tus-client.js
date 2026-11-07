/**
 * TUS Client for WordPress
 *
 * Clean API for resumable file uploads using the TUS protocol.
 *
 * @package
 */

import * as tus from 'tus-js-client';
import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

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
 * Waits until the browser reports a network connection.
 *
 * @since 1.2.0
 *
 * @return {Promise<void>} Resolves right away while online, otherwise on the next `online` event.
 */
function waitForOnline() {
	if ( false !== window.navigator.onLine ) {
		return Promise.resolve();
	}

	return new Promise( ( resolve ) => {
		window.addEventListener( 'online', () => resolve(), { once: true } );
	} );
}

/**
 * Decides whether tus retries a failed request.
 *
 * Unlike tus's default, this also retries while the browser is offline:
 * the retried request waits for the connection in `onBeforeRequest`.
 *
 * @since 1.2.0
 *
 * @param {Error} error The error of the failed request.
 * @return {boolean} Whether to retry.
 */
function shouldRetry( error ) {
	const status = error.originalResponse?.getStatus() || 0;

	// Everything but client errors, except offset conflicts and locked uploads.
	return status < 400 || status >= 500 || 409 === status || 423 === status;
}

/**
 * Default options for the TUS uploader.
 *
 * The retry counter resets whenever a chunk gets through, so the delays,
 * capped at a minute, only run out after about four minutes without progress.
 */
const DEFAULT_TUS_OPTIONS = {
	chunkSize: 5 * 1024 * 1024, // 5MB chunks
	retryDelays: [
		0, 1000, 3000, 5000, 10000, 20000, 30000, 60000, 60000, 60000,
	],
	onShouldRetry: shouldRetry,
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
		onBeforeRequest: async ( req ) => {
			await waitForOnline();

			/*
			 * tus can't cancel a request that is still waiting here, so drop it if the
			 * upload was aborted meanwhile. The termination request still goes out.
			 */
			if ( tusUpload._aborted && 'DELETE' !== req.getMethod() ) {
				throw new Error( 'Upload aborted' );
			}
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
				let errorMessage = __( 'Upload failed', 'uploads-unleashed' );
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

			if ( attachment ) {
				callbacks.onSuccess( attachment );
				return;
			}

			/*
			 * A resumed upload the server already received in full ends on a
			 * HEAD response, which has no body. Fetch the attachment instead.
			 */
			fetchAttachment(
				tusUpload.url,
				payload.lastResponse.getHeader?.( 'X-WP-Upload-Attachment-ID' )
			).then( ( fetched ) => {
				if ( fetched ) {
					callbacks.onSuccess( fetched );
					return;
				}

				callbacks.onError(
					new Error(
						__(
							'Upload completed but no attachment data received',
							'uploads-unleashed'
						)
					)
				);
			} );
		},
		onError: ( error ) => {
			// Extract a clean error message from TUS errors
			let cleanMessage =
				error.message || __( 'Upload failed', 'uploads-unleashed' );

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
 * Builds the REST URL of an attachment from the media endpoint.
 *
 * @param {number|string} attachmentId The attachment ID.
 * @return {string} The attachment URL with `context=edit`.
 */
function getAttachmentUrl( attachmentId ) {
	const url = new URL( getEndpoint(), window.location.href );
	const route = url.searchParams.get( 'rest_route' );

	// Plain permalinks carry the route in the query string.
	if ( route ) {
		url.searchParams.set( 'rest_route', `${ route }/${ attachmentId }` );
	} else {
		url.pathname = `${ url.pathname.replace( /\/$/, '' ) }/${ attachmentId }`;
	}
	url.searchParams.set( 'context', 'edit' );

	return url.toString();
}

/**
 * Fetches the attachment of a finished upload.
 *
 * Tries the upload URL first, which returns the same data as the final
 * PATCH, then the attachment named by the `X-WP-Upload-Attachment-ID` header.
 *
 * @param {string|null}      uploadUrl    The TUS upload URL.
 * @param {string|undefined} attachmentId The attachment ID header value, if any.
 * @return {Promise<Object|null>} The attachment data, or null if it can't be fetched.
 */
async function fetchAttachment( uploadUrl, attachmentId ) {
	const urls = [];
	if ( uploadUrl ) {
		urls.push( uploadUrl );
	}
	if ( attachmentId ) {
		urls.push( getAttachmentUrl( attachmentId ) );
	}

	for ( const url of urls ) {
		try {
			const response = await fetch( url, {
				headers: { 'X-WP-Nonce': getNonce() },
			} );

			if ( response.ok ) {
				const attachment = await response.json();
				if ( attachment?.id ) {
					return attachment;
				}
			}
		} catch {
			// Try the next source.
		}
	}

	return null;
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

/**
 * Number of uploads that run at once unless PHP localizes another limit.
 */
const DEFAULT_MAX_CONCURRENT_UPLOADS = 3;

/**
 * Number of uploads currently running.
 */
let activeUploads = 0;

/**
 * Uploads waiting for a free slot, in the order they were requested.
 *
 * @type {Array<() => void>}
 */
const uploadQueue = [];

/**
 * Returns how many uploads may run at once.
 *
 * Shared hosts often have only a few PHP workers, so uploading every
 * queued file at once leads to 503s. The limit comes from the
 * `uploads_unleashed_max_concurrent_uploads` PHP filter.
 *
 * @return {number} The limit, at least 1.
 */
function getMaxConcurrentUploads() {
	const limit = parseInt( window.uploadsUnleashed?.maxConcurrentUploads, 10 );

	return limit >= 1 ? limit : DEFAULT_MAX_CONCURRENT_UPLOADS;
}

/**
 * Starts queued uploads while slots are free.
 */
function startQueuedUploads() {
	while ( activeUploads < getMaxConcurrentUploads() && uploadQueue.length ) {
		uploadQueue.shift()();
	}
}

/**
 * Runs a task once an upload slot is free, and frees the slot when it settles.
 *
 * Starts the task synchronously when a slot is free. A queued task whose
 * signal aborts is rejected and never runs.
 *
 * @param {() => Promise<Object>} task     Starts the upload.
 * @param {AbortSignal}           [signal] AbortSignal for cancellation.
 * @return {Promise<Object>} Settles like the task.
 */
function withUploadSlot( task, signal ) {
	return new Promise( ( resolve, reject ) => {
		const onAbort = () => {
			const index = uploadQueue.indexOf( run );
			if ( -1 !== index ) {
				uploadQueue.splice( index, 1 );
				reject( new Error( 'Upload aborted' ) );
			}
		};

		const run = () => {
			signal?.removeEventListener( 'abort', onAbort );
			activeUploads++;

			task()
				.finally( () => {
					activeUploads--;
					startQueuedUploads();
				} )
				.then( resolve, reject );
		};

		signal?.addEventListener( 'abort', onAbort );
		uploadQueue.push( run );
		startQueuedUploads();
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
 * - A limit on parallel uploads; further uploads wait for a free slot.
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
	if ( options.signal?.aborted ) {
		throw new Error( 'Upload aborted' );
	}

	return withUploadSlot( () => startUpload( file, options ), options.signal );
}

/**
 * Uploads a file once it has an upload slot.
 *
 * @param {File}   file    The file to upload.
 * @param {Object} options Upload options, see upload().
 * @return {Promise<Object>} Resolves with WordPress attachment data.
 */
function startUpload( file, options ) {
	return new Promise( ( resolve, reject ) => {
		// Handle already-aborted signal before creating upload
		if ( options.signal?.aborted ) {
			reject( new Error( __( 'Upload aborted', 'uploads-unleashed' ) ) );
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
							__(
								'Upload completed but no attachment data received',
								'uploads-unleashed'
							)
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
					reject(
						new Error( __( 'Upload aborted', 'uploads-unleashed' ) )
					);
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

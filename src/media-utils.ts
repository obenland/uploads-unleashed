/**
 * Block Editor TUS Integration
 *
 * Intercepts media uploads via wp.apiFetch middleware to use TUS protocol.
 *
 * @package resumable-uploads
 */

import { createUpload } from './index';
import type { ApiFetchMiddleware, ApiFetchOptions } from './wordpress-types';

/**
 * Checks if a request is a media upload that should use TUS.
 *
 * @param options ApiFetch request options.
 * @return True if this is a media upload request.
 */
function isMediaUpload( options: ApiFetchOptions ): boolean {
	const { path, method, body } = options;

	// Must be a POST request
	if ( method !== 'POST' ) {
		return false;
	}

	// Must be to the media endpoint
	if ( ! path?.includes( '/wp/v2/media' ) ) {
		return false;
	}

	// Must have FormData with a file
	if ( ! ( body instanceof FormData ) ) {
		return false;
	}

	return body.has( 'file' );
}

/**
 * Extracts the File from FormData.
 *
 * @param formData FormData containing the file.
 * @return The file, or null if not found.
 */
function extractFile( formData: FormData ): File | null {
	const file = formData.get( 'file' );
	if ( file instanceof File ) {
		return file;
	}
	return null;
}

/**
 * Uploads a file using TUS protocol.
 *
 * @param file   File to upload.
 * @param signal Optional AbortSignal for cancellation.
 * @return Promise resolving to attachment data in REST API format.
 */
function tusUpload(
	file: File,
	signal?: AbortSignal
): Promise< Record< string, unknown > > {
	return new Promise( ( resolve, reject ) => {
		// Check if already aborted before starting
		if ( signal?.aborted ) {
			reject( new Error( 'Upload aborted' ) );
			return;
		}

		let settled = false;

		const upload = createUpload( file, {
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
							'Upload completed but no attachment returned'
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

		// Handle abort signal
		if ( signal ) {
			const abortHandler = () => {
				if ( settled ) {
					return;
				}
				settled = true;
				// Pass true to also remove from localStorage
				upload.abort( true );
				reject( new Error( 'Upload aborted' ) );
			};

			signal.addEventListener( 'abort', abortHandler, { once: true } );
		}

		// Check for previous uploads and resume if available
		upload.findPreviousUploads().then( ( previousUploads ) => {
			if ( signal?.aborted ) {
				return;
			}
			if ( previousUploads.length > 0 ) {
				upload.resumeFromPreviousUpload( previousUploads[ 0 ] );
			}
			upload.start();
		} );
	} );
}

/**
 * Creates apiFetch middleware that intercepts media uploads for TUS.
 *
 * @return Middleware function.
 */
function createTusMiddleware(): ApiFetchMiddleware {
	return async ( options, next ) => {
		// Only intercept media uploads
		if ( ! isMediaUpload( options ) ) {
			return next( options );
		}

		const file = extractFile( options.body as FormData );
		if ( ! file ) {
			return next( options );
		}

		// Upload via TUS
		return tusUpload( file, options.signal );
	};
}

/**
 * Registers the TUS middleware with wp.apiFetch.
 */
function registerMiddleware(): void {
	if ( ! window.wp?.apiFetch?.use ) {
		return;
	}

	window.wp.apiFetch.use( createTusMiddleware() );
}

// Initialize immediately
registerMiddleware();

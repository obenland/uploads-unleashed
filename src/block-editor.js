/**
 * Block Editor TUS Integration
 *
 * Intercepts media uploads via wp.apiFetch middleware to use TUS protocol.
 *
 * @package
 */

import { upload } from './tus-client';

/**
 * Checks if a request is a media upload that should use TUS.
 *
 * @param {Object} options apiFetch options.
 * @return {boolean} True if this is a media upload request.
 */
function isMediaUpload( options ) {
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
	return body instanceof FormData ? body.has( 'file' ) : false;
}

/**
 * Extracts the File from FormData.
 *
 * @param {FormData} formData The form data containing the file.
 * @return {File|null} The file, or null if not found.
 */
function extractFile( formData ) {
	const file = formData.get( 'file' );

	return file instanceof File ? file : null;
}

/**
 * TUS middleware for wp.apiFetch.
 *
 * Core-ready features:
 * - Graceful fallback to standard upload on TUS failure
 * - Uses `wp.hooks` for extensibility
 * - No global state pollution
 *
 * @param {Object}   options apiFetch options.
 * @param {Function} next    Next middleware in the chain.
 * @return {Promise} Upload result or next middleware result.
 */
const tusMiddleware = async ( options, next ) => {
	// Only intercept media uploads
	if ( ! isMediaUpload( options ) ) {
		return next( options );
	}

	const file = extractFile( options.body );
	if ( ! file ) {
		return next( options );
	}

	// Allow plugins to opt out of TUS for specific files.
	const shouldUseTus =
		window.wp?.hooks?.applyFilters?.(
			'uploadsUnleashed.shouldUseTus',
			true,
			file
		) ?? true;

	if ( ! shouldUseTus ) {
		return next( options );
	}

	try {
		// Try TUS upload
		return await upload( file, {
			signal: options.signal,
		} );
	} catch ( error ) {
		// Log for debugging
		// eslint-disable-next-line no-console
		console.warn(
			'TUS upload failed, falling back to standard upload:',
			error
		);

		// Allow WordPress hooks to decide whether to fall back
		// This enables plugins/themes to customize fallback behavior
		const allowFallback = window.wp?.hooks?.applyFilters?.(
			'uploadsUnleashed.allowFallback',
			true,
			error,
			file
		);

		if ( allowFallback ) {
			// Fall back to standard WordPress upload
			return next( options );
		}

		// If fallback is disabled, rethrow the error
		throw error;
	}
};

/**
 * Registers the TUS middleware with wp.apiFetch.
 */
function registerMiddleware() {
	if ( ! window.wp?.apiFetch?.use ) {
		return;
	}

	window.wp.apiFetch.use( tusMiddleware );
}

// Initialize immediately
registerMiddleware();

/**
 * Block Editor TUS Integration
 *
 * Intercepts media uploads via wp.apiFetch middleware to use TUS protocol.
 *
 * @package
 */

import { applyFilters } from '@wordpress/hooks';
import { dispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { upload } from '@uploads-unleashed/tus-client';

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

	/**
	 * Filters whether to use TUS for a given file upload.
	 *
	 * Returning false causes the block editor to use the standard
	 * wp.apiFetch upload path instead of the TUS protocol.
	 *
	 * @since 1.0.0
	 *
	 * @param {boolean} shouldUseTus Whether to use TUS. Default true.
	 * @param {File}    file         The file being uploaded.
	 */
	const shouldUseTus = applyFilters(
		'uploadsUnleashed.shouldUseTus',
		true,
		file
	);

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

		/**
		 * Filters whether to fall back to the standard upload after a TUS failure.
		 *
		 * Returning false causes the error to be re-thrown instead of
		 * falling back to the default wp.apiFetch upload.
		 *
		 * @since 1.0.0
		 *
		 * @param {boolean} allowFallback Whether to allow fallback. Default true.
		 * @param {Error}   error         The error that caused TUS to fail.
		 * @param {File}    file          The file that was being uploaded.
		 */
		const allowFallback = applyFilters(
			'uploadsUnleashed.allowFallback',
			true,
			error,
			file
		);

		if ( allowFallback ) {
			dispatch( noticesStore ).createWarningNotice(
				__(
					'Resumable upload unavailable for this file. Using standard upload.',
					'uploads-unleashed'
				),
				{
					id: 'uploads-unleashed-fallback-' + file.name,
					isDismissible: true,
					type: 'snackbar',
				}
			);

			// Fall back to standard WordPress upload
			return next( options );
		}

		// If fallback is disabled, rethrow the error
		throw error;
	}
};

// Register middleware immediately.
apiFetch.use( tusMiddleware );

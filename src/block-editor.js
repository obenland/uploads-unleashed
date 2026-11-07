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
import { sprintf, _n, __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { upload, getPendingUploads } from '@uploads-unleashed/tus-client';

/**
 * Checks if a request is a media upload that should use TUS.
 *
 * Only uploads to the collection route qualify. Sub-routes such as
 * `/wp/v2/media/{id}/sideload`, which client-side media processing uses for
 * the sub-sizes it generates, add files to an existing attachment and must
 * reach core unchanged.
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

	// Must be to the media collection, with or without a query string.
	if ( ! /^\/?wp\/v2\/media$/.test( path?.split( '?' )[ 0 ] ?? '' ) ) {
		return false;
	}

	// Must have FormData with a file
	return body instanceof FormData ? body.has( 'file' ) : false;
}

/**
 * Checks if an upload asks for processing the TUS endpoint can't honor yet.
 *
 * With client-side media processing, the editor uploads images it resizes
 * itself with `generate_sub_sizes=false`, and some derivatives with
 * `convert_format=false`. The TUS endpoint ignores both, so such uploads go
 * to core until it supports them.
 *
 * @since 1.2.0
 *
 * @param {FormData} formData The upload's form data.
 * @return {boolean} True if the upload needs core's upload handling.
 */
function needsCoreProcessingFlags( formData ) {
	return [ 'generate_sub_sizes', 'convert_format' ].some(
		( field ) => formData.get( field ) === 'false'
	);
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
 * @param {Object}                                options apiFetch options.
 * @param {(options: Object) => Promise<unknown>} next    Next middleware in the chain.
 * @return {Promise} Upload result or next middleware result.
 */
const tusMiddleware = async ( options, next ) => {
	// Only intercept media uploads
	if ( ! isMediaUpload( options ) ) {
		return next( options );
	}

	const file = extractFile( options.body );
	if ( ! file || needsCoreProcessingFlags( options.body ) ) {
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

/**
 * Shows a snackbar notice if there are pending uploads.
 */
function showPendingUploadsNotice() {
	const pending = getPendingUploads();
	if ( pending.length === 0 ) {
		return;
	}

	dispatch( noticesStore ).createInfoNotice(
		sprintf(
			/* translators: %d: number of pending uploads */
			_n(
				'You have %d interrupted upload.',
				'You have %d interrupted uploads.',
				pending.length,
				'uploads-unleashed'
			),
			pending.length
		),
		{
			id: 'uploads-unleashed-pending',
			isDismissible: true,
			type: 'snackbar',
			actions: [
				{
					url: window.uploadsUnleashed?.mediaNewUrl,
					label: __( 'Resume uploads', 'uploads-unleashed' ),
				},
			],
		}
	);
}

showPendingUploadsNotice();

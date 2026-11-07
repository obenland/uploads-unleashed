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
 * Checks whether a TUS upload failed because the endpoint is unavailable.
 *
 * Only a network error or a 404, 405 or 501 response on the creation request
 * qualifies. Any other failure is the server's answer to this upload, such as
 * an invalid file type or a full disk, which a standard upload would get too.
 *
 * @since 1.2.0
 *
 * @param {Error} error The error `upload()` rejected with.
 * @return {boolean} True if a standard upload might still succeed.
 */
function isTusUnavailable( error ) {
	const request = error?.cause?.originalRequest;

	// The creation request is the only plain POST; others override the method.
	if (
		request?.getMethod() !== 'POST' ||
		request.getHeader( 'X-HTTP-Method-Override' )
	) {
		return false;
	}

	const response = error.cause.originalResponse;

	return ! response || [ 404, 405, 501 ].includes( response.getStatus() );
}

/**
 * TUS middleware for wp.apiFetch.
 *
 * Core-ready features:
 * - Graceful fallback to standard upload when TUS is unavailable
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
			params: Object.fromEntries( options.body ),
		} );
	} catch ( error ) {
		// The server answered and turned the upload down: show its message.
		if ( ! isTusUnavailable( error ) ) {
			throw error;
		}

		// eslint-disable-next-line no-console
		console.warn(
			'TUS upload failed, falling back to standard upload:',
			error
		);

		/**
		 * Filters whether to fall back to the standard upload when TUS is unavailable.
		 *
		 * Returning false causes the error to be re-thrown instead of
		 * falling back to the default wp.apiFetch upload. Only consulted
		 * when the upload couldn't be created, never after the server
		 * rejected it.
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

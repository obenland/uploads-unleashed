/**
 * TUS Resumable Uploader for WordPress
 *
 * @package
 */

import * as tus from 'tus-js-client';

/**
 * Default options for the TUS uploader.
 */
const DEFAULT_OPTIONS = {
	chunkSize: 5 * 1024 * 1024, // 5MB chunks
	retryDelays: [ 0, 1000, 3000, 5000 ],
	removeFingerprintOnSuccess: true,
};

/**
 * Creates a TUS upload for a file.
 *
 * @param {File}     file               The file to upload.
 * @param {Object}   options            Upload options.
 * @param {Function} options.onProgress Progress callback (percentage, bytesUploaded, bytesTotal).
 * @param {Function} options.onSuccess  Success callback (attachmentId, upload).
 * @param {Function} options.onError    Error callback (error).
 * @return {tus.Upload} The TUS upload instance.
 */
export function createUpload( file, options = {} ) {
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
		onProgress: ( bytesUploaded, bytesTotal ) => {
			const percentage = ( ( bytesUploaded / bytesTotal ) * 100 ).toFixed(
				2
			);
			onProgress( percentage, bytesUploaded, bytesTotal );
		},
		onSuccess: () => {
			// Extract attachment ID from response header.
			const attachmentId = upload.xhr?.getResponseHeader(
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
 *
 * @param {File}   file    The file to upload.
 * @param {Object} options Upload options.
 * @return {Promise<{attachmentId: number, upload: tus.Upload}>} Promise resolving to attachment ID and upload instance.
 */
export function uploadFile( file, options = {} ) {
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
 *
 * @param {tus.Upload} upload The upload instance to abort.
 * @return {Promise<void>} Promise resolving when abort is complete.
 */
export function abortUpload( upload ) {
	return upload.abort( true );
}

// Export tus for advanced usage.
export { tus };

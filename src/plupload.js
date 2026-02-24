/**
 * Plupload Integration for TUS Uploads
 *
 * Extends WordPress plupload with TUS protocol support.
 *
 * @package
 */

import { applyFilters } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import { upload } from '@uploads-unleashed/tus-client';

/**
 * Plupload file status constants.
 *
 * @see https://www.plupload.com/docs/v2/File#status-property
 */
const PLUPLOAD_STATUS = {
	QUEUED: 1,
	UPLOADING: 2,
	FAILED: 4,
	DONE: 5,
};

// Track hooked plupload instances to prevent double-hooking
const hookedUploaders = new WeakSet();

/**
 * Handles plupload errors by updating file status and triggering error UI.
 *
 * @param {Object} up      Plupload instance.
 * @param {Object} file    Plupload file object.
 * @param {string} message Error message.
 */
function handlePluploadError( up, file, message ) {
	file.status = PLUPLOAD_STATUS.FAILED;

	if ( typeof window.wpFileError === 'function' ) {
		// media-new.php path
		window.wpFileError( file, message );
	} else {
		// upload.php path
		up.trigger( 'Error', {
			code: -200,
			message,
			file,
		} );
	}
}

/**
 * Handles the BeforeUpload event to redirect uploads to TUS.
 *
 * Core-ready pattern: Extends plupload behavior without replacing handlers.
 * Returns false to prevent plupload's default upload, undefined to allow it.
 *
 * @param {Object} uploader Plupload instance.
 * @param {Object} file     Plupload file object.
 * @return {boolean|void} False to prevent default, undefined to allow it.
 */
function handleBeforeUpload( uploader, file ) {
	const nativeFile = file.getNative?.();

	// Graceful degradation: If we can't get native file, let plupload handle it
	if ( ! nativeFile ) {
		return; // Let plupload's default behavior run
	}

	/**
	 * Filters whether to use TUS for a given file upload.
	 *
	 * Returning false lets plupload handle the upload using
	 * its default chunked upload behavior.
	 *
	 * @since 1.0.0
	 *
	 * @param {boolean} shouldUseTus Whether to use TUS. Default true.
	 * @param {File}    file         The native File object being uploaded.
	 */
	const shouldUseTus = applyFilters(
		'uploadsUnleashed.shouldUseTus',
		true,
		nativeFile
	);

	if ( ! shouldUseTus ) {
		return; // Let plupload's default behavior run
	}

	// Use TUS for this file
	upload( nativeFile, {
		onProgress: ( percent, bytesUploaded ) => {
			file.loaded = bytesUploaded;
			file.percent = percent;

			// Update the Backbone attachment model (used by media library grid)
			if ( file.attachment ) {
				file.attachment.set( {
					loaded: bytesUploaded,
					percent,
				} );
			}

			uploader.trigger( 'UploadProgress', file );

			// Add resumable badge on first progress tick (media-new.php only).
			const mediaItem = document.getElementById(
				'media-item-' + file.id
			);
			if (
				mediaItem &&
				! mediaItem.querySelector( '.uploads-unleashed-badge' )
			) {
				const badge = document.createElement( 'span' );
				badge.className = 'uploads-unleashed-badge';
				badge.textContent = __( 'Resumable', 'uploads-unleashed' );
				const progress = mediaItem.querySelector( '.progress' );
				if ( progress ) {
					progress.after( badge );
				}
			}
		},
	} )
		.then( ( attachment ) => {
			file.percent = 100;
			file.status = PLUPLOAD_STATUS.DONE;

			// For media-new.php (check for #media-items which only exists there)
			if (
				typeof window.uploadSuccess === 'function' &&
				document.getElementById( 'media-items' )
			) {
				window.uploadSuccess( file, String( attachment.id ) );
				return;
			}

			// Fetch attachment in wp_prepare_attachment_for_js() format.
			const model = window.wp.media.attachment( attachment.id );

			return model.fetch().then( () => {
				uploader.trigger( 'FileUploaded', file, {
					response: JSON.stringify( {
						success: true,
						data: model.toJSON(),
					} ),
				} );
			} );
		} )
		.catch( ( error ) => {
			handlePluploadError(
				uploader,
				file,
				error.message || 'Upload failed'
			);
		} );

	// Remove file from plupload queue (we're handling it via TUS)
	uploader.removeFile( file );

	// Process next file in queue
	setTimeout( () => uploader.start(), 0 );

	// Prevent plupload's default upload behavior
	return false;
}

/**
 * Hooks a plupload instance to use TUS uploads.
 *
 * @param {Object} up Plupload instance.
 */
function hookPluploadInstance( up ) {
	// Mark this instance as hooked for debugging
	up._tusHooked = true;

	// Bind with high priority (100) to run before other handlers
	up.bind(
		'BeforeUpload',
		( ...args ) => {
			const uploader = args[ 0 ];
			const file = args[ 1 ];
			return handleBeforeUpload( uploader, file );
		},
		undefined,
		100
	);
}

/**
 * Wraps the wp.Uploader constructor to hook all future instances.
 *
 * This is the primary integration point for upload.php (Media Library grid).
 * Called immediately on script load since wp.Uploader exists via the
 * wp-plupload script dependency.
 */
function extendWpUploader() {
	if ( ! window.wp?.Uploader ) {
		// Should not happen with proper dependencies, but guard anyway
		return;
	}

	const OriginalUploader = window.wp.Uploader;

	const WrappedUploader = function ( options ) {
		OriginalUploader.call( this, options );

		// Hook the plupload instance immediately
		if ( this.uploader && ! hookedUploaders.has( this.uploader ) ) {
			hookedUploaders.add( this.uploader );
			hookPluploadInstance( this.uploader );
		}
	};

	WrappedUploader.prototype = OriginalUploader.prototype;
	Object.keys( OriginalUploader ).forEach( ( key ) => {
		WrappedUploader[ key ] = OriginalUploader[ key ];
	} );

	window.wp.Uploader = WrappedUploader;
}

/**
 * Hooks the global plupload instance used by media-new.php (Add New Media page).
 *
 * Unlike upload.php which uses wp.Uploader, media-new.php creates a raw
 * plupload instance stored as window.uploader. This is created by handlers.js
 * in its jQuery ready callback.
 *
 * Called via jQuery ready. The plupload-handlers dependency ensures handlers.js
 * registers its ready callback first, so window.uploader exists when we run.
 */
function extendGlobalUploader() {
	const globalUploader = window.uploader;

	if ( globalUploader && ! hookedUploaders.has( globalUploader ) ) {
		hookedUploaders.add( globalUploader );
		hookPluploadInstance( globalUploader );
	}
}

/**
 * Initializes TUS integration with WordPress media uploaders.
 *
 * Sets up two integration points:
 * 1. Wraps wp.Uploader constructor immediately (for upload.php grid view)
 * 2. Hooks global uploader via jQuery ready (for media-new.php)
 */
function init() {
	// Wrap wp.Uploader immediately (exists via wp-plupload dependency)
	extendWpUploader();

	// Hook global uploader via jQuery ready
	// (handlers.js ready runs first due to plupload-handlers dependency)
	if ( typeof window.jQuery !== 'undefined' ) {
		window.jQuery( document ).ready( extendGlobalUploader );
	}
}

// Initialize immediately (dependencies ensure proper load order)
init();

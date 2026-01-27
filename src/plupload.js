/**
 * Plupload Integration for TUS Uploads
 *
 * Extends WordPress plupload with TUS protocol support.
 *
 * @package
 */

import { upload } from './tus-client';

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
 * Transforms REST API attachment format to wp_prepare_attachment_for_js() format.
 *
 * WordPress core's Media Library expects the legacy format with camelCase keys.
 * The TUS endpoint returns REST API format, so we transform it here.
 *
 * @param {Object} attachment REST API attachment data.
 * @return {Object} Legacy attachment format for WordPress core.
 */
function toAttachmentForJs( attachment ) {
	const sizes = attachment.media_details?.sizes;

	return {
		id: attachment.id,
		title: attachment.title?.raw || '',
		filename: attachment.media_details?.file || '',
		url: attachment.source_url,
		link: attachment.link,
		alt: attachment.alt_text || '',
		author: String( attachment.author ),
		description: attachment.description?.raw || '',
		caption: attachment.caption?.raw || '',
		name: attachment.slug,
		status: attachment.status,
		uploadedTo: attachment.post || 0,
		date: new Date( attachment.date ).getTime(),
		modified: new Date( attachment.modified ).getTime(),
		menuOrder: 0,
		mime: attachment.mime_type,
		type: attachment.media_type,
		subtype: attachment.mime_type?.split( '/' )[ 1 ] || '',
		icon: '',
		dateFormatted: attachment.date,
		nonces: {},
		editLink: attachment._links?.self?.[ 0 ]?.href || '',
		meta: false,
		authorName: '',
		authorLink: '',
		filesizeInBytes: attachment.media_details?.filesize || 0,
		filesizeHumanReadable: '',
		width: attachment.media_details?.width,
		height: attachment.media_details?.height,
		sizes: sizes
			? Object.fromEntries(
					Object.entries( sizes ).map( ( [ key, size ] ) => [
						key,
						{
							url: size.source_url,
							width: size.width,
							height: size.height,
						},
					] )
			  )
			: {},
	};
}

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
		},
	} )
		.then( ( attachment ) => {
			file.percent = 100;
			file.status = PLUPLOAD_STATUS.DONE;

			// Transform REST API format to legacy format for WordPress core
			const legacyAttachment = toAttachmentForJs( attachment );

			// For media-new.php (check for #media-items which only exists there)
			if (
				typeof window.uploadSuccess === 'function' &&
				document.getElementById( 'media-items' )
			) {
				window.uploadSuccess( file, String( attachment.id ) );
			} else {
				// For upload.php and other contexts, trigger FileUploaded
				uploader.trigger( 'FileUploaded', file, {
					response: JSON.stringify( {
						success: true,
						data: legacyAttachment,
					} ),
				} );
			}
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

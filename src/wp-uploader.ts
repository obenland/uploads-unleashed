/**
 * WordPress Media Uploader Integration
 *
 * Hooks into wp.Uploader and plupload to use TUS protocol for resumable file uploads.
 * Supports both the Media Library grid view (upload.php) and Add New Media page (media-new.php).
 *
 * Uses proper script dependencies to ensure timing:
 * - wp-plupload dependency: wp.Uploader exists when this script runs
 * - plupload-handlers dependency: handlers.js jQuery ready runs before ours
 */

import { createUpload, AttachmentData } from './index';
import type {
	PluploadFile,
	PluploadInstance,
	WpUploaderConstructor,
	WpUploaderInstance,
} from './wordpress-types';

// Track which files we're handling via TUS to prevent duplicate uploads
const tusHandledFiles = new Set< string >();

/**
 * Transforms REST API attachment format to wp_prepare_attachment_for_js() format.
 *
 * WordPress core's Media Library expects the legacy format with camelCase keys.
 * The TUS endpoint returns REST API format, so we transform it here.
 *
 * @param attachment Attachment data in REST API format.
 * @return Attachment in legacy format.
 */
function toAttachmentForJs(
	attachment: AttachmentData
): Record< string, unknown > {
	const sizes = attachment.media_details?.sizes;

	return {
		id: attachment.id,
		title: attachment.title?.raw || '',
		filename: attachment.media_details?.file || '',
		url: attachment.source_url,
		link: attachment.link,
		alt: attachment.alt_text || '',
		author: String( attachment.author ),
		description: ( attachment.description as { raw?: string } )?.raw || '',
		caption: attachment.caption?.raw || '',
		name: attachment.slug,
		status: attachment.status,
		uploadedTo: ( attachment.post as number ) || 0,
		date: new Date( attachment.date ).getTime(),
		modified: new Date( attachment.modified ).getTime(),
		menuOrder: 0,
		mime: attachment.mime_type,
		type: attachment.media_type,
		subtype: attachment.mime_type?.split( '/' )[ 1 ] || '',
		icon: '',
		dateFormatted: attachment.date,
		nonces: {},
		editLink: ( attachment._links?.self as { href: string }[] )?.[ 0 ]
			?.href,
		meta: false,
		authorName: '',
		authorLink: '',
		filesizeInBytes: ( attachment.media_details?.filesize as number ) || 0,
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

// Track hooked plupload instances
const hookedUploaders = new WeakSet< PluploadInstance >();

/**
 * Handles plupload errors by updating file status and triggering error UI.
 *
 * Uses window.wpFileError if available (media-new.php), otherwise triggers
 * plupload's Error event directly.
 *
 * @param up      - The plupload instance.
 * @param file    - The file that failed.
 * @param message - Human-readable error message.
 */
function handlePluploadError(
	up: PluploadInstance,
	file: PluploadFile,
	message: string
): void {
	file.status = 4; // plupload.FAILED

	if ( typeof window.wpFileError === 'function' ) {
		window.wpFileError( file, message );
	} else {
		up.trigger( 'Error', {
			code: -200,
			message,
			file,
		} );
	}
}

/**
 * Hooks a plupload instance to intercept uploads and use TUS protocol instead.
 *
 * Binds to the BeforeUpload event to:
 * 1. Stop plupload's default upload behavior
 * 2. Create a TUS upload with progress/success/error callbacks
 * 3. Resume previous uploads if available (via tus-js-client fingerprinting)
 * 4. Trigger plupload events to update WordPress UI (UploadProgress, FileUploaded)
 *
 * @param up - The plupload instance to hook.
 */
function hookPluploadInstance( up: PluploadInstance ): void {
	// Mark this instance as hooked for debugging
	( up as PluploadInstance & { _tusHooked?: boolean } )._tusHooked = true;

	up.bind( 'BeforeUpload', ( ...args: unknown[] ) => {
		const uploader = args[ 0 ] as PluploadInstance;
		const file = args[ 1 ] as PluploadFile;

		const nativeFile = file.getNative?.();
		if ( ! nativeFile ) {
			return; // Let plupload handle it
		}

		const fileKey = nativeFile.name + nativeFile.size;
		if ( tusHandledFiles.has( fileKey ) ) {
			return false; // Already handling via TUS
		}

		tusHandledFiles.add( fileKey );

		const upload = createUpload( nativeFile, {
			onProgress: ( percentage, bytesUploaded ) => {
				file.loaded = bytesUploaded;
				file.percent = parseFloat( percentage );

				// Update the Backbone attachment model (used by media library grid)
				if ( file.attachment ) {
					file.attachment.set( {
						loaded: bytesUploaded,
						percent: parseFloat( percentage ),
					} );
				}

				uploader.trigger( 'UploadProgress', file );
			},
			onSuccess: ( attachment ) => {
				tusHandledFiles.delete( fileKey );

				if ( ! attachment ) {
					handlePluploadError(
						uploader,
						file,
						'Upload failed: no attachment data'
					);
					return;
				}

				file.percent = 100;
				file.status = 5; // plupload.DONE

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
					// plupload automatically prepends 'this' (uploader) as first arg
					uploader.trigger( 'FileUploaded', file, {
						response: JSON.stringify( {
							success: true,
							data: legacyAttachment,
						} ),
					} );
				}
			},
			onError: ( error ) => {
				tusHandledFiles.delete( fileKey );
				handlePluploadError(
					uploader,
					file,
					error.message || 'Upload failed'
				);
			},
		} );

		upload.findPreviousUploads().then( ( previousUploads ) => {
			if ( previousUploads.length > 0 ) {
				upload.resumeFromPreviousUpload( previousUploads[ 0 ] );
			}
			upload.start();
		} );

		// Remove from plupload queue (we're handling via TUS) and process next file
		uploader.removeFile( file );
		setTimeout( () => uploader.start(), 0 );

		return false;
	} );
}

/**
 * Wraps the wp.Uploader constructor to hook all future instances.
 *
 * This is the primary integration point for upload.php (Media Library grid).
 * When users click "Add New" in the grid view, WordPress creates a new
 * wp.Uploader instance. By wrapping the constructor, we can hook each
 * instance's plupload uploader immediately after creation.
 *
 * Called immediately on script load since wp.Uploader exists via the
 * wp-plupload script dependency.
 */
function wrapWpUploader(): void {
	if ( ! window.wp?.Uploader ) {
		// Should not happen with proper dependencies, but guard anyway
		return;
	}

	const OriginalUploader = window.wp.Uploader;

	const WrappedUploader = function (
		this: WpUploaderInstance,
		options: unknown
	) {
		OriginalUploader.call( this, options );

		// Hook the plupload instance immediately
		if ( this.uploader && ! hookedUploaders.has( this.uploader ) ) {
			hookedUploaders.add( this.uploader );
			hookPluploadInstance( this.uploader );
		}
	} as unknown as WpUploaderConstructor;

	WrappedUploader.prototype = OriginalUploader.prototype;
	Object.keys( OriginalUploader ).forEach( ( key ) => {
		( WrappedUploader as unknown as Record< string, unknown > )[ key ] = (
			OriginalUploader as unknown as Record< string, unknown >
		 )[ key ];
	} );

	window.wp.Uploader = WrappedUploader as typeof window.wp.Uploader;
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
function hookGlobalUploader(): void {
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
 *
 * Script dependencies ensure proper load order - no polling required.
 */
function initTusUploader(): void {
	// Wrap wp.Uploader immediately (exists via wp-plupload dependency)
	wrapWpUploader();

	// Hook global uploader via jQuery ready
	// (handlers.js ready runs first due to plupload-handlers dependency)
	if ( typeof window.jQuery !== 'undefined' ) {
		window.jQuery( document ).ready( hookGlobalUploader );
	}
}

// Initialize immediately (dependencies ensure proper load order)
initTusUploader();

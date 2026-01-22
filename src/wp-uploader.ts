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

import * as tus from 'tus-js-client';
import { createUpload } from './index';

declare global {
	interface Window {
		wp: {
			Uploader: WpUploaderConstructor & {
				queue: BackboneCollection;
			};
		};
		plupload?: {
			Uploader: new ( settings: unknown ) => PluploadInstance;
		};
		// Global functions from wp-admin/includes/js/handlers.js (media-new.php)
		uploadSuccess?: ( fileObj: PluploadFile, serverData: string ) => void;
		wpFileError?: ( fileObj: PluploadFile, message: string ) => void;
		jQuery?: JQueryStatic;
	}
}

interface JQueryStatic {
	( callback: () => void ): void;
	( document: Document ): {
		ready: ( callback: () => void ) => void;
	};
}

interface WpUploaderInstance {
	uploader: PluploadInstance;
}

interface WpUploaderConstructor {
	new ( options: unknown ): WpUploaderInstance;
	prototype: WpUploaderInstance;
}

interface BackboneCollection {
	on: ( event: string, callback: ( model: BackboneModel ) => void ) => void;
	off: ( event: string, callback?: ( model: BackboneModel ) => void ) => void;
}

interface BackboneModel {
	get: ( attr: string ) => unknown;
	set: ( attrs: Record< string, unknown > ) => void;
}

interface PluploadFile {
	id: string;
	name: string;
	size: number;
	loaded: number;
	percent: number;
	status: number;
	type: string;
	getNative?: () => File;
	attachment?: BackboneModel;
}

interface PluploadInstance {
	id: string;
	state: number;
	files: PluploadFile[];
	bind: ( event: string, callback: ( ...args: unknown[] ) => void ) => void;
	trigger: ( event: string, ...args: unknown[] ) => void;
	removeFile: ( file: PluploadFile ) => void;
	stop: () => void;
	start: () => void;
}

// Track which files we're handling via TUS
const tusUploads = new Map< string, tus.Upload >();
const tusHandledFiles = new Set< string >();

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

		// Stop plupload from uploading this file
		uploader.stop();

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
				tusUploads.delete( fileKey );
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
							data: attachment,
						} ),
					} );
				}

				// Continue with next file in queue
				if ( uploader.files.length > 0 ) {
					uploader.start();
				}
			},
			onError: ( error ) => {
				tusUploads.delete( fileKey );
				tusHandledFiles.delete( fileKey );
				handlePluploadError(
					uploader,
					file,
					error.message || 'Upload failed'
				);
			},
		} );

		tusUploads.set( fileKey, upload );

		upload.findPreviousUploads().then( ( previousUploads ) => {
			if ( previousUploads.length > 0 ) {
				upload.resumeFromPreviousUpload( previousUploads[ 0 ] );
			}
			upload.start();
		} );

		return false; // Prevent plupload default
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
	const globalUploader = (
		window as unknown as { uploader?: PluploadInstance }
	 ).uploader;

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

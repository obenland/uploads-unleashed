/**
 * WordPress Media Uploader Integration
 *
 * Replaces the default Plupload-based upload with TUS resumable uploads.
 *
 * @package resumable-uploader
 */

import * as tus from 'tus-js-client';
import { createUpload } from './index';

type EventCallback = ( ...args: unknown[] ) => void;

interface AttachmentModel {
	id: string;
	file: File;
	uploading: boolean;
	percent: number;
	filename: string;
	loaded?: number;
	size?: number;
	error?: string;
	_events: Record< string, EventCallback[] >;
	get: ( key: string ) => unknown;
	set: ( data: Record< string, unknown > ) => void;
	on: ( event: string, callback: EventCallback ) => void;
	off: ( event: string, callback: EventCallback ) => void;
	trigger: ( event: string, ...args: unknown[] ) => void;
	[ key: string ]: unknown;
}

interface UploaderOptions {
	container?: Element | string;
	dropzone?: Element | string;
	browser?: Element | string;
	params?: Record< string, unknown >;
	added?: ( attachment: AttachmentModel ) => void;
	progress?: ( attachment: AttachmentModel ) => void;
	success?: ( attachment: AttachmentModel ) => void;
	error?: ( error: { message: string; file: File } ) => void;
	complete?: ( attachment: AttachmentModel ) => void;
}

interface QueueItem {
	file: File;
	attachment: AttachmentModel;
}

interface WPUploader {
	new ( options?: UploaderOptions ): WPUploaderInstance;
	uuid: number;
	queue: unknown[];
	prototype: WPUploaderPrototype;
}

interface WPUploaderInstance extends WPUploaderPrototype {
	options: Required< UploaderOptions >;
	queue: QueueItem[];
	activeUploads: Map< string, tus.Upload >;
	supports: { upload: boolean; dragdrop: boolean };
	uploader: { refresh: () => void; bind: () => void };
}

interface WPUploaderPrototype {
	initDropzone: ( dropzone: Element | string ) => void;
	initBrowser: ( browser: Element | string ) => void;
	addFiles: ( files: File[] ) => void;
	createAttachmentModel: ( file: File ) => AttachmentModel;
	processQueue: () => void;
	uploadFile: ( file: File, attachment: AttachmentModel ) => void;
	handleError: ( attachment: AttachmentModel, error: Error ) => void;
	abort: ( id: string ) => void;
	abortAll: () => void;
}

declare global {
	interface Window {
		wp: {
			Uploader: WPUploader;
			apiFetch: ( options: {
				path: string;
			} ) => Promise< Record< string, unknown > >;
		};
	}
}

/**
 * Initializes TUS uploader by replacing wp.Uploader.
 */
function initTusUploader(): void {
	// Bail if wp.Uploader is not available.
	if ( typeof window.wp === 'undefined' || ! window.wp.Uploader ) {
		return;
	}

	const OriginalUploader = window.wp.Uploader;

	/**
	 * Custom Uploader that uses TUS protocol.
	 * @param options
	 */
	const TusUploader = function (
		this: WPUploaderInstance,
		options?: UploaderOptions
	) {
		const defaults: Required< UploaderOptions > = {
			container: document.body,
			dropzone: document.body,
			browser: '',
			params: {},
			added: () => {},
			progress: () => {},
			success: () => {},
			error: () => {},
			complete: () => {},
		};

		this.options = { ...defaults, ...options };
		this.queue = [];
		this.activeUploads = new Map();

		// Bind to drop zone.
		if ( this.options.dropzone ) {
			this.initDropzone( this.options.dropzone );
		}

		// Bind to file input.
		if ( this.options.browser ) {
			this.initBrowser( this.options.browser );
		}

		// Expose supports object for compatibility.
		this.supports = {
			upload: true,
			dragdrop: 'draggable' in document.createElement( 'div' ),
		};

		// Expose uploader for compatibility.
		this.uploader = {
			refresh() {},
			bind() {},
		};

		return this;
	} as unknown as WPUploader;

	// Copy static properties and prototype.
	TusUploader.uuid = 0;
	TusUploader.queue = OriginalUploader.queue || [];

	TusUploader.prototype = {
		/**
		 * Initializes dropzone event handlers.
		 * @param dropzone
		 */
		initDropzone(
			this: WPUploaderInstance,
			dropzone: Element | string
		): void {
			const zone =
				typeof dropzone === 'string'
					? document.querySelector< HTMLElement >( dropzone )
					: ( dropzone as HTMLElement );

			if ( ! zone ) {
				return;
			}

			zone.addEventListener( 'dragover', ( e ) => {
				e.preventDefault();
				zone.classList.add( 'drag-over' );
			} );

			zone.addEventListener( 'dragleave', () => {
				zone.classList.remove( 'drag-over' );
			} );

			zone.addEventListener( 'drop', ( e ) => {
				e.preventDefault();
				zone.classList.remove( 'drag-over' );
				if ( e.dataTransfer?.files ) {
					this.addFiles( Array.from( e.dataTransfer.files ) );
				}
			} );
		},

		/**
		 * Initializes file browser input.
		 * @param browser
		 */
		initBrowser(
			this: WPUploaderInstance,
			browser: Element | string
		): void {
			const input =
				typeof browser === 'string'
					? document.querySelector< HTMLInputElement >( browser )
					: ( browser as HTMLInputElement );

			if ( ! input ) {
				return;
			}

			input.addEventListener( 'change', () => {
				if ( input.files ) {
					this.addFiles( Array.from( input.files ) );
				}
				input.value = '';
			} );
		},

		/**
		 * Adds files to the upload queue.
		 * @param files
		 */
		addFiles( this: WPUploaderInstance, files: File[] ): void {
			files.forEach( ( file ) => {
				const attachment = this.createAttachmentModel( file );
				this.queue.push( { file, attachment } );

				if ( this.options.added ) {
					this.options.added.call( this, attachment );
				}
			} );

			this.processQueue();
		},

		/**
		 * Creates a Backbone attachment model for a file.
		 * @param file
		 */
		createAttachmentModel( file: File ): AttachmentModel {
			const id =
				'tusupload_' + ++( window.wp.Uploader as WPUploader ).uuid;

			// Create attachment object compatible with wp.media expectations.
			return {
				id,
				file,
				uploading: true,
				percent: 0,
				filename: file.name,
				_events: {},
				get( key: string ): unknown {
					return this[ key ];
				},
				set( data: Record< string, unknown > ): void {
					Object.assign( this, data );
					if ( this.trigger ) {
						this.trigger( 'change', this );
					}
				},
				on( event: string, callback: EventCallback ): void {
					this._events[ event ] = this._events[ event ] || [];
					this._events[ event ].push( callback );
				},
				off( event: string, callback: EventCallback ): void {
					if ( this._events[ event ] ) {
						this._events[ event ] = this._events[ event ].filter(
							( cb ) => cb !== callback
						);
					}
				},
				trigger( event: string, ...args: unknown[] ): void {
					if ( this._events[ event ] ) {
						this._events[ event ].forEach( ( cb ) =>
							cb.apply( this, args )
						);
					}
				},
			};
		},

		/**
		 * Processes the upload queue.
		 */
		processQueue( this: WPUploaderInstance ): void {
			while ( this.queue.length > 0 && this.activeUploads.size < 3 ) {
				const item = this.queue.shift();
				if ( item ) {
					this.uploadFile( item.file, item.attachment );
				}
			}
		},

		/**
		 * Uploads a single file using TUS.
		 * @param file
		 * @param attachment
		 */
		uploadFile(
			this: WPUploaderInstance,
			file: File,
			attachment: AttachmentModel
		): void {
			const upload = createUpload( file, {
				onProgress: ( percentage, bytesUploaded, bytesTotal ) => {
					attachment.set( {
						percent: parseFloat( percentage ),
						loaded: bytesUploaded,
						size: bytesTotal,
					} );

					if ( this.options.progress ) {
						this.options.progress.call( this, attachment );
					}
				},
				onSuccess: ( attachmentId ) => {
					this.activeUploads.delete( attachment.id );

					// Fetch full attachment data from REST API.
					window.wp
						.apiFetch( { path: `/wp/v2/media/${ attachmentId }` } )
						.then( ( data ) => {
							attachment.set( {
								...data,
								uploading: false,
								percent: 100,
							} );

							if ( this.options.success ) {
								this.options.success.call( this, attachment );
							}

							if ( this.options.complete ) {
								this.options.complete.call( this, attachment );
							}

							this.processQueue();
						} )
						.catch( ( error: Error ) => {
							this.handleError( attachment, error );
						} );
				},
				onError: ( error ) => {
					this.handleError( attachment, error as Error );
				},
			} );

			this.activeUploads.set( attachment.id, upload );

			// Check for previous uploads to resume.
			upload.findPreviousUploads().then( ( previousUploads ) => {
				if ( previousUploads.length > 0 ) {
					upload.resumeFromPreviousUpload( previousUploads[ 0 ] );
				}
				upload.start();
			} );
		},

		/**
		 * Handles upload errors.
		 * @param attachment
		 * @param error
		 */
		handleError(
			this: WPUploaderInstance,
			attachment: AttachmentModel,
			error: Error
		): void {
			this.activeUploads.delete( attachment.id );

			attachment.set( {
				uploading: false,
				error: error.message || 'Upload failed',
			} );

			if ( this.options.error ) {
				this.options.error.call( this, {
					message: error.message || 'Upload failed',
					file: attachment.file,
				} );
			}

			if ( this.options.complete ) {
				this.options.complete.call( this, attachment );
			}

			this.processQueue();
		},

		/**
		 * Aborts a specific upload.
		 * @param id
		 */
		abort( this: WPUploaderInstance, id: string ): void {
			const upload = this.activeUploads.get( id );
			if ( upload ) {
				upload.abort( true );
				this.activeUploads.delete( id );
			}
		},

		/**
		 * Aborts all uploads.
		 */
		abortAll( this: WPUploaderInstance ): void {
			this.activeUploads.forEach( ( upload ) => upload.abort( true ) );
			this.activeUploads.clear();
			this.queue = [];
		},
	};

	window.wp.Uploader = TusUploader;
}

// Initialize WordPress integration when DOM is ready.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', initTusUploader );
} else {
	initTusUploader();
}

/**
 * Tests for the Plupload TUS integration.
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// Mock tus-client module
vi.mock( '../../src/tus-client', () => ( {
	upload: vi.fn(),
} ) );

vi.mock( '@wordpress/hooks', () => ( {
	applyFilters: vi.fn( ( hookName, defaultValue ) => defaultValue ),
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text, domain ) => `[${ domain }] ${ text }`,
} ) );

import { applyFilters } from '@wordpress/hooks';
import { upload } from '../../src/tus-client';

// Capture the BeforeUpload handler when it's bound
let beforeUploadHandler;

// Mock plupload uploader instance
function createMockUploader() {
	return {
		bind: vi.fn( ( event, handler ) => {
			if ( event === 'BeforeUpload' ) {
				beforeUploadHandler = handler;
			}
		} ),
		trigger: vi.fn(),
		removeFile: vi.fn(),
		start: vi.fn(),
		_tusHooked: false,
	};
}

// Mock plupload file object
function createMockFile( nativeFile ) {
	return {
		getNative: vi.fn( () => nativeFile ),
		status: 1, // QUEUED
		loaded: 0,
		percent: 0,
	};
}

// Mock wp.media.model.Attachment model
let mockAttachmentModel;
function createMockAttachmentModel( legacyData ) {
	mockAttachmentModel = {
		fetch: vi.fn().mockResolvedValue(),
		toJSON: vi.fn( () => legacyData ),
	};
	return mockAttachmentModel;
}

// Setup wp and jQuery mocks
beforeAll( async () => {
	window.wp = {
		Uploader: vi.fn( function () {
			this.uploader = createMockUploader();
		} ),
		media: {
			// Core's memoized Attachment.get(), which uploads must not go through.
			attachment: vi.fn(),
			model: {
				Attachment: vi.fn( function () {
					return createMockAttachmentModel( {
						id: 123,
						title: 'Test',
						url: 'http://example.com/test.txt',
						icon: 'http://example.com/icon.png',
						sizes: {
							full: {
								url: 'http://example.com/test.txt',
								width: 100,
								height: 100,
							},
						},
					} );
				} ),
			},
		},
	};

	window.jQuery = vi.fn( () => ( {
		ready: vi.fn(),
	} ) );

	// Import to trigger init()
	await import( '../../src/plupload' );
} );

beforeEach( () => {
	vi.clearAllMocks();
	applyFilters.mockImplementation(
		( hookName, defaultValue ) => defaultValue
	);
	upload.mockResolvedValue( { id: 123 } );
} );

describe( 'init', () => {
	it( 'wraps wp.Uploader', () => {
		// After import, wp.Uploader should be the wrapped version
		expect( window.wp.Uploader ).toBeDefined();
	} );

	it( 'hooks plupload instances created by wp.Uploader', () => {
		const instance = new window.wp.Uploader();

		expect( instance.uploader._tusHooked ).toBe( true );
		expect( instance.uploader.bind ).toHaveBeenCalledWith(
			'BeforeUpload',
			expect.any( Function ),
			undefined,
			100
		);
	} );
} );

describe( 'handleBeforeUpload', () => {
	let uploader;

	beforeEach( () => {
		// Create a fresh uploader to capture the BeforeUpload handler
		beforeUploadHandler = undefined;
		uploader = createMockUploader();

		// Simulate hookPluploadInstance
		const instance = new window.wp.Uploader();
		// Get the handler from the hooked instance
		const bindCall = instance.uploader.bind.mock.calls.find(
			( call ) => call[ 0 ] === 'BeforeUpload'
		);
		beforeUploadHandler = bindCall[ 1 ];
	} );

	it( 'returns undefined when file has no getNative', () => {
		const file = { status: 1 };

		const result = beforeUploadHandler( uploader, file );

		expect( result ).toBeUndefined();
		expect( upload ).not.toHaveBeenCalled();
	} );

	it( 'returns undefined when getNative returns null', () => {
		const file = createMockFile( null );

		const result = beforeUploadHandler( uploader, file );

		expect( result ).toBeUndefined();
		expect( upload ).not.toHaveBeenCalled();
	} );

	it( 'returns false when TUS handles the upload', () => {
		const nativeFile = new File( [ 'test' ], 'test.txt', {
			type: 'text/plain',
		} );
		const file = createMockFile( nativeFile );

		const result = beforeUploadHandler( uploader, file );

		expect( result ).toBe( false );
		expect( upload ).toHaveBeenCalledWith(
			nativeFile,
			expect.objectContaining( {
				onProgress: expect.any( Function ),
			} )
		);
	} );

	it( 'keeps the file in the plupload queue as uploading', () => {
		const nativeFile = new File( [ 'test' ], 'test.txt', {
			type: 'text/plain',
		} );
		const file = createMockFile( nativeFile );

		beforeUploadHandler( uploader, file );

		expect( file.status ).toBe( 2 ); // UPLOADING
		expect( uploader.removeFile ).not.toHaveBeenCalled();
	} );

	it( 'passes native file to upload, not plupload wrapper', () => {
		const nativeFile = new File( [ 'test' ], 'test.txt', {
			type: 'text/plain',
		} );
		const file = createMockFile( nativeFile );

		beforeUploadHandler( uploader, file );

		expect( upload ).toHaveBeenCalledWith(
			nativeFile,
			expect.any( Object )
		);
	} );

	it( 'passes the post the media modal uploads to', () => {
		const nativeFile = new File( [ 'test' ], 'test.txt' );
		uploader.settings = { multipart_params: { post_id: 42 } };

		beforeUploadHandler( uploader, createMockFile( nativeFile ) );

		expect( upload ).toHaveBeenCalledWith(
			nativeFile,
			expect.objectContaining( { params: { post: 42 } } )
		);
	} );

	describe( 'onProgress callback', () => {
		it( 'updates file.attachment model when present', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			const mockModel = { set: vi.fn() };
			file.attachment = mockModel;

			upload.mockResolvedValue( { id: 123 } );

			beforeUploadHandler( uploader, file );

			// Get the onProgress from the upload call.
			const onProgress = upload.mock.calls[ 0 ][ 1 ].onProgress;
			onProgress( 50, 5000 );

			expect( file.loaded ).toBe( 5000 );
			expect( file.percent ).toBe( 50 );
			expect( mockModel.set ).toHaveBeenCalledWith( {
				loaded: 5000,
				percent: 50,
			} );
			expect( uploader.trigger ).toHaveBeenCalledWith(
				'UploadProgress',
				file
			);
		} );

		it( 'updates file without attachment model', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );
			// No file.attachment set.

			upload.mockResolvedValue( { id: 123 } );

			beforeUploadHandler( uploader, file );

			const onProgress = upload.mock.calls[ 0 ][ 1 ].onProgress;
			onProgress( 75, 7500 );

			expect( file.loaded ).toBe( 7500 );
			expect( file.percent ).toBe( 75 );
			expect( uploader.trigger ).toHaveBeenCalledWith(
				'UploadProgress',
				file
			);
		} );
	} );

	describe( 'upload success', () => {
		it( 'fetches legacy attachment data without caching the model', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			upload.mockResolvedValue( { id: 456 } );

			beforeUploadHandler( uploader, file );

			// Wait for the promise chain
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( window.wp.media.model.Attachment ).toHaveBeenCalledWith( {
				id: 456,
			} );
			expect( mockAttachmentModel.fetch ).toHaveBeenCalled();

			/*
			 * Attachment.get() caches by ID. A model cached here would win over
			 * the grid's model when core calls Attachment.get( id, file.attachment ).
			 */
			expect( window.wp.media.attachment ).not.toHaveBeenCalled();
		} );

		it( 'triggers FileUploaded with legacy format data', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			const legacyData = {
				id: 123,
				title: 'Test Image',
				sizes: {
					full: {
						url: 'http://example.com/test.jpg',
						width: 800,
						height: 600,
					},
				},
			};

			window.wp.media.model.Attachment.mockImplementationOnce(
				function () {
					return createMockAttachmentModel( legacyData );
				}
			);

			upload.mockResolvedValue( { id: 123 } );

			beforeUploadHandler( uploader, file );

			// Wait for the promise chain
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( file.status ).toBe( 5 ); // DONE
			expect( file.percent ).toBe( 100 );
			expect( uploader.trigger ).toHaveBeenCalledWith(
				'FileUploaded',
				file,
				{
					response: JSON.stringify( {
						success: true,
						data: legacyData,
					} ),
				}
			);
		} );

		it( 'triggers FileUploaded with the attachment ID on media-new.php', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			window.uploadSuccess = vi.fn();
			const mediaItems = document.createElement( 'div' );
			mediaItems.id = 'media-items';
			document.body.appendChild( mediaItems );

			upload.mockResolvedValue( { id: 789 } );

			beforeUploadHandler( uploader, file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			// handlers.js passes the response on to uploadSuccess().
			expect( uploader.trigger ).toHaveBeenCalledWith(
				'FileUploaded',
				file,
				{ response: '789' }
			);
			expect( file.status ).toBe( 5 ); // DONE
			// Should NOT fetch legacy data for media-new.php path
			expect( window.wp.media.attachment ).not.toHaveBeenCalled();

			delete window.uploadSuccess;
			document.body.removeChild( mediaItems );
		} );
	} );

	describe( 'upload error', () => {
		it( 'triggers a failed FileUploaded event on upload.php', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			upload.mockRejectedValue( new Error( 'Network error' ) );

			beforeUploadHandler( uploader, file );

			// Wait for the promise chain
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( file.status ).toBe( 4 ); // FAILED
			expect( uploader.trigger ).toHaveBeenCalledWith(
				'FileUploaded',
				file,
				{
					response: JSON.stringify( {
						success: false,
						data: { message: 'Network error', filename: file.name },
					} ),
				}
			);
		} );

		it( 'reports a translated fallback when the error has no message', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			upload.mockRejectedValue( new Error( '' ) );

			beforeUploadHandler( uploader, file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( uploader.trigger ).toHaveBeenCalledWith(
				'FileUploaded',
				file,
				{
					response: JSON.stringify( {
						success: false,
						data: {
							message: '[uploads-unleashed] Upload failed',
							filename: file.name,
						},
					} ),
				}
			);
		} );

		it( 'ignores wpFileError on upload.php', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			// handlers.js is loaded on upload.php too.
			window.wpFileError = vi.fn();
			upload.mockRejectedValue( new Error( 'Rejected' ) );

			beforeUploadHandler( uploader, file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( window.wpFileError ).not.toHaveBeenCalled();
			expect( uploader.trigger ).toHaveBeenCalledWith(
				'FileUploaded',
				file,
				expect.anything()
			);

			delete window.wpFileError;
		} );

		it( 'calls wpFileError on media-new.php', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			window.wpFileError = vi.fn();
			const mediaItems = document.createElement( 'div' );
			mediaItems.id = 'media-items';
			document.body.appendChild( mediaItems );
			upload.mockRejectedValue( new Error( 'Upload failed' ) );

			beforeUploadHandler( uploader, file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( window.wpFileError ).toHaveBeenCalledWith(
				file,
				'Upload failed'
			);

			delete window.wpFileError;
			document.body.removeChild( mediaItems );
		} );
	} );

	describe( 'extendWpUploader guard', () => {
		it( 'does not throw when wp.Uploader is missing', async () => {
			vi.resetModules();
			const originalUploader = window.wp.Uploader;
			delete window.wp.Uploader;
			window.jQuery = vi.fn( () => ( {
				ready: vi.fn(),
			} ) );

			await expect(
				import( '../../src/plupload' )
			).resolves.toBeDefined();

			window.wp.Uploader = originalUploader;
		} );
	} );

	describe( 'extendGlobalUploader via jQuery ready', () => {
		it( 'hooks global uploader when present', async () => {
			// Re-import to trigger init with a fresh jQuery mock.
			vi.resetModules();
			window.wp.Uploader = vi.fn( function () {
				this.uploader = createMockUploader();
			} );
			window.jQuery = vi.fn( () => ( {
				ready: vi.fn( ( fn ) => {
					// Simulate ready callback.
					const globalUp = createMockUploader();
					window.uploader = globalUp;
					fn();

					// Global uploader should be hooked.
					expect( globalUp._tusHooked ).toBe( true );

					delete window.uploader;
				} ),
			} ) );
			await import( '../../src/plupload' );
		} );
	} );

	describe( 'shouldUseTus filter', () => {
		it( 'skips TUS when filter returns false', () => {
			const nativeFile = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );
			const file = createMockFile( nativeFile );

			applyFilters.mockImplementation( ( hookName, defaultValue ) => {
				if ( hookName === 'uploadsUnleashed.shouldUseTus' ) {
					return false;
				}
				return defaultValue;
			} );

			const result = beforeUploadHandler( uploader, file );

			// Returns undefined (not false) to let plupload's default run
			expect( result ).toBeUndefined();
			expect( upload ).not.toHaveBeenCalled();
			expect( uploader.removeFile ).not.toHaveBeenCalled();
		} );

		it( 'uses TUS when filter returns true', () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			const result = beforeUploadHandler( uploader, file );

			expect( result ).toBe( false );
			expect( upload ).toHaveBeenCalled();
		} );

		it( 'passes native file to the filter', () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			beforeUploadHandler( uploader, file );

			expect( applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.shouldUseTus',
				true,
				nativeFile
			);
		} );
	} );
} );

describe( 'upload queue', () => {
	/**
	 * Plupload's uploader states.
	 *
	 * @see https://www.plupload.com/docs/v2/Uploader#state-property
	 */
	const STOPPED = 1;
	const STARTED = 2;

	let tusHandler;
	let pending;
	let events;

	/**
	 * Creates a fake uploader that mirrors plupload 2's queue handling.
	 *
	 * Like plupload, it only moves on to the next file from start() while
	 * stopped and from its own FileUploaded handler, resets uploading files
	 * when stopped, and fires UploadComplete once every file is done or failed.
	 *
	 * @return {Object} Fake plupload uploader.
	 */
	function createQueueUploader() {
		const handlers = {};
		const up = {
			state: STOPPED,
			files: [],
			bind( event, handler ) {
				( handlers[ event ] = handlers[ event ] || [] ).push( handler );
			},
			trigger( event, ...args ) {
				events.push(
					'FileUploaded' === event
						? `${ event }:${ args[ 0 ].name }`
						: event
				);
				return ( handlers[ event ] || [] ).every(
					( handler ) => false !== handler( up, ...args )
				);
			},
			start() {
				if ( up.state !== STARTED ) {
					up.state = STARTED;
					up.trigger( 'StateChanged' );
					uploadNext();
				}
			},
			stop() {
				if ( up.state !== STOPPED ) {
					up.state = STOPPED;
					up.trigger( 'StateChanged' );
					up.trigger( 'CancelUpload' );
				}
			},
			removeFile( file ) {
				up.files.splice( up.files.indexOf( file ), 1 );
			},
			addFiles( names ) {
				names.forEach( ( name ) => {
					const file = createMockFile(
						new File( [ name ], name, { type: 'text/plain' } )
					);
					file.name = name;
					up.files.push( file );
				} );
				up.start();
			},
		};

		/**
		 * Starts the first queued file, or completes the queue.
		 */
		function uploadNext() {
			let file;
			let count = 0;

			if ( up.state !== STARTED ) {
				return;
			}

			for ( let i = 0; i < up.files.length; i++ ) {
				if ( ! file && 1 === up.files[ i ].status ) {
					file = up.files[ i ];
					if ( up.trigger( 'BeforeUpload', file ) ) {
						file.status = 2;
						up.trigger( 'UploadFile', file );
					}
				} else {
					count++;
				}
			}

			if ( count === up.files.length ) {
				up.state = STOPPED;
				up.trigger( 'StateChanged' );
				up.trigger( 'UploadComplete', up.files );
			}
		}

		up.bind( 'BeforeUpload', tusHandler );
		up.bind( 'StateChanged', () => {
			if ( up.state === STOPPED ) {
				up.files
					.filter( ( file ) => 2 === file.status )
					.forEach( ( file ) => ( file.status = 1 ) );
			}
		} );
		up.bind( 'FileUploaded', () => {
			setTimeout( uploadNext, 1 );
		} );

		return up;
	}

	/**
	 * Returns how often UploadComplete fired.
	 *
	 * @return {number} Number of UploadComplete events.
	 */
	const uploadCompleteCount = () =>
		events.filter( ( event ) => 'UploadComplete' === event ).length;

	/**
	 * Settles the oldest pending TUS upload and lets the queue react.
	 *
	 * @param {Error} [error] Rejects the upload with this error when given.
	 */
	async function settleNext( error ) {
		const { resolve, reject } = pending.shift();
		if ( error ) {
			reject( error );
		} else {
			resolve( { id: 123 } );
		}
		await new Promise( ( done ) => setTimeout( done, 10 ) );
	}

	beforeEach( () => {
		pending = [];
		events = [];
		upload.mockImplementation(
			() =>
				new Promise( ( resolve, reject ) =>
					pending.push( { resolve, reject } )
				)
		);

		const instance = new window.wp.Uploader();
		tusHandler = instance.uploader.bind.mock.calls.find(
			( call ) => call[ 0 ] === 'BeforeUpload'
		)[ 1 ];
	} );

	describe( 'on upload.php', () => {
		it( 'uploads queued files one after another', async () => {
			const up = createQueueUploader();
			up.addFiles( [ 'a.txt', 'b.txt', 'c.txt' ] );

			expect( upload ).toHaveBeenCalledTimes( 1 );
			expect( up.files.map( ( file ) => file.status ) ).toEqual( [
				2, 1, 1,
			] );

			await settleNext();
			expect( upload ).toHaveBeenCalledTimes( 2 );

			await settleNext( new Error( 'Rejected' ) );
			expect( upload ).toHaveBeenCalledTimes( 3 );

			await settleNext();
			expect( up.files.map( ( file ) => file.status ) ).toEqual( [
				5, 4, 5,
			] );
			expect( up.state ).toBe( STOPPED );
		} );

		it( 'fires UploadComplete once, after the last upload finishes', async () => {
			const up = createQueueUploader();
			up.addFiles( [ 'a.txt', 'b.txt' ] );

			await settleNext();
			await settleNext();

			expect(
				events.filter(
					( event ) =>
						event.startsWith( 'FileUploaded' ) ||
						'UploadComplete' === event
				)
			).toEqual( [
				'FileUploaded:a.txt',
				'FileUploaded:b.txt',
				'UploadComplete',
			] );
		} );

		it( 'does not fire UploadComplete while the only upload is running', async () => {
			const up = createQueueUploader();
			up.addFiles( [ 'a.txt' ] );
			await new Promise( ( done ) => setTimeout( done, 10 ) );

			expect( uploadCompleteCount() ).toBe( 0 );

			await settleNext();
			expect( uploadCompleteCount() ).toBe( 1 );
		} );
	} );

	describe( 'on media-new.php', () => {
		let mediaItems;

		/**
		 * Creates a fake uploader wired up the way handlers.js does it.
		 *
		 * @return {Object} Fake plupload uploader.
		 */
		function createMediaNewUploader() {
			const up = createQueueUploader();
			up.bind( 'FileUploaded', ( _up, file, response ) =>
				window.uploadSuccess( file, response.response )
			);
			return up;
		}

		beforeEach( () => {
			window.uploadSuccess = vi.fn();
			window.wpFileError = vi.fn();
			mediaItems = document.createElement( 'div' );
			mediaItems.id = 'media-items';
			document.body.appendChild( mediaItems );
		} );

		afterEach( () => {
			delete window.uploadSuccess;
			delete window.wpFileError;
			mediaItems.remove();
		} );

		it( 'uploads every queued file', async () => {
			const up = createMediaNewUploader();
			up.addFiles( [ 'a.txt', 'b.txt' ] );

			await settleNext();
			expect( upload ).toHaveBeenCalledTimes( 2 );

			await settleNext();
			expect( window.uploadSuccess ).toHaveBeenCalledTimes( 2 );
			expect( window.uploadSuccess ).toHaveBeenCalledWith(
				up.files[ 1 ],
				'123'
			);
			expect( up.state ).toBe( STOPPED );
			expect( uploadCompleteCount() ).toBe( 1 );
		} );

		it( 'moves on to the next file after a failed upload', async () => {
			const up = createMediaNewUploader();
			up.addFiles( [ 'a.txt', 'b.txt' ] );

			await settleNext( new Error( 'Rejected' ) );
			expect( window.wpFileError ).toHaveBeenCalledWith(
				up.files[ 0 ],
				'Rejected'
			);
			expect( upload ).toHaveBeenCalledTimes( 2 );

			await settleNext();
			expect( window.uploadSuccess ).toHaveBeenCalledTimes( 1 );
			expect( up.files.map( ( file ) => file.status ) ).toEqual( [
				4, 5,
			] );
			expect( uploadCompleteCount() ).toBe( 1 );
		} );

		it( 'completes the queue when the last upload fails', async () => {
			const up = createMediaNewUploader();
			up.addFiles( [ 'a.txt' ] );

			await settleNext( new Error( 'Rejected' ) );
			expect( up.state ).toBe( STOPPED );
			expect( uploadCompleteCount() ).toBe( 1 );
		} );

		it( 'starts files added after the queue finished', async () => {
			const up = createMediaNewUploader();
			up.addFiles( [ 'a.txt' ] );
			await settleNext();

			up.addFiles( [ 'b.txt' ] );
			expect( upload ).toHaveBeenCalledTimes( 2 );

			await settleNext();
			expect( window.uploadSuccess ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'picks up files added while an upload is running', async () => {
			const up = createMediaNewUploader();
			up.addFiles( [ 'a.txt' ] );
			up.addFiles( [ 'b.txt' ] );
			expect( upload ).toHaveBeenCalledTimes( 1 );

			await settleNext();
			expect( upload ).toHaveBeenCalledTimes( 2 );

			await settleNext();
			expect( window.uploadSuccess ).toHaveBeenCalledTimes( 2 );
		} );
	} );
} );

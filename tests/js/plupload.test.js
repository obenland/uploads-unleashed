/**
 * Tests for the Plupload TUS integration.
 */

// Mock tus-client module
jest.mock( '../../src/tus-client', () => ( {
	upload: jest.fn(),
} ) );

import { upload } from '../../src/tus-client';

// Capture the BeforeUpload handler when it's bound
let beforeUploadHandler;

// Mock plupload uploader instance
function createMockUploader() {
	return {
		bind: jest.fn( ( event, handler ) => {
			if ( event === 'BeforeUpload' ) {
				beforeUploadHandler = handler;
			}
		} ),
		trigger: jest.fn(),
		removeFile: jest.fn(),
		start: jest.fn(),
		_tusHooked: false,
	};
}

// Mock plupload file object
function createMockFile( nativeFile ) {
	return {
		getNative: jest.fn( () => nativeFile ),
		status: 1, // QUEUED
		loaded: 0,
		percent: 0,
	};
}

// Mock wp.media.attachment model
let mockAttachmentModel;
function createMockAttachmentModel( legacyData ) {
	mockAttachmentModel = {
		fetch: jest.fn().mockResolvedValue(),
		toJSON: jest.fn( () => legacyData ),
	};
	return mockAttachmentModel;
}

// Setup wp and jQuery mocks
beforeAll( () => {
	window.wp = {
		Uploader: jest.fn( function () {
			this.uploader = createMockUploader();
		} ),
		hooks: {
			applyFilters: jest.fn( ( hookName, defaultValue ) => defaultValue ),
		},
		media: {
			attachment: jest.fn( () =>
				createMockAttachmentModel( {
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
				} )
			),
		},
	};

	window.jQuery = jest.fn( () => ( {
		ready: jest.fn(),
	} ) );

	// Import to trigger init()
	require( '../../src/plupload' );
} );

beforeEach( () => {
	jest.clearAllMocks();
	window.wp.hooks.applyFilters.mockImplementation(
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

	it( 'removes file from plupload queue', () => {
		const nativeFile = new File( [ 'test' ], 'test.txt', {
			type: 'text/plain',
		} );
		const file = createMockFile( nativeFile );

		beforeUploadHandler( uploader, file );

		expect( uploader.removeFile ).toHaveBeenCalledWith( file );
	} );

	it( 'triggers next file in queue', () => {
		jest.useFakeTimers();

		const nativeFile = new File( [ 'test' ], 'test.txt', {
			type: 'text/plain',
		} );
		const file = createMockFile( nativeFile );

		beforeUploadHandler( uploader, file );

		jest.runAllTimers();
		expect( uploader.start ).toHaveBeenCalled();

		jest.useRealTimers();
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

	describe( 'upload success', () => {
		it( 'fetches legacy attachment data via wp.media.attachment', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			upload.mockResolvedValue( { id: 456 } );

			beforeUploadHandler( uploader, file );

			// Wait for the promise chain
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( window.wp.media.attachment ).toHaveBeenCalledWith( 456 );
			expect( mockAttachmentModel.fetch ).toHaveBeenCalled();
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

			window.wp.media.attachment.mockReturnValue(
				createMockAttachmentModel( legacyData )
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

		it( 'calls uploadSuccess on media-new.php', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			window.uploadSuccess = jest.fn();
			const mediaItems = document.createElement( 'div' );
			mediaItems.id = 'media-items';
			document.body.appendChild( mediaItems );

			upload.mockResolvedValue( { id: 789 } );

			beforeUploadHandler( uploader, file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( window.uploadSuccess ).toHaveBeenCalledWith( file, '789' );
			// Should NOT fetch legacy data for media-new.php path
			expect( window.wp.media.attachment ).not.toHaveBeenCalled();

			delete window.uploadSuccess;
			document.body.removeChild( mediaItems );
		} );
	} );

	describe( 'upload error', () => {
		it( 'triggers Error event on failure', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			upload.mockRejectedValue( new Error( 'Network error' ) );

			beforeUploadHandler( uploader, file );

			// Wait for the promise chain
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( file.status ).toBe( 4 ); // FAILED
			expect( uploader.trigger ).toHaveBeenCalledWith( 'Error', {
				code: -200,
				message: 'Network error',
				file,
			} );
		} );

		it( 'calls wpFileError on media-new.php', async () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			window.wpFileError = jest.fn();
			upload.mockRejectedValue( new Error( 'Upload failed' ) );

			beforeUploadHandler( uploader, file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( window.wpFileError ).toHaveBeenCalledWith(
				file,
				'Upload failed'
			);

			delete window.wpFileError;
		} );
	} );

	describe( 'shouldUseTus filter', () => {
		it( 'skips TUS when filter returns false', () => {
			const nativeFile = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );
			const file = createMockFile( nativeFile );

			window.wp.hooks.applyFilters.mockImplementation(
				( hookName, defaultValue ) => {
					if ( hookName === 'uploadsUnleashed.shouldUseTus' ) {
						return false;
					}
					return defaultValue;
				}
			);

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

			expect( window.wp.hooks.applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.shouldUseTus',
				true,
				nativeFile
			);
		} );

		it( 'defaults to TUS when wp.hooks is unavailable', () => {
			const nativeFile = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const file = createMockFile( nativeFile );

			const originalHooks = window.wp.hooks;
			window.wp.hooks = undefined;

			const result = beforeUploadHandler( uploader, file );

			expect( result ).toBe( false );
			expect( upload ).toHaveBeenCalled();

			window.wp.hooks = originalHooks;
		} );
	} );
} );

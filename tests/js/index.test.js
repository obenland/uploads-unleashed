/**
 * Tests for the TUS uploader core module.
 */

import { createUpload, uploadFile, abortUpload } from '../../src/index';
import * as tus from 'tus-js-client';

// Mock tus-js-client
jest.mock( 'tus-js-client', () => {
	const mockUpload = {
		start: jest.fn(),
		abort: jest.fn().mockResolvedValue( undefined ),
		findPreviousUploads: jest.fn().mockResolvedValue( [] ),
		resumeFromPreviousUpload: jest.fn(),
	};

	return {
		Upload: jest.fn().mockImplementation( () => mockUpload ),
	};
} );

// Setup window.resumableUploads
beforeEach( () => {
	window.resumableUploads = {
		endpoint: '/wp-json/wp/v2/media/tus',
		nonce: 'test-nonce',
	};
	jest.clearAllMocks();
} );

describe( 'createUpload', () => {
	it( 'creates a TUS upload instance', () => {
		const file = new File( [ 'test content' ], 'test.txt', {
			type: 'text/plain',
		} );

		const upload = createUpload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				endpoint: '/wp-json/wp/v2/media/tus',
				headers: { 'X-WP-Nonce': 'test-nonce' },
				metadata: {
					filename: 'test.txt',
					filetype: 'text/plain',
				},
			} )
		);
		expect( upload ).toBeDefined();
	} );

	it( 'uses default chunk size of 5MB', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		createUpload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				chunkSize: 5 * 1024 * 1024,
			} )
		);
	} );

	it( 'allows custom chunk size', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		createUpload( file, { chunkSize: 1024 * 1024 } );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				chunkSize: 1024 * 1024,
			} )
		);
	} );

	it( 'sets retry delays', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		createUpload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				retryDelays: [ 0, 1000, 3000, 5000, 10000 ],
			} )
		);
	} );

	it( 'sets removeFingerprintOnSuccess to true by default', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		createUpload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				removeFingerprintOnSuccess: true,
			} )
		);
	} );

	it( 'uses application/octet-stream for files without type', () => {
		const file = new File( [ 'binary' ], 'unknown.bin' );
		// Force no type
		Object.defineProperty( file, 'type', { value: '' } );

		createUpload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				metadata: {
					filename: 'unknown.bin',
					filetype: 'application/octet-stream',
				},
			} )
		);
	} );

	it( 'accepts custom onProgress callback', () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const onProgress = jest.fn();

		createUpload( file, { onProgress } );

		// Verify the callback was passed
		const callArgs = tus.Upload.mock.calls[ 0 ][ 1 ];
		expect( callArgs.onProgress ).toBeDefined();
	} );

	it( 'accepts custom onError callback', () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const onError = jest.fn();

		createUpload( file, { onError } );

		const callArgs = tus.Upload.mock.calls[ 0 ][ 1 ];
		expect( callArgs.onError ).toBeDefined();
	} );
} );

describe( 'uploadFile', () => {
	it( 'returns a promise', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const result = uploadFile( file );

		expect( result ).toBeInstanceOf( Promise );
	} );

	it( 'starts the upload', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		// Start upload but don't wait for completion
		uploadFile( file );

		// Wait for findPreviousUploads to complete
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
		expect( mockUpload?.start ).toHaveBeenCalled();
	} );

	it( 'checks for previous uploads to resume', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		uploadFile( file );

		// Wait for async operations
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
		expect( mockUpload?.findPreviousUploads ).toHaveBeenCalled();
	} );
} );

describe( 'abortUpload', () => {
	it( 'calls abort on the upload with cleanup flag', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const upload = createUpload( file );

		await abortUpload( upload );

		expect( upload.abort ).toHaveBeenCalledWith( true );
	} );

	it( 'returns a promise', () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const upload = createUpload( file );

		const result = abortUpload( upload );

		expect( result ).toBeInstanceOf( Promise );
	} );
} );

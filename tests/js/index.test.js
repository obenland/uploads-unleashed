/**
 * Tests for the TUS uploader core module.
 */

import { createUpload, uploadFile, abortUpload } from '../../src/index';
import * as tus from 'tus-js-client';

// Store callbacks for testing
let capturedCallbacks = {};

// Mock tus-js-client
jest.mock( 'tus-js-client', () => {
	const mockUpload = {
		start: jest.fn(),
		abort: jest.fn().mockResolvedValue( undefined ),
		findPreviousUploads: jest.fn().mockResolvedValue( [] ),
		resumeFromPreviousUpload: jest.fn(),
	};

	return {
		Upload: jest.fn().mockImplementation( ( file, options ) => {
			// Capture callbacks for testing
			capturedCallbacks = {
				onProgress: options.onProgress,
				onSuccess: options.onSuccess,
				onError: options.onError,
			};
			return mockUpload;
		} ),
	};
} );

// Setup window.resumableUploads
beforeEach( () => {
	window.resumableUploads = {
		endpoint: '/wp-json/wp/v2/media/tus',
		nonce: 'test-nonce',
	};
	capturedCallbacks = {};
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

	it( 'uses default endpoint when window.resumableUploads is not set', () => {
		window.resumableUploads = undefined;
		const file = new File( [ 'test' ], 'test.txt' );

		createUpload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				endpoint: '/wp-json/wp/v2/media/tus',
				headers: { 'X-WP-Nonce': '' },
			} )
		);
	} );

	describe( 'onProgress callback', () => {
		it( 'calculates percentage and calls user callback', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onProgress = jest.fn();

			createUpload( file, { onProgress } );

			// Simulate progress
			capturedCallbacks.onProgress( 500, 1000 );

			expect( onProgress ).toHaveBeenCalledWith( '50.00', 500, 1000 );
		} );

		it( 'works without user callback', () => {
			const file = new File( [ 'test' ], 'test.txt' );

			createUpload( file );

			// Should not throw
			expect( () => {
				capturedCallbacks.onProgress( 500, 1000 );
			} ).not.toThrow();
		} );
	} );

	describe( 'onSuccess callback', () => {
		it( 'parses attachment data from response body', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onSuccess = jest.fn();
			const attachmentData = { id: 123, title: { rendered: 'Test' } };

			createUpload( file, { onSuccess } );

			const mockPayload = {
				lastResponse: {
					getStatus: () => 200,
					getBody: () => JSON.stringify( attachmentData ),
				},
			};

			capturedCallbacks.onSuccess( mockPayload );

			expect( onSuccess ).toHaveBeenCalledWith(
				attachmentData,
				expect.anything()
			);
		} );

		it( 'handles empty response body', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onSuccess = jest.fn();

			createUpload( file, { onSuccess } );

			const mockPayload = {
				lastResponse: {
					getStatus: () => 200,
					getBody: () => null,
				},
			};

			capturedCallbacks.onSuccess( mockPayload );

			expect( onSuccess ).toHaveBeenCalledWith( null, expect.anything() );
		} );

		it( 'handles invalid JSON in response body', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onSuccess = jest.fn();

			createUpload( file, { onSuccess } );

			const mockPayload = {
				lastResponse: {
					getStatus: () => 200,
					getBody: () => 'not valid json',
				},
			};

			capturedCallbacks.onSuccess( mockPayload );

			expect( onSuccess ).toHaveBeenCalledWith( null, expect.anything() );
		} );

		it( 'calls onError for error status codes', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();
			const onSuccess = jest.fn();

			createUpload( file, { onError, onSuccess } );

			const mockPayload = {
				lastResponse: {
					getStatus: () => 400,
					getBody: () => JSON.stringify( { message: 'Bad request' } ),
				},
			};

			capturedCallbacks.onSuccess( mockPayload );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'Bad request' } )
			);
			expect( onSuccess ).not.toHaveBeenCalled();
		} );

		it( 'uses default error message for error status without message', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();

			createUpload( file, { onError } );

			const mockPayload = {
				lastResponse: {
					getStatus: () => 500,
					getBody: () => null,
				},
			};

			capturedCallbacks.onSuccess( mockPayload );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'Upload failed' } )
			);
		} );
	} );

	describe( 'onError callback', () => {
		it( 'calls user callback with error', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();

			createUpload( file, { onError } );

			const error = new Error( 'Network error' );
			capturedCallbacks.onError( error );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'Network error' } )
			);
		} );

		it( 'extracts WordPress error message from TUS DetailedError', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();

			createUpload( file, { onError } );

			const detailedError = {
				message: 'TUS error',
				originalResponse: {
					getBody: () =>
						JSON.stringify( { message: 'WordPress error message' } ),
				},
			};

			capturedCallbacks.onError( detailedError );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'WordPress error message' } )
			);
		} );

		it( 'handles missing originalResponse body', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();

			createUpload( file, { onError } );

			const detailedError = {
				message: 'TUS error',
				originalResponse: {
					getBody: () => null,
				},
			};

			capturedCallbacks.onError( detailedError );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'TUS error' } )
			);
		} );

		it( 'handles invalid JSON in originalResponse', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();

			createUpload( file, { onError } );

			const detailedError = {
				message: 'TUS error',
				originalResponse: {
					getBody: () => 'not json',
				},
			};

			capturedCallbacks.onError( detailedError );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'TUS error' } )
			);
		} );

		it( 'uses default message when error has no message', () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onError = jest.fn();

			createUpload( file, { onError } );

			capturedCallbacks.onError( {} );

			expect( onError ).toHaveBeenCalledWith(
				expect.objectContaining( { message: 'Upload failed' } )
			);
		} );
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

	it( 'resumes from previous upload when available', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const previousUpload = { uploadUrl: '/previous' };

		// Create the upload first to get the mock instance
		uploadFile( file );

		// Get the mock upload instance that was just created
		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;

		// Reconfigure findPreviousUploads for next call
		mockUpload.findPreviousUploads.mockResolvedValueOnce( [ previousUpload ] );

		// Create another upload that will use the reconfigured mock
		uploadFile( file );

		// Wait for async operations
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( mockUpload?.resumeFromPreviousUpload ).toHaveBeenCalledWith(
			previousUpload
		);
	} );

	it( 'resolves with attachment data on success', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const attachmentData = { id: 123 };

		const promise = uploadFile( file );

		// Wait for upload to start
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Trigger success
		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => JSON.stringify( attachmentData ),
			},
		} );

		const result = await promise;
		expect( result.attachment ).toEqual( attachmentData );
		expect( result.upload ).toBeDefined();
	} );

	it( 'calls user onSuccess callback', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const onSuccess = jest.fn();
		const attachmentData = { id: 123 };

		const promise = uploadFile( file, { onSuccess } );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => JSON.stringify( attachmentData ),
			},
		} );

		await promise;
		expect( onSuccess ).toHaveBeenCalledWith(
			attachmentData,
			expect.anything()
		);
	} );

	it( 'rejects on error', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = uploadFile( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onError( new Error( 'Upload failed' ) );

		await expect( promise ).rejects.toThrow( 'Upload failed' );
	} );

	it( 'calls user onError callback', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const onError = jest.fn();

		const promise = uploadFile( file, { onError } );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onError( new Error( 'Upload failed' ) );

		try {
			await promise;
		} catch {
			// Expected to reject
		}

		expect( onError ).toHaveBeenCalled();
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

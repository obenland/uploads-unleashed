/**
 * Tests for the TUS uploader core module.
 */

import { upload, abort } from '../../src/tus-client';
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

// Setup window.uploadsUnleashed
beforeEach( () => {
	window.uploadsUnleashed = {
		endpoint: '/wp-json/wp/v2/media',
		nonce: 'test-nonce',
	};
	capturedCallbacks = {};
	jest.clearAllMocks();
} );

describe( 'upload', () => {
	it( 'creates a TUS upload instance with correct options', () => {
		const file = new File( [ 'test content' ], 'test.txt', {
			type: 'text/plain',
		} );

		upload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				endpoint: '/wp-json/wp/v2/media',
				headers: { 'X-WP-Nonce': 'test-nonce' },
				metadata: {
					filename: 'test.txt',
					filetype: 'text/plain',
				},
			} )
		);
	} );

	it( 'uses fixed 5MB chunk size', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				chunkSize: 5 * 1024 * 1024,
			} )
		);
	} );

	it( 'sets retry delays', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				retryDelays: [ 0, 1000, 3000, 5000, 10000 ],
			} )
		);
	} );

	it( 'sets removeFingerprintOnSuccess to true', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				removeFingerprintOnSuccess: true,
			} )
		);
	} );

	it( 'generates fingerprint from file metadata and endpoint', async () => {
		const file = new File( [ 'test' ], 'my file.txt', {
			type: 'text/plain',
		} );
		Object.defineProperty( file, 'size', { value: 2048 } );
		Object.defineProperty( file, 'lastModified', { value: 99999 } );

		upload( file );

		const fingerprintFn = tus.Upload.mock.calls[ 0 ][ 1 ].fingerprint;
		const result = await fingerprintFn( file, {
			endpoint: '/wp-json/wp/v2/media',
		} );

		expect( result ).toBe(
			'tus-br|my%20file.txt|2048|99999|/wp-json/wp/v2/media'
		);
	} );

	it( 'uses application/octet-stream for files without type', () => {
		const file = new File( [ 'binary' ], 'unknown.bin' );
		// Force no type
		Object.defineProperty( file, 'type', { value: '' } );

		upload( file );

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

	it( 'uses default endpoint when window.uploadsUnleashed is not set', () => {
		window.uploadsUnleashed = undefined;
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				endpoint: '/wp-json/wp/v2/media',
				headers: { 'X-WP-Nonce': '' },
			} )
		);
	} );

	it( 'starts the upload', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		// Wait for findPreviousUploads to complete
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
		expect( mockUpload?.start ).toHaveBeenCalled();
	} );

	it( 'checks for previous uploads to resume', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		// Wait for async operations
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
		expect( mockUpload?.findPreviousUploads ).toHaveBeenCalled();
	} );

	it( 'resumes from previous upload when available', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const previousUploadData = { uploadUrl: '/previous' };

		// Create the upload first to get the mock instance
		upload( file );

		// Get the mock upload instance that was just created
		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;

		// Reconfigure findPreviousUploads for next call
		mockUpload.findPreviousUploads.mockResolvedValueOnce( [
			previousUploadData,
		] );

		// Create another upload that will use the reconfigured mock
		upload( file );

		// Wait for async operations
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( mockUpload?.resumeFromPreviousUpload ).toHaveBeenCalledWith(
			previousUploadData
		);
	} );

	it( 'resolves with attachment data on success', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const attachmentData = { id: 123, title: { rendered: 'Test' } };

		const promise = upload( file );

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
		expect( result ).toEqual( attachmentData );
	} );

	it( 'rejects when no attachment data in response', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = upload( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => null,
			},
		} );

		await expect( promise ).rejects.toThrow(
			'Upload completed but no attachment data received'
		);
	} );

	it( 'rejects when response body is invalid JSON', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = upload( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => 'not valid json',
			},
		} );

		await expect( promise ).rejects.toThrow(
			'Upload completed but no attachment data received'
		);
	} );

	it( 'rejects on error status codes', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = upload( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 400,
				getBody: () => JSON.stringify( { message: 'Bad request' } ),
			},
		} );

		await expect( promise ).rejects.toThrow( 'Bad request' );
	} );

	it( 'uses default error message for error status without body', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = upload( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 500,
				getBody: () => null,
			},
		} );

		await expect( promise ).rejects.toThrow( 'Upload failed' );
	} );

	describe( 'onProgress callback', () => {
		it( 'calls onProgress with percent and bytes', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const onProgress = jest.fn();

			upload( file, { onProgress } );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			// Simulate progress: 500 of 1000 bytes
			capturedCallbacks.onProgress( 500, 1000 );

			expect( onProgress ).toHaveBeenCalledWith( 50, 500, 1000 );
		} );

		it( 'works without onProgress callback', () => {
			const file = new File( [ 'test' ], 'test.txt' );

			upload( file );

			// Should not throw
			expect( () => {
				capturedCallbacks.onProgress( 500, 1000 );
			} ).not.toThrow();
		} );
	} );

	describe( 'onError callback', () => {
		it( 'rejects on upload error', async () => {
			const file = new File( [ 'test' ], 'test.txt' );

			const promise = upload( file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			capturedCallbacks.onError( new Error( 'Network error' ) );

			await expect( promise ).rejects.toThrow( 'Network error' );
		} );

		it( 'extracts WordPress error message from TUS DetailedError', async () => {
			const file = new File( [ 'test' ], 'test.txt' );

			const promise = upload( file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			const detailedError = {
				message: 'TUS error',
				originalResponse: {
					getBody: () =>
						JSON.stringify( {
							message: 'WordPress error message',
						} ),
				},
			};

			capturedCallbacks.onError( detailedError );

			await expect( promise ).rejects.toThrow(
				'WordPress error message'
			);
		} );

		it( 'handles missing originalResponse body', async () => {
			const file = new File( [ 'test' ], 'test.txt' );

			const promise = upload( file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			const detailedError = {
				message: 'TUS error',
				originalResponse: {
					getBody: () => null,
				},
			};

			capturedCallbacks.onError( detailedError );

			await expect( promise ).rejects.toThrow( 'TUS error' );
		} );

		it( 'handles invalid JSON in originalResponse', async () => {
			const file = new File( [ 'test' ], 'test.txt' );

			const promise = upload( file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			const detailedError = {
				message: 'TUS error',
				originalResponse: {
					getBody: () => 'not json',
				},
			};

			capturedCallbacks.onError( detailedError );

			await expect( promise ).rejects.toThrow( 'TUS error' );
		} );

		it( 'uses default message when error has no message', async () => {
			const file = new File( [ 'test' ], 'test.txt' );

			const promise = upload( file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			capturedCallbacks.onError( {} );

			await expect( promise ).rejects.toThrow( 'Upload failed' );
		} );
	} );

	describe( 'AbortSignal', () => {
		it( 'rejects immediately with already-aborted signal', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const controller = new AbortController();
			controller.abort();

			await expect(
				upload( file, { signal: controller.signal } )
			).rejects.toThrow( 'Upload aborted' );
		} );

		it( 'aborts upload when signal is triggered', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const controller = new AbortController();

			const promise = upload( file, { signal: controller.signal } );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			controller.abort();

			const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
			expect( mockUpload.abort ).toHaveBeenCalledWith( true );

			await expect( promise ).rejects.toThrow( 'Upload aborted' );
		} );
	} );
} );

describe( 'abort', () => {
	it( 'calls abort with cleanup flag', async () => {
		const mockTusUpload = {
			abort: jest.fn().mockResolvedValue( undefined ),
		};

		await abort( mockTusUpload );

		expect( mockTusUpload.abort ).toHaveBeenCalledWith( true );
	} );

	it( 'returns a promise', () => {
		const mockTusUpload = {
			abort: jest.fn().mockResolvedValue( undefined ),
		};

		const result = abort( mockTusUpload );

		expect( result ).toBeInstanceOf( Promise );
	} );
} );

describe( 'settled guard', () => {
	it( 'ignores onSuccess after onError', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = upload( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Trigger error first.
		capturedCallbacks.onError( new Error( 'fail' ) );

		// Second onSuccess should be ignored (line 300).
		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => JSON.stringify( { id: 1 } ),
			},
		} );

		await expect( promise ).rejects.toThrow( 'fail' );
	} );

	it( 'ignores onError after onSuccess', async () => {
		const file = new File( [ 'test' ], 'test.txt' );

		const promise = upload( file );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Trigger success first.
		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => JSON.stringify( { id: 1 } ),
			},
		} );

		// Second onError should be ignored (line 315).
		capturedCallbacks.onError( new Error( 'late error' ) );

		const result = await promise;
		expect( result ).toEqual( { id: 1 } );
	} );
} );

describe( 'getPendingUploads', () => {
	beforeEach( () => {
		localStorage.clear();
	} );

	it( 'returns empty array when no pending uploads', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		expect( getPendingUploads() ).toEqual( [] );
	} );

	it( 'returns entries matching current endpoint', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem(
			key,
			JSON.stringify( { uploadUrl: '/wp-json/wp/v2/media/abc' } )
		);

		const result = getPendingUploads();
		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ].key ).toBe( key );
		expect( result[ 0 ].uploadUrl ).toBe( '/wp-json/wp/v2/media/abc' );
		expect( result[ 0 ].filename ).toBe( 'test.txt' );
		expect( result[ 0 ].size ).toBe( 1024 );
	} );

	it( 'filters out entries for different endpoints', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const futureExpiry = Date.now() + 86400000;
		const fp = `tus-br|test.txt|1024|12345|/other-endpoint`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem(
			key,
			JSON.stringify( { uploadUrl: '/other-endpoint/abc' } )
		);

		expect( getPendingUploads() ).toEqual( [] );
	} );

	it( 'cleans up expired entries', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const pastExpiry = Date.now() - 1000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }`;
		const key = `tus::${ fp }::${ pastExpiry }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const result = getPendingUploads();
		expect( result ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'cleans up malformed entries with wrong key format', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const endpoint = '/wp-json/wp/v2/media';
		// Only 3 parts instead of 4.
		const key = `tus::tus-br|test.txt|1024|12345|${ endpoint }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		getPendingUploads();
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'cleans up entries with invalid JSON', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem( key, 'not valid json{' );

		const result = getPendingUploads();
		expect( result ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'cleans up entries with wrong fingerprint part count', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		// Fingerprint with only 3 parts instead of 5.
		const fp = `tus-br|test.txt|${ endpoint }`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const result = getPendingUploads();
		expect( result ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'URL-decodes filenames', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|my%20file%20(1).txt|1024|12345|${ endpoint }`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const result = getPendingUploads();
		expect( result[ 0 ].filename ).toBe( 'my file (1).txt' );
	} );

	it( 'skips non-tus localStorage entries', () => {
		const { getPendingUploads } = require( '../../src/tus-client' );
		localStorage.setItem( 'other-key', 'value' );
		localStorage.setItem(
			'not-tus-prefix',
			JSON.stringify( { uploadUrl: '/test' } )
		);

		expect( getPendingUploads() ).toEqual( [] );
		// Entries should not be removed.
		expect( localStorage.getItem( 'other-key' ) ).toBe( 'value' );
	} );
} );

describe( 'discardPendingUpload', () => {
	beforeEach( () => {
		localStorage.clear();
		global.fetch = jest.fn().mockResolvedValue( { ok: true } );
	} );

	afterEach( () => {
		delete global.fetch;
	} );

	it( 'sends DELETE to uploadUrl with nonce header', async () => {
		const { discardPendingUpload } = require( '../../src/tus-client' );

		await discardPendingUpload( {
			key: 'test-key',
			uploadUrl: '/wp-json/wp/v2/media/abc',
		} );

		expect( global.fetch ).toHaveBeenCalledWith(
			'/wp-json/wp/v2/media/abc',
			{
				method: 'DELETE',
				headers: { 'X-WP-Nonce': 'test-nonce' },
			}
		);
	} );

	it( 'removes key from localStorage', async () => {
		const { discardPendingUpload } = require( '../../src/tus-client' );

		localStorage.setItem( 'test-key', 'value' );

		await discardPendingUpload( {
			key: 'test-key',
			uploadUrl: '/test',
		} );

		expect( localStorage.getItem( 'test-key' ) ).toBeNull();
	} );

	it( 'handles fetch failure gracefully', async () => {
		const { discardPendingUpload } = require( '../../src/tus-client' );

		global.fetch = jest.fn().mockRejectedValue( new Error( 'Network' ) );
		localStorage.setItem( 'test-key', 'value' );

		await discardPendingUpload( {
			key: 'test-key',
			uploadUrl: '/test',
		} );

		// Key should still be removed even on fetch failure.
		expect( localStorage.getItem( 'test-key' ) ).toBeNull();
	} );
} );

describe( 'ExpiringUrlStorage', () => {
	beforeEach( () => {
		localStorage.clear();
	} );

	it( 'passes urlStorage option to tus.Upload', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		expect( tus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				urlStorage: expect.objectContaining( {
					addUpload: expect.any( Function ),
					findUploadsByFingerprint: expect.any( Function ),
					findAllUploads: expect.any( Function ),
					removeUpload: expect.any( Function ),
				} ),
			} )
		);
	} );

	describe( 'addUpload', () => {
		it( 'stores entry with expiration in key', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			// Get the urlStorage from the mock call
			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const fp = 'tus-br|test.txt|100|12345|/endpoint';

			const key = await urlStorage.addUpload( fp, {
				uploadUrl: '/test',
			} );

			// Key should have 4 parts: tus, fingerprint, expiresAt, id
			const parts = key.split( '::' );
			expect( parts.length ).toBe( 4 );
			expect( parts[ 0 ] ).toBe( 'tus' );
			expect( parts[ 1 ] ).toBe( fp );
			expect( parseInt( parts[ 2 ], 10 ) ).toBeGreaterThan( Date.now() );
		} );

		it( 'sets expiration to 24 hours from now', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const now = Date.now();

			const key = await urlStorage.addUpload( 'fingerprint', {
				uploadUrl: '/test',
			} );

			const expiresAt = parseInt( key.split( '::' )[ 2 ], 10 );
			const expectedExpiration = 24 * 60 * 60 * 1000;

			// Should be within 1 second of expected (accounting for test execution time)
			expect( expiresAt - now ).toBeGreaterThanOrEqual(
				expectedExpiration - 1000
			);
			expect( expiresAt - now ).toBeLessThanOrEqual(
				expectedExpiration + 1000
			);
		} );
	} );

	describe( 'findUploadsByFingerprint', () => {
		it( 'returns non-expired entries matching fingerprint', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const fp = 'tus-br|test.txt|100|12345|/endpoint';
			const futureExpiry = Date.now() + 86400000;

			// Add a valid entry directly to localStorage
			const key = `tus::${ fp }::${ futureExpiry }::123`;
			localStorage.setItem(
				key,
				JSON.stringify( { uploadUrl: '/test' } )
			);

			const results = await urlStorage.findUploadsByFingerprint( fp );

			expect( results.length ).toBe( 1 );
			expect( results[ 0 ].uploadUrl ).toBe( '/test' );
		} );

		it( 'filters out and removes expired entries', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const fp = 'tus-br|test.txt|100|12345|/endpoint';
			const pastExpiry = Date.now() - 1000;

			// Add an expired entry
			const key = `tus::${ fp }::${ pastExpiry }::123`;
			localStorage.setItem(
				key,
				JSON.stringify( { uploadUrl: '/test' } )
			);

			const results = await urlStorage.findUploadsByFingerprint( fp );

			expect( results.length ).toBe( 0 );
			expect( localStorage.getItem( key ) ).toBeNull();
		} );

		it( 'removes entries with invalid expiration values', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const fp = 'tus-br|test.txt|100|12345|/endpoint';

			// Add entry with invalid expiration (NaN)
			const key = `tus::${ fp }::invalid::123`;
			localStorage.setItem(
				key,
				JSON.stringify( { uploadUrl: '/test' } )
			);

			const results = await urlStorage.findUploadsByFingerprint( fp );

			expect( results.length ).toBe( 0 );
			expect( localStorage.getItem( key ) ).toBeNull();
		} );
	} );

	describe( 'findAllUploads', () => {
		it( 'returns all non-expired entries', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const futureExpiry = Date.now() + 86400000;

			// Add two valid entries
			localStorage.setItem(
				`tus::fingerprint1::${ futureExpiry }::1`,
				JSON.stringify( { uploadUrl: '/test1' } )
			);
			localStorage.setItem(
				`tus::fingerprint2::${ futureExpiry }::2`,
				JSON.stringify( { uploadUrl: '/test2' } )
			);

			const results = await urlStorage.findAllUploads();

			expect( results.length ).toBe( 2 );
		} );

		it( 'removes malformed entries with less than 4 parts', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;

			// Add malformed entry (only 2 parts)
			const key = 'tus::fingerprint::123';
			localStorage.setItem(
				key,
				JSON.stringify( { uploadUrl: '/test' } )
			);

			await urlStorage.findAllUploads();

			expect( localStorage.getItem( key ) ).toBeNull();
		} );
	} );

	describe( '_findEntries (via findUploadsByFingerprint)', () => {
		it( 'ignores non-matching key prefixes', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const futureExpiry = Date.now() + 86400000;
			const fp = 'tus-br|test.txt|100|12345|/endpoint';

			// Add an entry with a different prefix that won't match.
			localStorage.setItem(
				`other::${ fp }::${ futureExpiry }::123`,
				JSON.stringify( { uploadUrl: '/test' } )
			);

			const results = await urlStorage.findUploadsByFingerprint( fp );
			expect( results.length ).toBe( 0 );
		} );

		it( 'cleans up entries with malformed JSON', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const futureExpiry = Date.now() + 86400000;
			const fp = 'tus-br|test.txt|100|12345|/endpoint';

			// Add entry with invalid JSON value.
			const key = `tus::${ fp }::${ futureExpiry }::123`;
			localStorage.setItem( key, 'not valid json{' );

			const results = await urlStorage.findUploadsByFingerprint( fp );
			expect( results.length ).toBe( 0 );
			expect( localStorage.getItem( key ) ).toBeNull();
		} );
	} );

	describe( 'removeUpload', () => {
		it( 'removes entry from localStorage', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const key = 'tus::fingerprint::12345::123';

			localStorage.setItem(
				key,
				JSON.stringify( { uploadUrl: '/test' } )
			);
			expect( localStorage.getItem( key ) ).not.toBeNull();

			await urlStorage.removeUpload( key );

			expect( localStorage.getItem( key ) ).toBeNull();
		} );
	} );
} );

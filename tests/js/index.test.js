/**
 * Tests for the TUS uploader core module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	abort,
	discardPendingUpload,
	getPendingUploads,
	upload,
} from '../../src/tus-client';
import * as tus from 'tus-js-client';

// Store callbacks for testing
let capturedCallbacks = {};

// Mock tus-js-client
vi.mock( 'tus-js-client', () => {
	const mockUpload = {
		url: null,
		start: vi.fn(),
		abort: vi.fn().mockResolvedValue( undefined ),
		findPreviousUploads: vi.fn().mockResolvedValue( [] ),
		resumeFromPreviousUpload: vi.fn(),
	};

	return {
		Upload: vi.fn().mockImplementation( function ( file, options ) {
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

/**
 * Spies that make localStorage throw, restored after each test.
 */
const storageBlockers = [];

/**
 * Makes every localStorage call throw, like storage blocked by the browser.
 */
function blockStorage() {
	storageBlockers.push(
		...[ 'getItem', 'setItem', 'removeItem', 'key' ].map( ( method ) =>
			vi.spyOn( localStorage, method ).mockImplementation( () => {
				throw new DOMException( 'Blocked', 'SecurityError' );
			} )
		)
	);
}

afterEach( () => {
	storageBlockers.splice( 0 ).forEach( ( spy ) => spy.mockRestore() );
} );

// Setup window.uploadsUnleashed
beforeEach( () => {
	window.uploadsUnleashed = {
		endpoint: '/wp-json/wp/v2/media',
		nonce: 'test-nonce',
		blogId: '1',
		userId: '7',
		// Many tests never finish their uploads, so don't let the parallel limit queue later ones.
		maxConcurrentUploads: Number.MAX_SAFE_INTEGER,
	};
	capturedCallbacks = {};
	vi.clearAllMocks();
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

	it( 'keeps retrying for minutes with a capped backoff', () => {
		const file = new File( [ 'test' ], 'test.txt' );

		upload( file );

		const { retryDelays } = tus.Upload.mock.calls[ 0 ][ 1 ];
		const total = retryDelays.reduce( ( sum, delay ) => sum + delay, 0 );

		expect( retryDelays[ 0 ] ).toBe( 0 );
		expect( Math.max( ...retryDelays ) ).toBe( 60000 );
		expect( total ).toBeGreaterThanOrEqual( 3 * 60 * 1000 );
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

	it( 'generates fingerprint from file metadata, endpoint, blog and user', async () => {
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
			'tus-br|my%20file.txt|2048|99999|/wp-json/wp/v2/media|1|7'
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

	it( 'uses default endpoint when window.uploadsUnleashed is not set', async () => {
		window.uploadsUnleashed = undefined;
		const file = new File( [ 'test' ], 'test.txt' );

		// A fresh module, so the unfinished uploads of earlier tests don't hold every slot.
		vi.resetModules();
		const freshTus = await import( 'tus-js-client' );
		const { upload: freshUpload } = await import( '../../src/tus-client' );

		freshUpload( file );

		expect( freshTus.Upload ).toHaveBeenCalledWith(
			file,
			expect.objectContaining( {
				endpoint: '/wp-json/wp/v2/media',
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

	it( 'removes progress on successful upload', async () => {
		const file = new File( [ 'test' ], 'test.txt' );
		const attachmentData = { id: 123 };

		const promise = upload( file );

		const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
		mockUpload.url = '/wp-json/wp/v2/media/upload-123';

		// Simulate progress being saved
		localStorage.setItem(
			'tus-progress::/wp-json/wp/v2/media/upload-123',
			'500'
		);

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => JSON.stringify( attachmentData ),
			},
		} );

		await promise;
		expect(
			localStorage.getItem(
				'tus-progress::/wp-json/wp/v2/media/upload-123'
			)
		).toBeNull();
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
			const onProgress = vi.fn();

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

		it( 'saves progress to localStorage during onProgress', () => {
			localStorage.clear();
			const file = new File( [ 'test' ], 'test.txt' );
			const progressKey = 'tus-progress::/wp-json/wp/v2/media/upload-123';

			upload( file );

			const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
			mockUpload.url = '/wp-json/wp/v2/media/upload-123';

			capturedCallbacks.onProgress( 500, 1000 );

			expect( parseInt( localStorage.getItem( progressKey ), 10 ) ).toBe(
				500
			);
		} );

		it( 'does not save progress when upload URL is not yet available', () => {
			localStorage.clear();
			const file = new File( [ 'test' ], 'test.txt' );

			upload( file );

			const mockUpload = tus.Upload.mock.results[ 0 ]?.value;
			mockUpload.url = null;

			capturedCallbacks.onProgress( 500, 1000 );

			// No tus-progress:: keys should exist
			for ( let i = 0; i < localStorage.length; i++ ) {
				expect( localStorage.key( i ) ).not.toMatch(
					/^tus-progress::/
				);
			}
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

		it( 'keeps the TUS error as the cause', async () => {
			const file = new File( [ 'test' ], 'test.txt' );

			const promise = upload( file );

			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			const detailedError = {
				message: 'tus: failed to create upload',
				originalRequest: { getMethod: () => 'POST' },
				originalResponse: null,
			};

			capturedCallbacks.onError( detailedError );

			await expect( promise ).rejects.toMatchObject( {
				cause: detailedError,
			} );
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

		describe( 'server rejection', () => {
			const uploadUrl = '/wp-json/wp/v2/media/abc';
			const storageKey = 'tus::tus-br|test.txt::9999999999999::1';
			const httpError = () => ( {
				message: 'TUS error',
				originalResponse: {
					getBody: () => JSON.stringify( { message: 'Rejected' } ),
				},
			} );
			const flush = () =>
				new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			beforeEach( () => {
				localStorage.clear();
				localStorage.setItem( storageKey, '{}' );
				localStorage.setItem( `tus-progress::${ uploadUrl }`, '4' );
			} );

			// Called after upload(), so the initial resume lookup stays empty.
			const mockStoredUpload = () => {
				const mockUpload = tus.Upload.mock.results[ 0 ].value;
				mockUpload.url = uploadUrl;
				mockUpload.findPreviousUploads.mockResolvedValueOnce( [
					{ uploadUrl, urlStorageKey: storageKey },
				] );
			};

			afterEach( () => {
				const mockUpload = tus.Upload.mock.results[ 0 ].value;
				mockUpload.url = null;
				// Drop unconsumed one-off lookups so they can't leak into later tests.
				mockUpload.findPreviousUploads.mockReset();
				mockUpload.findPreviousUploads.mockResolvedValue( [] );
				delete global.fetch;
			} );

			it( 'forgets the upload when the server deleted the session', async () => {
				global.fetch = vi.fn().mockResolvedValue( { status: 404 } );
				const promise = upload( new File( [ 'test' ], 'test.txt' ) );
				await flush();
				mockStoredUpload();

				capturedCallbacks.onError( httpError() );

				await expect( promise ).rejects.toThrow( 'Rejected' );
				await flush();
				expect( global.fetch ).toHaveBeenCalledWith( uploadUrl, {
					method: 'HEAD',
					headers: { 'X-WP-Nonce': 'test-nonce' },
				} );
				expect( localStorage.getItem( storageKey ) ).toBeNull();
				expect(
					localStorage.getItem( `tus-progress::${ uploadUrl }` )
				).toBeNull();
			} );

			it( 'forgets the upload when the session expired', async () => {
				global.fetch = vi.fn().mockResolvedValue( { status: 410 } );
				const promise = upload( new File( [ 'test' ], 'test.txt' ) );
				await flush();
				mockStoredUpload();

				capturedCallbacks.onError( httpError() );

				await expect( promise ).rejects.toThrow( 'Rejected' );
				await flush();
				expect( localStorage.getItem( storageKey ) ).toBeNull();
			} );

			it( 'keeps the upload when the server still has the session', async () => {
				// E.g. the last chunk failed on an expired nonce.
				global.fetch = vi.fn().mockResolvedValue( { status: 403 } );
				const promise = upload( new File( [ 'test' ], 'test.txt' ) );
				await flush();
				mockStoredUpload();

				capturedCallbacks.onError( httpError() );

				await expect( promise ).rejects.toThrow( 'Rejected' );
				await flush();
				expect( localStorage.getItem( storageKey ) ).toBe( '{}' );
				expect(
					localStorage.getItem( `tus-progress::${ uploadUrl }` )
				).toBe( '4' );
			} );

			it( 'keeps the upload when the status check fails', async () => {
				global.fetch = vi
					.fn()
					.mockRejectedValue( new Error( 'Network' ) );
				const promise = upload( new File( [ 'test' ], 'test.txt' ) );
				await flush();
				mockStoredUpload();

				capturedCallbacks.onError( httpError() );

				await expect( promise ).rejects.toThrow( 'Rejected' );
				await flush();
				expect( localStorage.getItem( storageKey ) ).toBe( '{}' );
			} );

			it( 'skips the status check without a server response', async () => {
				global.fetch = vi.fn();
				const promise = upload( new File( [ 'test' ], 'test.txt' ) );
				await flush();
				mockStoredUpload();

				capturedCallbacks.onError( new Error( 'Network error' ) );

				await expect( promise ).rejects.toThrow( 'Network error' );
				await flush();
				expect( global.fetch ).not.toHaveBeenCalled();
				expect( localStorage.getItem( storageKey ) ).toBe( '{}' );
			} );
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

describe( 'connection drops', () => {
	const setOnline = ( online ) =>
		Object.defineProperty( window.navigator, 'onLine', {
			configurable: true,
			get: () => online,
		} );
	const flush = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	const requestError = ( status ) => ( {
		originalRequest: {},
		originalResponse: status ? { getStatus: () => status } : null,
	} );
	const request = ( method ) => ( {
		getMethod: () => method,
		setHeader: vi.fn(),
	} );
	const getOptions = () => {
		upload( new File( [ 'test' ], 'test.txt' ) );
		return tus.Upload.mock.calls[ 0 ][ 1 ];
	};

	afterEach( () => {
		setOnline( true );
		tus.Upload.mock.results[ 0 ].value._aborted = false;
	} );

	it( 'retries a failed request while the browser is offline', () => {
		setOnline( false );

		const { onShouldRetry } = getOptions();

		expect( onShouldRetry( requestError( 0 ), 0 ) ).toBe( true );
	} );

	it.each( [ 500, 502, 503, 409, 423 ] )(
		'retries a %i response',
		( status ) => {
			const { onShouldRetry } = getOptions();

			expect( onShouldRetry( requestError( status ), 0 ) ).toBe( true );
		}
	);

	it.each( [ 400, 404, 410, 415 ] )(
		'does not retry a %i response',
		( status ) => {
			const { onShouldRetry } = getOptions();

			expect( onShouldRetry( requestError( status ), 0 ) ).toBe( false );
		}
	);

	it( 'sends requests right away while online', async () => {
		const { onBeforeRequest } = getOptions();

		await expect(
			onBeforeRequest( request( 'PATCH' ) )
		).resolves.toBeUndefined();
	} );

	it( 'holds requests until the browser is back online', async () => {
		setOnline( false );
		const { onBeforeRequest } = getOptions();
		const sent = vi.fn();

		onBeforeRequest( request( 'PATCH' ) ).then( sent );
		await flush();
		expect( sent ).not.toHaveBeenCalled();

		setOnline( true );
		window.dispatchEvent( new Event( 'online' ) );
		await flush();
		expect( sent ).toHaveBeenCalled();
	} );

	it( 'drops a held request when the upload was aborted meanwhile', async () => {
		setOnline( false );
		const { onBeforeRequest } = getOptions();

		const held = onBeforeRequest( request( 'PATCH' ) );
		tus.Upload.mock.results[ 0 ].value._aborted = true;
		setOnline( true );
		window.dispatchEvent( new Event( 'online' ) );

		await expect( held ).rejects.toThrow( 'Upload aborted' );
	} );

	it( 'still sends the termination request of an aborted upload', async () => {
		setOnline( false );
		const { onBeforeRequest } = getOptions();

		const held = onBeforeRequest( request( 'DELETE' ) );
		tus.Upload.mock.results[ 0 ].value._aborted = true;
		setOnline( true );
		window.dispatchEvent( new Event( 'online' ) );

		await expect( held ).resolves.toBeUndefined();
	} );
} );

describe( 'REST nonce', () => {
	const nonceEndpoint = '/wp-admin/admin-ajax.php?action=rest-nonce';
	const flush = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	const request = ( method, nonce = 'test-nonce' ) => {
		const headers = { 'X-WP-Nonce': nonce };
		return {
			getMethod: () => method,
			getHeader: ( name ) => headers[ name ],
			setHeader: vi.fn( ( name, value ) => {
				headers[ name ] = value;
			} ),
		};
	};
	const response = ( status, body = '' ) => ( {
		getStatus: () => status,
		getBody: () => body,
	} );
	const invalidNonce = JSON.stringify( {
		code: 'rest_cookie_invalid_nonce',
		message: 'Cookie check failed',
	} );
	const getOptions = () => {
		upload( new File( [ 'test' ], 'test.txt' ) );
		return tus.Upload.mock.calls[ 0 ][ 1 ];
	};
	const mockNonceEndpoint = ( nonce, ok = true ) =>
		vi.fn( async ( url ) => {
			if ( url === nonceEndpoint ) {
				return { ok, status: ok ? 200 : 400, text: async () => nonce };
			}
			throw new Error( `Unexpected request to ${ url }` );
		} );

	beforeEach( () => {
		window.uploadsUnleashed.nonceEndpoint = nonceEndpoint;
	} );

	afterEach( () => {
		delete global.fetch;
		delete window.wp;
	} );

	it( 'sets the nonce on every request', async () => {
		const { onBeforeRequest } = getOptions();
		const req = request( 'PATCH', undefined );

		await onBeforeRequest( req );

		expect( req.setHeader ).toHaveBeenCalledWith(
			'X-WP-Nonce',
			'test-nonce'
		);
	} );

	it( 'prefers the nonce kept fresh by apiFetch', async () => {
		window.wp = { apiFetch: { nonceMiddleware: { nonce: 'heartbeat' } } };
		const { onBeforeRequest } = getOptions();
		const req = request( 'PATCH', undefined );

		await onBeforeRequest( req );

		expect( req.setHeader ).toHaveBeenCalledWith(
			'X-WP-Nonce',
			'heartbeat'
		);
	} );

	it( 'refreshes an invalid nonce and retries the request', async () => {
		global.fetch = mockNonceEndpoint( 'abcdef1234' );
		const { onAfterResponse, onBeforeRequest, onShouldRetry } =
			getOptions();
		const req = request( 'PATCH' );

		const result = onAfterResponse( req, response( 403, invalidNonce ) );
		await expect( result ).rejects.toThrow();
		const error = await result.catch( ( causingError ) => causingError );

		expect( global.fetch ).toHaveBeenCalledWith(
			nonceEndpoint,
			expect.anything()
		);
		expect(
			onShouldRetry(
				{
					originalRequest: req,
					originalResponse: null,
					causingError: error,
				},
				0
			)
		).toBe( true );

		const retry = request( 'PATCH', undefined );
		await onBeforeRequest( retry );
		expect( retry.setHeader ).toHaveBeenCalledWith(
			'X-WP-Nonce',
			'abcdef1234'
		);
	} );

	it( 'updates the apiFetch nonce after a refresh', async () => {
		window.wp = { apiFetch: { nonceMiddleware: { nonce: 'test-nonce' } } };
		global.fetch = mockNonceEndpoint( 'abcdef1234' );
		const { onAfterResponse } = getOptions();

		await onAfterResponse(
			request( 'PATCH' ),
			response( 403, invalidNonce )
		).catch( () => {} );

		expect( window.wp.apiFetch.nonceMiddleware.nonce ).toBe( 'abcdef1234' );
	} );

	it( 'refreshes on a bodiless 403 to a HEAD request', async () => {
		global.fetch = mockNonceEndpoint( 'abcdef1234' );
		const { onAfterResponse } = getOptions();

		await expect(
			onAfterResponse( request( 'HEAD' ), response( 403 ) )
		).rejects.toThrow();
	} );

	it( 'does not retry when the refreshed nonce is the same', async () => {
		global.fetch = mockNonceEndpoint( 'test-nonce' );
		const { onAfterResponse } = getOptions();

		await expect(
			onAfterResponse( request( 'HEAD' ), response( 403 ) )
		).resolves.toBeUndefined();
	} );

	it( 'does not retry when the refresh fails, e.g. after logging out', async () => {
		global.fetch = mockNonceEndpoint( '0', false );
		const { onAfterResponse } = getOptions();

		await expect(
			onAfterResponse( request( 'PATCH' ), response( 403, invalidNonce ) )
		).resolves.toBeUndefined();
	} );

	it( 'leaves other 403 responses alone', async () => {
		global.fetch = vi.fn();
		const { onAfterResponse } = getOptions();

		await expect(
			onAfterResponse(
				request( 'PATCH' ),
				response(
					403,
					JSON.stringify( { code: 'rest_cannot_view_upload' } )
				)
			)
		).resolves.toBeUndefined();
		expect( global.fetch ).not.toHaveBeenCalled();
	} );

	it( 'shares one refresh between concurrent requests', async () => {
		global.fetch = mockNonceEndpoint( 'abcdef1234' );
		const { onAfterResponse } = getOptions();

		await Promise.allSettled( [
			onAfterResponse(
				request( 'PATCH' ),
				response( 403, invalidNonce )
			),
			onAfterResponse(
				request( 'PATCH' ),
				response( 403, invalidNonce )
			),
		] );

		expect( global.fetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'discards a pending upload with a refreshed nonce', async () => {
		const uploadUrl = '/wp-json/wp/v2/media/abc';
		global.fetch = vi.fn( async ( url, options = {} ) => {
			if ( url === nonceEndpoint ) {
				return {
					ok: true,
					status: 200,
					text: async () => 'abcdef1234',
				};
			}
			return 'abcdef1234' === options.headers[ 'X-WP-Nonce' ]
				? { ok: true, status: 204 }
				: { ok: false, status: 403, text: async () => invalidNonce };
		} );

		await discardPendingUpload( { key: 'test-key', uploadUrl } );

		expect( global.fetch ).toHaveBeenLastCalledWith( uploadUrl, {
			method: 'DELETE',
			headers: { 'X-WP-Nonce': 'abcdef1234' },
		} );
	} );

	it( 'forgets a deleted session even when the nonce went stale', async () => {
		const uploadUrl = '/wp-json/wp/v2/media/abc';
		const storageKey = 'tus::tus-br|test.txt::9999999999999::1';
		localStorage.clear();
		localStorage.setItem( storageKey, '{}' );
		global.fetch = vi.fn( async ( url, options = {} ) => {
			if ( url === nonceEndpoint ) {
				return {
					ok: true,
					status: 200,
					text: async () => 'abcdef1234',
				};
			}
			return {
				status:
					'abcdef1234' === options.headers[ 'X-WP-Nonce' ]
						? 404
						: 403,
			};
		} );

		const promise = upload( new File( [ 'test' ], 'test.txt' ) );
		await flush();
		const mockUpload = tus.Upload.mock.results[ 0 ].value;
		mockUpload.url = uploadUrl;
		mockUpload.findPreviousUploads.mockResolvedValueOnce( [
			{ uploadUrl, urlStorageKey: storageKey },
		] );

		capturedCallbacks.onError( {
			message: 'TUS error',
			originalResponse: { getBody: () => '' },
		} );
		await expect( promise ).rejects.toThrow();
		await flush();
		await flush();

		expect( localStorage.getItem( storageKey ) ).toBeNull();
		mockUpload.url = null;
		mockUpload.findPreviousUploads.mockReset();
		mockUpload.findPreviousUploads.mockResolvedValue( [] );
	} );
} );

describe( 'abort', () => {
	it( 'calls abort with cleanup flag', async () => {
		const mockTusUpload = {
			abort: vi.fn().mockResolvedValue( undefined ),
		};

		await abort( mockTusUpload );

		expect( mockTusUpload.abort ).toHaveBeenCalledWith( true );
	} );

	it( 'returns a promise', () => {
		const mockTusUpload = {
			abort: vi.fn().mockResolvedValue( undefined ),
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
		expect( getPendingUploads() ).toEqual( [] );
	} );

	it( 'returns entries matching current endpoint', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
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
		const futureExpiry = Date.now() + 86400000;
		const fp = `tus-br|test.txt|1024|12345|/other-endpoint|1|7`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem(
			key,
			JSON.stringify( { uploadUrl: '/other-endpoint/abc' } )
		);

		expect( getPendingUploads() ).toEqual( [] );
	} );

	it( 'cleans up expired entries', () => {
		const pastExpiry = Date.now() - 1000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
		const key = `tus::${ fp }::${ pastExpiry }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const result = getPendingUploads();
		expect( result ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'cleans up malformed entries with wrong key format', () => {
		const endpoint = '/wp-json/wp/v2/media';
		// Only 3 parts instead of 4.
		const key = `tus::tus-br|test.txt|1024|12345|${ endpoint }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		getPendingUploads();
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'cleans up entries with invalid JSON', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem( key, 'not valid json{' );

		const result = getPendingUploads();
		expect( result ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'cleans up entries with wrong fingerprint part count', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		// Fingerprint with only 3 parts instead of 7.
		const fp = `tus-br|test.txt|${ endpoint }`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const result = getPendingUploads();
		expect( result ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'returns bytesUploaded from progress storage', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;
		const uploadUrl = '/wp-json/wp/v2/media/abc';

		localStorage.setItem( key, JSON.stringify( { uploadUrl } ) );
		localStorage.setItem( `tus-progress::${ uploadUrl }`, '512' );

		const result = getPendingUploads();
		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ].bytesUploaded ).toBe( 512 );
	} );

	it( 'returns 0 when no progress entry exists', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem(
			key,
			JSON.stringify( { uploadUrl: '/wp-json/wp/v2/media/abc' } )
		);

		const result = getPendingUploads();
		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ].bytesUploaded ).toBe( 0 );
	} );

	it( 'URL-decodes filenames', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|my%20file%20(1).txt|1024|12345|${ endpoint }|1|7`;
		const key = `tus::${ fp }::${ futureExpiry }::abc`;

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const result = getPendingUploads();
		expect( result[ 0 ].filename ).toBe( 'my file (1).txt' );
	} );

	it( 'returns the last modified time of the file', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
		localStorage.setItem(
			`tus::${ fp }::${ futureExpiry }::abc`,
			JSON.stringify( { uploadUrl: '/test' } )
		);

		expect( getPendingUploads()[ 0 ].lastModified ).toBe( 12345 );
	} );

	it.each( [
		[ 'another user', '1|8' ],
		[ 'another site', '2|7' ],
	] )( 'hides and keeps uploads of %s', ( label, owner ) => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const key = `tus::tus-br|secret.txt|1024|12345|${ endpoint }|${ owner }::${ futureExpiry }::abc`;
		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		expect( getPendingUploads() ).toEqual( [] );
		expect( localStorage.getItem( key ) ).not.toBeNull();
	} );

	it( 'cleans up entries from before fingerprints carried the user', () => {
		const futureExpiry = Date.now() + 86400000;
		const endpoint = '/wp-json/wp/v2/media';
		const key = `tus::tus-br|test.txt|1024|12345|${ endpoint }::${ futureExpiry }::abc`;
		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		expect( getPendingUploads() ).toEqual( [] );
		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'removes the progress of expired entries', () => {
		const pastExpiry = Date.now() - 1000;
		const endpoint = '/wp-json/wp/v2/media';
		const uploadUrl = '/wp-json/wp/v2/media/abc';
		const fp = `tus-br|test.txt|1024|12345|${ endpoint }|1|7`;
		localStorage.setItem(
			`tus::${ fp }::${ pastExpiry }::abc`,
			JSON.stringify( { uploadUrl } )
		);
		localStorage.setItem( `tus-progress::${ uploadUrl }`, '512' );

		getPendingUploads();

		expect(
			localStorage.getItem( `tus-progress::${ uploadUrl }` )
		).toBeNull();
	} );

	it( 'returns nothing when storage is blocked', () => {
		blockStorage();

		expect( getPendingUploads() ).toEqual( [] );
	} );

	it( 'skips non-tus localStorage entries', () => {
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
		global.fetch = vi.fn().mockResolvedValue( { ok: true } );
	} );

	afterEach( () => {
		delete global.fetch;
	} );

	it( 'sends DELETE to uploadUrl with nonce header', async () => {
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
		localStorage.setItem( 'test-key', 'value' );

		await discardPendingUpload( {
			key: 'test-key',
			uploadUrl: '/test',
		} );

		expect( localStorage.getItem( 'test-key' ) ).toBeNull();
	} );

	it( 'removes progress entry', async () => {
		const uploadUrl = '/wp-json/wp/v2/media/abc';
		localStorage.setItem( 'test-key', 'value' );
		localStorage.setItem( `tus-progress::${ uploadUrl }`, '512' );

		await discardPendingUpload( {
			key: 'test-key',
			uploadUrl,
		} );

		expect(
			localStorage.getItem( `tus-progress::${ uploadUrl }` )
		).toBeNull();
	} );

	it( 'handles fetch failure gracefully', async () => {
		global.fetch = vi.fn().mockRejectedValue( new Error( 'Network' ) );
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

	describe( 'storage failures', () => {
		const getUrlStorage = () => {
			upload( new File( [ 'test' ], 'test.txt' ) );
			return tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
		};

		it( 'continues without resuming when storage is full', async () => {
			const urlStorage = getUrlStorage();
			storageBlockers.push(
				vi.spyOn( localStorage, 'setItem' ).mockImplementation( () => {
					throw new DOMException( 'Full', 'QuotaExceededError' );
				} )
			);

			await expect(
				urlStorage.addUpload( 'tus-br|test.txt|4|1|/endpoint|1|7', {
					uploadUrl: '/test',
				} )
			).resolves.toBeNull();
		} );

		it( 'finds no previous uploads when storage is blocked', async () => {
			const urlStorage = getUrlStorage();
			blockStorage();

			await expect(
				urlStorage.findUploadsByFingerprint( 'tus-br|test.txt' )
			).resolves.toEqual( [] );
			await expect( urlStorage.findAllUploads() ).resolves.toEqual( [] );
			await expect(
				urlStorage.removeUpload( 'tus::key' )
			).resolves.toBeUndefined();
		} );

		it( 'finishes an upload when storage is blocked', async () => {
			blockStorage();
			const promise = upload( new File( [ 'test' ], 'test.txt' ) );
			const mockUpload = tus.Upload.mock.results[ 0 ].value;
			mockUpload.url = '/wp-json/wp/v2/media/abc';
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			capturedCallbacks.onProgress( 2, 4 );
			capturedCallbacks.onSuccess( {
				lastResponse: {
					getStatus: () => 200,
					getBody: () => JSON.stringify( { id: 1 } ),
				},
			} );

			await expect( promise ).resolves.toEqual( { id: 1 } );
			mockUpload.url = null;
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
		it( 'removes the progress of the entry', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const uploadUrl = '/wp-json/wp/v2/media/abc';
			const key = 'tus::tus-br|test.txt::9999999999999::1';
			localStorage.setItem( key, JSON.stringify( { uploadUrl } ) );
			localStorage.setItem( `tus-progress::${ uploadUrl }`, '512' );

			await urlStorage.removeUpload( key );

			expect(
				localStorage.getItem( `tus-progress::${ uploadUrl }` )
			).toBeNull();
		} );

		it( 'removes the progress of expired entries it finds', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			upload( file );

			const urlStorage = tus.Upload.mock.calls[ 0 ][ 1 ].urlStorage;
			const uploadUrl = '/wp-json/wp/v2/media/abc';
			const fp = 'tus-br|test.txt|100|12345|/endpoint|1|7';
			localStorage.setItem(
				`tus::${ fp }::${ Date.now() - 1000 }::1`,
				JSON.stringify( { uploadUrl } )
			);
			localStorage.setItem( `tus-progress::${ uploadUrl }`, '512' );

			await urlStorage.findUploadsByFingerprint( fp );

			expect(
				localStorage.getItem( `tus-progress::${ uploadUrl }` )
			).toBeNull();
		} );

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

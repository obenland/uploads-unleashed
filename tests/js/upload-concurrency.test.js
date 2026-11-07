/**
 * Tests for the parallel upload limit in the TUS client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Options passed to each tus.Upload instance, in creation order.
 *
 * @type {Object[]}
 */
let instances = [];

vi.mock( 'tus-js-client', () => ( {
	Upload: vi.fn().mockImplementation( function ( file, options ) {
		instances.push( options );

		return {
			url: null,
			start: vi.fn(),
			abort: vi.fn().mockResolvedValue( undefined ),
			findPreviousUploads: vi.fn().mockResolvedValue( [] ),
			resumeFromPreviousUpload: vi.fn(),
		};
	} ),
} ) );

/**
 * Loads a fresh copy of the TUS client, so no slots are taken.
 *
 * @return {Promise<(file: File, options?: Object) => Promise<Object>>} The upload() function.
 */
async function loadUpload() {
	vi.resetModules();

	return ( await import( '../../src/tus-client' ) ).upload;
}

/**
 * Creates a test file.
 *
 * @param {string} name File name.
 * @return {File} The file.
 */
function makeFile( name ) {
	return new File( [ 'data' ], name, { type: 'text/plain' } );
}

/**
 * Completes an upload successfully.
 *
 * @param {Object} options The tus.Upload options of the upload.
 * @param {number} id      Attachment ID to respond with.
 */
function succeed( options, id ) {
	options.onSuccess( {
		lastResponse: {
			getStatus: () => 200,
			getBody: () => JSON.stringify( { id } ),
		},
	} );
}

/**
 * Lets pending promise callbacks run.
 *
 * @return {Promise<void>}
 */
function flush() {
	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

beforeEach( () => {
	instances = [];
	window.uploadsUnleashed = {
		endpoint: '/wp-json/wp/v2/media',
		nonce: 'test-nonce',
	};
} );

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'parallel upload limit', () => {
	it( 'runs at most 3 uploads at once by default', async () => {
		const upload = await loadUpload();

		for ( let i = 0; i < 5; i++ ) {
			upload( makeFile( `file-${ i }.txt` ) ).catch( () => {} );
		}
		await flush();

		expect( instances ).toHaveLength( 3 );
	} );

	it( 'uses the limit localized from PHP', async () => {
		window.uploadsUnleashed.maxConcurrentUploads = 1;
		const upload = await loadUpload();

		upload( makeFile( 'a.txt' ) ).catch( () => {} );
		upload( makeFile( 'b.txt' ) ).catch( () => {} );
		await flush();

		expect( instances ).toHaveLength( 1 );
	} );

	it( 'falls back to the default for an invalid limit', async () => {
		window.uploadsUnleashed.maxConcurrentUploads = 'lots';
		const upload = await loadUpload();

		for ( let i = 0; i < 5; i++ ) {
			upload( makeFile( `file-${ i }.txt` ) ).catch( () => {} );
		}
		await flush();

		expect( instances ).toHaveLength( 3 );
	} );

	it( 'starts the next queued upload when one succeeds', async () => {
		window.uploadsUnleashed.maxConcurrentUploads = 1;
		const upload = await loadUpload();

		const first = upload( makeFile( 'a.txt' ) );
		const second = upload( makeFile( 'b.txt' ) );
		await flush();
		expect( instances ).toHaveLength( 1 );

		succeed( instances[ 0 ], 1 );
		await expect( first ).resolves.toEqual( { id: 1 } );
		await flush();

		expect( instances ).toHaveLength( 2 );
		expect( instances[ 1 ].metadata.filename ).toBe( 'b.txt' );

		succeed( instances[ 1 ], 2 );
		await expect( second ).resolves.toEqual( { id: 2 } );
	} );

	it( 'starts the next queued upload when one fails', async () => {
		window.uploadsUnleashed.maxConcurrentUploads = 1;
		const upload = await loadUpload();

		const first = upload( makeFile( 'a.txt' ) );
		upload( makeFile( 'b.txt' ) ).catch( () => {} );
		await flush();

		instances[ 0 ].onError( new Error( 'Network error' ) );
		await expect( first ).rejects.toThrow( 'Network error' );
		await flush();

		expect( instances ).toHaveLength( 2 );
	} );

	it( 'rejects a queued upload when it is aborted, without starting it', async () => {
		window.uploadsUnleashed.maxConcurrentUploads = 1;
		const upload = await loadUpload();
		const controller = new AbortController();

		upload( makeFile( 'a.txt' ) ).catch( () => {} );
		const queued = upload( makeFile( 'b.txt' ), {
			signal: controller.signal,
		} );
		upload( makeFile( 'c.txt' ) ).catch( () => {} );

		controller.abort();
		await expect( queued ).rejects.toThrow( 'Upload aborted' );

		succeed( instances[ 0 ], 1 );
		await flush();

		// The aborted upload is skipped; the next one in line starts.
		expect( instances ).toHaveLength( 2 );
		expect( instances[ 1 ].metadata.filename ).toBe( 'c.txt' );
	} );

	it( 'frees the slot when a running upload is aborted', async () => {
		window.uploadsUnleashed.maxConcurrentUploads = 1;
		const upload = await loadUpload();
		const controller = new AbortController();

		const running = upload( makeFile( 'a.txt' ), {
			signal: controller.signal,
		} );
		upload( makeFile( 'b.txt' ) ).catch( () => {} );
		await flush();

		controller.abort();
		await expect( running ).rejects.toThrow( 'Upload aborted' );
		await flush();

		expect( instances ).toHaveLength( 2 );
	} );
} );

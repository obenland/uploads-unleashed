/**
 * Tests that user-facing TUS client messages are translatable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { upload } from '../../src/tus-client';

/**
 * Callbacks passed to the most recent tus.Upload instance.
 *
 * @type {Object}
 */
let capturedCallbacks = {};

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text, domain ) => `[${ domain }] ${ text }`,
} ) );

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
			capturedCallbacks = {
				onSuccess: options.onSuccess,
				onError: options.onError,
			};
			return mockUpload;
		} ),
	};
} );

/**
 * Starts an upload and waits for the TUS instance to be created.
 *
 * @param {Object} [options] Upload options.
 * @return {Promise<{promise: Promise<Object>}>} The pending upload promise, wrapped so awaiting this doesn't settle it.
 */
async function startUpload( options ) {
	const promise = upload( new File( [ 'test' ], 'test.txt' ), options );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	return { promise };
}

beforeEach( () => {
	capturedCallbacks = {};
	vi.clearAllMocks();
} );

describe( 'translatable upload errors', () => {
	it( 'translates the fallback message for an error status without a body', async () => {
		const { promise } = await startUpload();

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 500,
				getBody: () => null,
			},
		} );

		await expect( promise ).rejects.toThrow(
			'[uploads-unleashed] The upload failed. Please try again.'
		);
	} );

	it( 'translates the fallback message for an error without a message', async () => {
		const { promise } = await startUpload();

		capturedCallbacks.onError( {} );

		await expect( promise ).rejects.toThrow(
			'[uploads-unleashed] The upload failed. Please try again.'
		);
	} );

	it( 'translates the missing attachment message', async () => {
		const { promise } = await startUpload();

		capturedCallbacks.onSuccess( {
			lastResponse: {
				getStatus: () => 200,
				getBody: () => null,
			},
		} );

		await expect( promise ).rejects.toThrow(
			'[uploads-unleashed] Upload completed but no attachment data received'
		);
	} );

	it( 'translates the aborted message for an already-aborted signal', async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			upload( new File( [ 'test' ], 'test.txt' ), {
				signal: controller.signal,
			} )
		).rejects.toThrow( '[uploads-unleashed] Upload aborted' );
	} );

	it( 'translates the aborted message when the signal fires mid-upload', async () => {
		const controller = new AbortController();
		const { promise } = await startUpload( {
			signal: controller.signal,
		} );

		controller.abort();

		await expect( promise ).rejects.toThrow(
			'[uploads-unleashed] Upload aborted'
		);
	} );
} );

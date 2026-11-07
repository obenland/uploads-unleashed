import { test, expect } from '@playwright/test';
import type { Locator, Page, Request, Route } from '@playwright/test';
import { loginAsAdmin } from './utils';

/**
 * End-to-end coverage for the block editor's fallback to a standard upload.
 *
 * The TUS creation request is answered by a route handler, so each test can
 * pick the server's answer. A standard upload is a POST to the media
 * collection without an `Upload-Length` header.
 */

/**
 * Checks whether a URL points at the media collection route.
 *
 * @param url Request URL.
 * @return Whether it is the collection route, in either permalink form.
 */
function isMediaCollection( url: URL ): boolean {
	const route =
		url.searchParams.get( 'rest_route' ) ??
		url.pathname.replace( /^.*\/wp-json/, '' );

	return route === '/wp/v2/media';
}

/**
 * Answers the TUS creation request with the given status and message.
 *
 * @param page    Playwright `page` fixture.
 * @param status  Response status.
 * @param message Error message in the response body.
 */
async function answerTusCreation(
	page: Page,
	status: number,
	message: string
): Promise< void > {
	await page.route( isMediaCollection, ( route: Route ) => {
		const request = route.request();
		if (
			request.method() !== 'POST' ||
			! request.headers()[ 'upload-length' ]
		) {
			return route.fallback();
		}

		return route.fulfill( {
			status,
			contentType: 'application/json',
			body: JSON.stringify( { code: 'test_error', message } ),
		} );
	} );
}

/**
 * Opens a new post with a File block and uploads a text file to it.
 *
 * @param page Playwright `page` fixture.
 * @return Standard (non-TUS) upload requests sent to the media collection.
 */
async function uploadTextFile( page: Page ): Promise< Request[] > {
	const standardUploads: Request[] = [];
	page.on( 'request', ( request ) => {
		if (
			request.method() === 'POST' &&
			isMediaCollection( new URL( request.url() ) ) &&
			! request.headers()[ 'upload-length' ]
		) {
			standardUploads.push( request );
		}
	} );

	await page.goto( '/wp-admin/post-new.php' );
	await page.waitForFunction( () =>
		( window as any ).wp?.data
			?.select( 'core/editor' )
			?.getCurrentPostId?.()
	);
	await page.evaluate( () => {
		const { data, blocks } = ( window as any ).wp;
		data.dispatch( 'core/preferences' ).set(
			'core/edit-post',
			'welcomeGuide',
			false
		);
		data.dispatch( 'core/block-editor' ).insertBlocks(
			blocks.createBlock( 'core/file' )
		);
	} );

	await page
		.frameLocator( 'iframe[name="editor-canvas"]' )
		.locator( '.wp-block-file input[type="file"]' )
		.setInputFiles( {
			name: `editor-fallback-${ Date.now() }.txt`,
			mimeType: 'text/plain',
			buffer: Buffer.from( 'Uploads Unleashed' ),
		} );

	return standardUploads;
}

/**
 * Locates the editor's notices and snackbars.
 *
 * @param page Playwright `page` fixture.
 * @return Notice locator.
 */
function notices( page: Page ): Locator {
	return page.locator( '.components-snackbar, .components-notice' );
}

test.describe( 'Block editor fallback', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'shows the server message when it rejects the upload', async ( {
		page,
	} ) => {
		await answerTusCreation(
			page,
			400,
			'Not enough space to upload. 1 MB needed.'
		);

		const standardUploads = await uploadTextFile( page );

		await expect(
			notices( page ).filter( {
				hasText: 'Not enough space to upload. 1 MB needed.',
			} )
		).toBeVisible( { timeout: 15000 } );
		await expect(
			notices( page ).filter( { hasText: 'Using standard upload.' } )
		).toHaveCount( 0 );
		expect( standardUploads ).toHaveLength( 0 );
	} );

	test( 'falls back to a standard upload when TUS is unavailable', async ( {
		page,
	} ) => {
		await answerTusCreation( page, 404, 'No route was found.' );

		const standardUploads = await uploadTextFile( page );

		await expect(
			notices( page ).filter( { hasText: 'Using standard upload.' } )
		).toBeVisible( { timeout: 15000 } );
		await expect.poll( () => standardUploads.length ).toBe( 1 );
	} );
} );

import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Locator, Page, Request, TestInfo } from '@playwright/test';

/**
 * Matches the TUS upload URL of a single session: `/wp/v2/media/<uuid>`,
 * with or without pretty permalinks.
 */
export const TUS_UPLOAD_URL =
	/\/wp\/v2\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/?&]|$)/;

/**
 * The client's TUS chunk size (`chunkSize` in `src/tus-client.js`).
 */
export const TUS_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * Logs in as the wp-env default admin (admin / password).
 *
 * Goes via wp-login.php so the test starts from a known unauthenticated
 * state; trying to navigate directly to wp-admin assumes the cookie is
 * already set, which it isn't in a fresh browser context.
 *
 * @param page Playwright `page` fixture for the current browser context.
 */
export async function loginAsAdmin( page: Page ): Promise< void > {
	await page.goto( '/wp-login.php' );
	await page.locator( '#user_login' ).fill( 'admin' );
	await page.locator( '#user_pass' ).fill( 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.waitForURL( /\/wp-admin\// );
}

/**
 * Finds attachments through the REST API, as the logged-in user.
 *
 * @param page   Playwright `page` fixture, on an admin page that loads the plugin.
 * @param search Search term, e.g. the file name without its extension.
 * @return The matching attachments.
 */
export async function findAttachments(
	page: Page,
	search: string
): Promise< unknown[] > {
	return page.evaluate( async ( term ) => {
		const config = (
			window as unknown as {
				uploadsUnleashed: { endpoint: string; nonce: string };
			}
		 ).uploadsUnleashed;
		const url = new URL( config.endpoint, window.location.href );
		url.searchParams.set( 'search', term );
		const response = await fetch( url, {
			headers: { 'X-WP-Nonce': config.nonce },
		} );
		return response.json();
	}, search );
}

/**
 * Returns a filename that no earlier run or other test has used, so
 * assertions by filename can't match leftover attachments.
 *
 * @param prefix    Filename prefix, e.g. `tus-single`.
 * @param extension Extension without the dot, e.g. `txt`.
 * @return Unique filename.
 */
export function uniqueFilename( prefix: string, extension: string ): string {
	return `${ prefix }-${ Date.now() }-${ Math.round(
		Math.random() * 1e6
	) }.${ extension }`;
}

/**
 * Writes a plain-text file of the given size to the test's output directory.
 *
 * Uploads that should resume need a file on disk: tus-js-client fingerprints
 * files by `lastModified`, which Playwright sets to "now" for in-memory
 * buffers but takes from the file's mtime for paths.
 *
 * @param testInfo Playwright `testInfo` of the current test.
 * @param filename Filename, see `uniqueFilename()`.
 * @param size     File size in bytes.
 * @return Absolute path of the file.
 */
export async function createTextFile(
	testInfo: TestInfo,
	filename: string,
	size: number
): Promise< string > {
	const filePath = testInfo.outputPath( filename );
	const line = Buffer.from( 'Uploads Unleashed e2e fixture.\n' );
	const content = Buffer.alloc( size );

	for ( let offset = 0; offset < size; offset += line.length ) {
		line.copy( content, offset );
	}

	await fs.writeFile( filePath, content );

	return filePath;
}

/**
 * Opens Media → Add New and waits for its plupload uploader.
 *
 * @param page Playwright `page` fixture.
 * @return The plupload file input.
 */
export async function gotoMediaNew( page: Page ): Promise< Locator > {
	await page.goto( '/wp-admin/media-new.php' );

	const input = pluploadInput( page );
	await expect( input ).toBeAttached();

	return input;
}

/**
 * Returns the hidden file input plupload adds to the page.
 *
 * @param page Playwright `page` fixture.
 * @return The plupload file input.
 */
export function pluploadInput( page: Page ): Locator {
	return page.locator( '.moxie-shim input[type="file"]' ).first();
}

/**
 * TUS requests the page sent, in the order it sent them.
 */
export interface TusRequests {
	/** `POST /wp/v2/media` requests with an `Upload-Length` header. */
	creations: Request[];
	/** `PATCH` requests that upload a chunk. */
	patches: Request[];
	/** Every request to a TUS upload URL, `HEAD` and `DELETE` included. */
	all: Request[];
}

/**
 * Records the TUS requests a page sends from now on.
 *
 * @param page Playwright `page` fixture.
 * @return Live lists of the recorded requests.
 */
export function recordTusRequests( page: Page ): TusRequests {
	const requests: TusRequests = { creations: [], patches: [], all: [] };

	page.on( 'request', ( request ) => {
		const method = request.method();

		if ( TUS_UPLOAD_URL.test( request.url() ) ) {
			requests.all.push( request );
			if ( 'PATCH' === method ) {
				requests.patches.push( request );
			}
			return;
		}

		if (
			'POST' === method &&
			/\/wp\/v2\/media(?:[?&]|$)/.test( request.url() ) &&
			undefined !== request.headers()[ 'upload-length' ]
		) {
			requests.creations.push( request );
		}
	} );

	return requests;
}

/**
 * Waits until Media → Add New shows a finished upload and returns its ID.
 *
 * Core replaces the progress bar with an Edit link once the attachment
 * exists; the upload failed if it shows an error instead.
 *
 * @param page     Playwright `page` fixture.
 * @param filename Name of the uploaded file.
 * @param timeout  Milliseconds to wait for the upload to finish.
 * @return Attachment ID.
 */
export async function waitForMediaNewUpload(
	page: Page,
	filename: string,
	timeout = 30000
): Promise< number > {
	const item = page.locator( '#media-items .media-item' ).filter( {
		hasText: filename.replace( /\.[^.]+$/, '' ),
	} );
	const editLink = item.locator( 'a.edit-attachment' );

	await expect( item.locator( '.error-div' ) ).toHaveCount( 0 );
	await expect( editLink ).toBeVisible( { timeout } );

	const href = ( await editLink.getAttribute( 'href' ) ) ?? '';
	const id = Number( new URL( href, page.url() ).searchParams.get( 'post' ) );
	expect( id ).toBeGreaterThan( 0 );

	return id;
}

/**
 * An attachment as the REST API returns it, reduced to what tests check.
 */
export interface Attachment {
	id: number;
	source_url: string;
	media_details: { filesize?: number };
}

/**
 * Fetches an attachment through the REST API as the logged-in user.
 *
 * Reads the REST nonce the plugin localizes, so the current page has to be
 * one that loads the uploader.
 *
 * @param page Playwright `page` fixture.
 * @param id   Attachment ID.
 * @return The attachment.
 */
export async function getAttachment(
	page: Page,
	id: number
): Promise< Attachment > {
	const nonce = await page.evaluate(
		() =>
			(
				window as unknown as {
					uploadsUnleashed: { nonce: string };
				}
			 ).uploadsUnleashed.nonce
	);
	const response = await page.request.get(
		`/?rest_route=/wp/v2/media/${ id }&context=edit`,
		{ headers: { 'X-WP-Nonce': nonce } }
	);
	expect( response.ok() ).toBe( true );

	return ( await response.json() ) as Attachment;
}

/**
 * Downloads an attachment's file and returns its size in bytes.
 *
 * @param page       Playwright `page` fixture.
 * @param attachment The attachment.
 * @return File size in bytes.
 */
export async function getAttachmentFileSize(
	page: Page,
	attachment: Attachment
): Promise< number > {
	const response = await page.request.get( attachment.source_url );
	expect( response.ok() ).toBe( true );

	return ( await response.body() ).length;
}

/**
 * Returns the number of resumable uploads the TUS client keeps in
 * localStorage.
 *
 * @param page Playwright `page` fixture.
 * @return Number of stored uploads.
 */
export function countStoredUploads( page: Page ): Promise< number > {
	return page.evaluate(
		() =>
			Object.keys( localStorage ).filter( ( key ) =>
				key.startsWith( 'tus::' )
			).length
	);
}

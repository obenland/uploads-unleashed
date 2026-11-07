import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	TUS_CHUNK_SIZE,
	TUS_UPLOAD_URL,
	countStoredUploads,
	createTextFile,
	getAttachment,
	getAttachmentFileSize,
	gotoMediaNew,
	loginAsAdmin,
	recordTusRequests,
	uniqueFilename,
	waitForMediaNewUpload,
} from './utils';

/**
 * TUS uploads through the plupload uploader on Media → Add New.
 *
 * Unlike the `?browser-uploader=1` form, which posts to async-upload.php,
 * these drive the uploader the plugin hooks, so each upload has to go through
 * the TUS creation request and PATCH chunks to become an attachment.
 */
test.describe( 'TUS uploads on Media → Add New', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'uploads a single file through TUS', async ( { page } ) => {
		const requests = recordTusRequests( page );
		const input = await gotoMediaNew( page );

		const filename = uniqueFilename( 'tus-single', 'png' );
		const buffer = await fs.readFile(
			path.resolve( __dirname, 'fixtures/test-image.png' )
		);
		await input.setInputFiles( {
			name: filename,
			mimeType: 'image/png',
			buffer,
		} );

		const id = await waitForMediaNewUpload( page, filename );

		expect( requests.creations ).toHaveLength( 1 );
		expect( requests.patches ).toHaveLength( 1 );

		const attachment = await getAttachment( page, id );
		expect( attachment.source_url ).toContain( filename );
		expect( await getAttachmentFileSize( page, attachment ) ).toBe(
			buffer.length
		);
		expect( await countStoredUploads( page ) ).toBe( 0 );
	} );

	test( 'uploads a file larger than one chunk in several PATCH requests', async ( {
		page,
	}, testInfo ) => {
		const size = 2 * TUS_CHUNK_SIZE + 1024;
		const filename = uniqueFilename( 'tus-chunks', 'txt' );
		const filePath = await createTextFile( testInfo, filename, size );

		const requests = recordTusRequests( page );
		const input = await gotoMediaNew( page );
		await input.setInputFiles( filePath );

		const id = await waitForMediaNewUpload( page, filename, 60000 );

		expect( requests.creations ).toHaveLength( 1 );
		expect(
			requests.patches.map(
				( request ) => request.headers()[ 'upload-offset' ]
			)
		).toEqual( [
			'0',
			String( TUS_CHUNK_SIZE ),
			String( 2 * TUS_CHUNK_SIZE ),
		] );

		const attachment = await getAttachment( page, id );
		expect( await getAttachmentFileSize( page, attachment ) ).toBe( size );
	} );

	test( 'resumes an interrupted upload after a reload through the resume UI', async ( {
		page,
	}, testInfo ) => {
		const size = 2 * TUS_CHUNK_SIZE + 1024;
		const filename = uniqueFilename( 'tus-resume', 'txt' );
		const filePath = await createTextFile( testInfo, filename, size );

		/*
		 * Chrome's native file picker can't be driven by Playwright, so make
		 * the resume UI fall back to its file input, as in other browsers.
		 */
		await page.addInitScript( () => {
			delete ( Window.prototype as unknown as Record< string, unknown > )
				.showOpenFilePicker;
			delete ( window as unknown as Record< string, unknown > )
				.showOpenFilePicker;
		} );

		// Let the first chunk through, then drop the connection.
		let patchAttempts = 0;
		await page.route( TUS_UPLOAD_URL, async ( route ) => {
			if ( 'PATCH' === route.request().method() && ++patchAttempts > 1 ) {
				await route.abort( 'internetdisconnected' );
				return;
			}
			await route.fallback();
		} );

		const input = await gotoMediaNew( page );
		await input.setInputFiles( filePath );

		// The second attempt only starts once the server acknowledged the first chunk.
		await expect.poll( () => patchAttempts ).toBeGreaterThan( 1 );

		await page.reload();
		await page.unrouteAll( { behavior: 'ignoreErrors' } );

		const pendingItem = page
			.locator( '#uploads-unleashed-pending li' )
			.filter( { hasText: filename } );
		await expect( pendingItem ).toBeVisible();
		await expect( pendingItem.locator( '.filesize' ) ).toContainText(
			`${ Math.round( ( TUS_CHUNK_SIZE / size ) * 100 ) }%`
		);

		const requests = recordTusRequests( page );
		const fileChooserPromise = page.waitForEvent( 'filechooser' );
		await pendingItem.getByRole( 'button', { name: /^Resume/ } ).click();
		await ( await fileChooserPromise ).setFiles( filePath );

		await expect( pendingItem ).toHaveCount( 0 );

		const id = await waitForMediaNewUpload( page, filename, 60000 );

		expect( requests.creations ).toHaveLength( 0 );
		expect(
			requests.patches.map(
				( request ) => request.headers()[ 'upload-offset' ]
			)
		).toEqual( [ String( TUS_CHUNK_SIZE ), String( 2 * TUS_CHUNK_SIZE ) ] );

		const attachment = await getAttachment( page, id );
		expect( await getAttachmentFileSize( page, attachment ) ).toBe( size );
		expect( await countStoredUploads( page ) ).toBe( 0 );
	} );
} );

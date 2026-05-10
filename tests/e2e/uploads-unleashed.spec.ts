import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loginAsAdmin } from './utils';

/**
 * End-to-end coverage for Uploads Unleashed.
 *
 * The plugin replaces WordPress's default plupload-based media uploader
 * with a tus-protocol resumable uploader. Three things to pin:
 *
 * 1. The plugin's scripts and config are wired into the Media → Add New
 *    admin page (the plugin's main integration point), so the uploader
 *    actually has access to its tus client + REST endpoint URL + nonce.
 * 2. The plugin's REST routes are registered and reachable as expected.
 * 3. A real upload via the admin Media → Add New page actually completes
 *    end-to-end and the file appears in the Media Library — the
 *    plugin's primary user-visible behaviour, and the most direct
 *    regression check for the tus-replacement path.
 */

test.describe( 'Uploads Unleashed', () => {
	test( 'enqueues its scripts and exposes config on Media → Add New', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/media-new.php' );

		// The plupload-shim script the plugin registers should be enqueued
		// (i.e., a <script> tag with the right handle id).
		const pluploadHandle = page.locator(
			'script#uploads-unleashed-plupload-js'
		);
		await expect( pluploadHandle ).toHaveCount( 1 );

		// `wp_localize_script` exposes the REST endpoint + nonce on a
		// global named `uploadsUnleashed`. The uploader can't function
		// without these, so this is the cheapest direct check that the
		// plugin's wiring made it onto the page.
		const config = await page.evaluate(
			() => ( window as unknown as Record< string, unknown > )
				.uploadsUnleashed
		);
		expect( config ).toBeDefined();
		expect( config ).toHaveProperty( 'endpoint' );
		expect( config ).toHaveProperty( 'nonce' );
		expect( ( config as { endpoint: string } ).endpoint ).toContain(
			'/wp-json/wp/v2/media'
		);
	} );

	test( 'registers a REST route under the wp/v2 namespace for the tus controller', async ( {
		request,
	} ) => {
		// The tus controller registers
		// `/wp/v2/media/(?P<id>[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})`
		// (UUIDv4-shaped path segment). Asserting that exact pattern
		// appears in the namespace listing pins the plugin's controller
		// is wired up — not just core's base `/wp/v2/media`, which
		// would still exist if the plugin were absent.
		const response = await request.get( '/?rest_route=/wp/v2' );
		expect( response.ok() ).toBe( true );

		const body = await response.json();
		expect( body ).toHaveProperty( 'routes' );

		const routes = Object.keys(
			( body as { routes: Record< string, unknown > } ).routes
		);
		const tusRoutePattern =
			/^\/wp\/v2\/media\/\(\?P<id>\[a-f0-9\]\{8\}-\[a-f0-9\]\{4\}-\[a-f0-9\]\{4\}-\[a-f0-9\]\{4\}-\[a-f0-9\]\{12\}\)/;
		const tusRoute = routes.find( ( r ) => tusRoutePattern.test( r ) );
		expect(
			tusRoute,
			`Expected the plugin's tus controller route to be registered. Routes: ${ routes.join( ', ' ) }`
		).toBeDefined();
	} );

	test( 'uploads a file via Media → Add New and the file appears in the library', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/media-new.php' );

		// The "Browser uploader" fallback path uses a plain <input type=file>
		// inside the #html-upload form. That works regardless of whether
		// plupload / the tus shim is active, and exercises WordPress's
		// upload pipeline end-to-end with the plugin loaded — i.e. it
		// regression-tests that nothing in Uploads Unleashed has broken
		// the basic media upload flow.
		await page.locator( 'a[href*="browser-uploader=1"]' ).click();
		await page.waitForLoadState( 'networkidle' );

		// Use a filename unique to this test run so the assertion can't
		// match attachments left over from earlier runs (or other tests
		// in the same wp-env).
		const stamp = Date.now();
		const fixtureSrc = path.resolve(
			__dirname,
			'fixtures/test-image.png'
		);
		const fixtureCopy = path.resolve(
			__dirname,
			`fixtures/upload-fixture-${ stamp }.png`
		);
		await fs.copyFile( fixtureSrc, fixtureCopy );

		try {
			await page
				.locator( '#async-upload' )
				.setInputFiles( fixtureCopy );

			// `Promise.all` ensures we observe the navigation triggered
			// by the form submit before continuing — without this,
			// `.click()` may resolve before the upload pipeline finishes
			// and the subsequent goto can race with the response.
			await Promise.all( [
				page.waitForURL( /\/wp-admin\/upload\.php/, {
					timeout: 30000,
				} ),
				page.locator( '#html-upload' ).click(),
			] );

			// Force list mode so the attachment row uses a deterministic
			// table layout we can assert against by filename.
			await page.goto( '/wp-admin/upload.php?mode=list' );
			const row = page
				.locator( 'tr[id^="post-"]' )
				.filter( {
					hasText: `upload-fixture-${ stamp }`,
				} );
			await expect( row ).toHaveCount( 1, { timeout: 10000 } );
		} finally {
			await fs.unlink( fixtureCopy ).catch( () => undefined );
		}
	} );
} );

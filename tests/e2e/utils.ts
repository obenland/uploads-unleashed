import type { Page } from '@playwright/test';

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

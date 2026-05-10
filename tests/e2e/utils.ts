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

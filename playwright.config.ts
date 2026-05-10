import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end tests against the wp-env environment.
 *
 * The wp-env default port is 8888; override with `WP_ENV_PORT` to test
 * against a different port.
 */
export default defineConfig( {
	testDir: './tests/e2e',
	fullyParallel: false,
	forbidOnly: !! process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'html',
	use: {
		baseURL: `http://localhost:${ process.env.WP_ENV_PORT ?? '8888' }`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices[ 'Desktop Chrome' ] },
		},
	],
} );

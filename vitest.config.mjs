/**
 * Vitest configuration for Uploads Unleashed.
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Resolves a path relative to the project root.
 *
 * @param {string} relativePath Path relative to this file.
 * @return {string} Absolute path.
 */
const fromRoot = ( relativePath ) =>
	fileURLToPath( new URL( relativePath, import.meta.url ) );

export default defineConfig( {
	resolve: {
		alias: [
			{
				find: /^@wordpress\/data$/,
				replacement: fromRoot(
					'./tests/js/__mocks__/@wordpress/data.js'
				),
			},
			{
				find: /^@wordpress\/i18n$/,
				replacement: fromRoot(
					'./tests/js/__mocks__/@wordpress/i18n.js'
				),
			},
			{
				find: /^@wordpress\/notices$/,
				replacement: fromRoot(
					'./tests/js/__mocks__/@wordpress/notices.js'
				),
			},
			{
				find: /^@uploads-unleashed\/tus-client$/,
				replacement: fromRoot( './src/tus-client.js' ),
			},
		],
	},
	test: {
		include: [ 'tests/js/**/*.test.js' ],
		environment: 'jsdom',
		globals: false,
		setupFiles: [ './tests/js/setup.js' ],
	},
} );

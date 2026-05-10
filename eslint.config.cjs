/**
 * ESLint flat config (ESLint 10 / @wordpress/scripts 32+).
 *
 * Extends the default flat config from @wordpress/scripts and layers
 * project-specific overrides on top:
 *
 * - `import/no-unresolved` ignores `@uploads-unleashed/*` paths because
 *   they're a webpack alias (see webpack.config.js -> resolve.alias).
 *   ESLint can't resolve them without an import resolver plugin, but
 *   the build tool can.
 * - `DataTransfer` is added as a browser global for `src/`.
 * - `Document` is added as a browser global for the test files (used
 *   for prototype descriptor manipulation).
 * - The wp-scripts test-unit overrides default to `**`/`@(test|__tests__)/**`/`*.js`
 *   patterns; this project keeps unit tests under `tests/js/`, so the
 *   overrides are re-applied under that path so jest globals and
 *   jest/* rules apply.
 */

// eslint-disable-next-line import/no-extraneous-dependencies -- transitive of @wordpress/scripts
const wpPlugin = require( '@wordpress/eslint-plugin' );
const baseConfig = require( '@wordpress/scripts/config/eslint.config.cjs' );

module.exports = [
	{
		// .eslintignore is no longer honoured under flat config; replicate
		// it here as the canonical ignores list.
		ignores: [ 'build/**', 'coverage/**', 'vendor/**', 'src/vendor/**' ],
	},
	...baseConfig,
	{
		files: [ 'src/**/*.js' ],
		languageOptions: {
			globals: {
				DataTransfer: 'readonly',
			},
		},
		rules: {
			'import/no-unresolved': [
				'error',
				{
					ignore: [ '^@uploads-unleashed/' ],
				},
			],
		},
	},
	// Re-apply the test-unit overrides under the project's tests/js path.
	...wpPlugin.configs[ 'test-unit' ].map( ( c ) => ( {
		...c,
		files: [ 'tests/js/**/*.js' ],
	} ) ),
	{
		files: [ 'tests/js/**/*.js' ],
		languageOptions: {
			globals: {
				Document: 'readonly',
			},
		},
	},
];

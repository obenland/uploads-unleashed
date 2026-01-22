/**
 * Jest configuration for Resumable Uploads.
 *
 * @type {import('@jest/types').Config.InitialOptions}
 */
module.exports = {
	preset: '@wordpress/jest-preset-default',
	testMatch: [ '**/tests/js/**/*.test.[jt]s?(x)' ],
	setupFilesAfterEnv: [ '<rootDir>/tests/js/setup.js' ],
	testEnvironment: 'jsdom',
	moduleNameMapper: {
		'^@wordpress/i18n$': '<rootDir>/tests/js/__mocks__/@wordpress/i18n.js',
	},
	transform: {
		'\\.[jt]sx?$':
			'<rootDir>/node_modules/@wordpress/scripts/config/babel-transform.js',
	},
};

/**
 * Jest configuration for Uploads Unleashed.
 *
 * @type {import('@jest/types').Config.InitialOptions}
 */
module.exports = {
	preset: '@wordpress/jest-preset-default',
	testMatch: [ '**/tests/js/**/*.test.[jt]s?(x)' ],
	setupFilesAfterEnv: [ '<rootDir>/tests/js/setup.js' ],
	testEnvironment: 'jsdom',
	moduleNameMapper: {
		'^@wordpress/data$': '<rootDir>/tests/js/__mocks__/@wordpress/data.js',
		'^@wordpress/i18n$': '<rootDir>/tests/js/__mocks__/@wordpress/i18n.js',
		'^@wordpress/notices$':
			'<rootDir>/tests/js/__mocks__/@wordpress/notices.js',
		'^@uploads-unleashed/tus-client$': '<rootDir>/src/tus-client.js',
	},
	transform: {
		'\\.[jt]sx?$':
			'<rootDir>/node_modules/@wordpress/scripts/config/babel-transform.js',
	},
};

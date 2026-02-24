/**
 * Mock for @wordpress/data module.
 */

module.exports = {
	dispatch: jest.fn( () => ( {
		createWarningNotice: jest.fn(),
		createInfoNotice: jest.fn(),
	} ) ),
};

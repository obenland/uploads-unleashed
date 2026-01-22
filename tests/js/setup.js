/**
 * Jest test setup for Resumable Uploads.
 *
 * Mocks WordPress globals and browser APIs needed for testing.
 */

// Mock localStorage
const localStorageMock = ( () => {
	let store = {};
	return {
		getItem: ( key ) => store[ key ] || null,
		setItem: ( key, value ) => {
			store[ key ] = value;
		},
		removeItem: ( key ) => {
			delete store[ key ];
		},
		clear: () => {
			store = {};
		},
		get length() {
			return Object.keys( store ).length;
		},
		key: ( index ) => Object.keys( store )[ index ] || null,
	};
} )();

Object.defineProperty( window, 'localStorage', { value: localStorageMock } );

// Mock window.resumableUploads config
Object.defineProperty( window, 'resumableUploads', {
	value: {
		endpoint: '/wp-json/wp/v2/media/tus',
		nonce: 'test-nonce-123',
		chunkSize: 5 * 1024 * 1024,
	},
	writable: true,
} );

// Export for test access
module.exports = { localStorageMock };

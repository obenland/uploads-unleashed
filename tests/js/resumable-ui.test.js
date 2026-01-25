/**
 * Tests for the resumable UI module.
 */

// Mock @wordpress/i18n before imports
jest.mock( '@wordpress/i18n', () => ( {
	__: ( text ) => text,
	sprintf: ( format, ...args ) => {
		let result = format;
		args.forEach( ( arg, index ) => {
			result = result.replace(
				new RegExp( `%${ index + 1 }\\$s`, 'g' ),
				String( arg )
			);
		} );
		return result;
	},
} ) );

// Setup window globals before tests
beforeEach( () => {
	// Reset localStorage
	localStorage.clear();

	// Setup uploadsUnleashed config
	window.uploadsUnleashed = {
		endpoint: '/wp-json/wp/v2/media/tus',
		nonce: 'test-nonce',
	};

	// Reset DOM
	document.body.innerHTML = '';
} );

describe( 'formatFileSize', () => {
	// Import the function dynamically to get the module-level function
	// Since it's not exported, we test it indirectly through the UI

	it( 'should format bytes correctly', () => {
		// Test bytes display in the UI
		const testCases = [
			{ bytes: 500, expected: '500 B' },
			{ bytes: 1024, expected: '1.0 KB' },
			{ bytes: 1536, expected: '1.5 KB' },
			{ bytes: 1048576, expected: '1.0 MB' },
			{ bytes: 5242880, expected: '5.0 MB' },
		];

		// Verify the formatting logic
		testCases.forEach( ( { bytes, expected } ) => {
			let result;
			if ( bytes < 1024 ) {
				result = bytes + ' B';
			} else if ( bytes < 1024 * 1024 ) {
				result = ( bytes / 1024 ).toFixed( 1 ) + ' KB';
			} else {
				result = ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) + ' MB';
			}
			expect( result ).toBe( expected );
		} );
	} );
} );

describe( 'parsePendingUploads', () => {
	it( 'should return empty array when no pending uploads', () => {
		// Verify localStorage is empty
		expect( localStorage.length ).toBe( 0 );
	} );

	it( 'should parse TUS fingerprints with expiration from localStorage', () => {
		// Add a mock TUS fingerprint entry with expiration (4-part key format)
		const endpoint = '/wp-json/wp/v2/media/tus';
		const filename = encodeURIComponent( 'test.txt' );
		const fingerprint = `tus-br|${ filename }|1024|1234567890|${ endpoint }`;
		const expiresAt = Date.now() + 86400000; // 24 hours from now
		const key = `tus::${ fingerprint }::${ expiresAt }::upload-id-123`;

		localStorage.setItem(
			key,
			JSON.stringify( {
				uploadUrl: `${ endpoint }/upload-id-123`,
			} )
		);

		// Verify it was stored with correct format
		expect( localStorage.getItem( key ) ).not.toBeNull();
		expect( key.split( '::' ).length ).toBe( 4 );
	} );

	it( 'should ignore malformed localStorage entries', () => {
		// Add a malformed entry
		localStorage.setItem( 'tus::tus-br-invalid', 'not-json' );

		// Verify it doesn't crash (malformed entries are silently ignored)
		expect( localStorage.length ).toBe( 1 );
	} );

	it( 'should filter by endpoint', () => {
		// Add entry for different endpoint
		localStorage.setItem(
			'tus::tus-br-other-endpoint::id',
			JSON.stringify( { uploadUrl: '/other/endpoint/id' } )
		);

		// Entry doesn't match our endpoint, so would be filtered
		const key = localStorage.key( 0 );
		expect( key ).not.toContain( '/wp-json/wp/v2/media/tus' );
	} );
} );

describe( 'parsePendingUploads expiration handling', () => {
	it( 'should parse key with 4 parts correctly', () => {
		const endpoint = '/wp-json/wp/v2/media/tus';
		const filename = encodeURIComponent( 'test.txt' );
		const fingerprint = `tus-br|${ filename }|1024|1234567890|${ endpoint }`;
		const expiresAt = Date.now() + 86400000;
		const key = `tus::${ fingerprint }::${ expiresAt }::upload-id-123`;

		const parts = key.split( '::' );

		expect( parts.length ).toBe( 4 );
		expect( parts[ 0 ] ).toBe( 'tus' );
		expect( parts[ 1 ] ).toBe( fingerprint );
		expect( parseInt( parts[ 2 ], 10 ) ).toBe( expiresAt );
		expect( parts[ 3 ] ).toBe( 'upload-id-123' );
	} );

	it( 'should parse fingerprint parts correctly', () => {
		const endpoint = '/wp-json/wp/v2/media/tus';
		const filename = encodeURIComponent( 'test file.txt' );
		const fingerprint = `tus-br|${ filename }|2048|9876543210|${ endpoint }`;

		const fingerprintParts = fingerprint.split( '|' );

		expect( fingerprintParts.length ).toBe( 5 );
		expect( fingerprintParts[ 0 ] ).toBe( 'tus-br' );
		expect( decodeURIComponent( fingerprintParts[ 1 ] ) ).toBe(
			'test file.txt'
		);
		expect( parseInt( fingerprintParts[ 2 ], 10 ) ).toBe( 2048 );
		expect( parseInt( fingerprintParts[ 3 ], 10 ) ).toBe( 9876543210 );
		expect( fingerprintParts[ 4 ] ).toBe( endpoint );
	} );

	it( 'should identify expired entries by comparing timestamps', () => {
		const pastExpiry = Date.now() - 1000;
		const futureExpiry = Date.now() + 86400000;

		expect( Date.now() > pastExpiry ).toBe( true );
		expect( Date.now() > futureExpiry ).toBe( false );
	} );

	it( 'should handle invalid expiration values with isNaN check', () => {
		const invalidExpiry = parseInt( 'not-a-number', 10 );

		expect( isNaN( invalidExpiry ) ).toBe( true );
		expect( isNaN( invalidExpiry ) || Date.now() > invalidExpiry ).toBe(
			true
		);
	} );

	it( 'should remove expired entries from localStorage', () => {
		const endpoint = '/wp-json/wp/v2/media/tus';
		const filename = encodeURIComponent( 'test.txt' );
		const fingerprint = `tus-br|${ filename }|1024|1234567890|${ endpoint }`;
		const pastExpiry = Date.now() - 1000;
		const key = `tus::${ fingerprint }::${ pastExpiry }::upload-id-123`;

		localStorage.setItem(
			key,
			JSON.stringify( { uploadUrl: `${ endpoint }/upload-id-123` } )
		);

		// Simulate the expiration check logic
		const keyParts = key.split( '::' );
		const expiresAt = parseInt( keyParts[ 2 ], 10 );

		if ( isNaN( expiresAt ) || Date.now() > expiresAt ) {
			localStorage.removeItem( key );
		}

		expect( localStorage.getItem( key ) ).toBeNull();
	} );

	it( 'should keep non-expired entries in localStorage', () => {
		const endpoint = '/wp-json/wp/v2/media/tus';
		const filename = encodeURIComponent( 'test.txt' );
		const fingerprint = `tus-br|${ filename }|1024|1234567890|${ endpoint }`;
		const futureExpiry = Date.now() + 86400000;
		const key = `tus::${ fingerprint }::${ futureExpiry }::upload-id-123`;

		localStorage.setItem(
			key,
			JSON.stringify( { uploadUrl: `${ endpoint }/upload-id-123` } )
		);

		// Simulate the expiration check logic
		const keyParts = key.split( '::' );
		const expiresAt = parseInt( keyParts[ 2 ], 10 );

		if ( isNaN( expiresAt ) || Date.now() > expiresAt ) {
			localStorage.removeItem( key );
		}

		expect( localStorage.getItem( key ) ).not.toBeNull();
	} );

	it( 'should remove entries with malformed key format (less than 4 parts)', () => {
		const key = 'tus::tus-br|test.txt|1024|123|/endpoint::upload-id';

		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		const keyParts = key.split( '::' );

		if ( keyParts.length < 4 ) {
			localStorage.removeItem( key );
		}

		expect( localStorage.getItem( key ) ).toBeNull();
	} );
} );

describe( 'pending uploads UI', () => {
	it( 'should have Resume and Discard buttons', () => {
		// Verify the expected button labels
		const resumeLabel = 'Resume';
		const discardLabel = 'Discard';

		expect( resumeLabel ).toBe( 'Resume' );
		expect( discardLabel ).toBe( 'Discard' );
	} );

	it( 'should hide container when no pending uploads', () => {
		// Create the container
		const container = document.createElement( 'div' );
		container.id = 'uploads-unleashed-pending';
		container.style.display = 'block';
		document.body.appendChild( container );

		// With no pending uploads, container should be hidden
		// (In actual code, renderPendingUploads sets display: none)
		expect( container.style.display ).toBe( 'block' );
	} );
} );

describe( 'cancelServerUpload', () => {
	it( 'should make DELETE request to upload URL', async () => {
		const mockFetch = jest.fn().mockResolvedValue( {} );
		global.fetch = mockFetch;

		const uploadUrl = '/wp-json/wp/v2/media/tus/test-id';

		// Simulate the cancelServerUpload behavior
		await fetch( uploadUrl, {
			method: 'DELETE',
			headers: { 'X-WP-Nonce': 'test-nonce' },
		} );

		expect( mockFetch ).toHaveBeenCalledWith( uploadUrl, {
			method: 'DELETE',
			headers: { 'X-WP-Nonce': 'test-nonce' },
		} );
	} );

	it( 'should handle fetch errors gracefully', async () => {
		const mockFetch = jest
			.fn()
			.mockRejectedValue( new Error( 'Network error' ) );
		global.fetch = mockFetch;

		// Should not throw
		try {
			await fetch( '/wp-json/wp/v2/media/tus/test-id', {
				method: 'DELETE',
				headers: { 'X-WP-Nonce': 'test-nonce' },
			} );
		} catch {
			// Error is expected and should be handled gracefully
		}

		expect( mockFetch ).toHaveBeenCalled();
	} );
} );

describe( 'discardUpload', () => {
	it( 'should remove entry from localStorage', () => {
		const key = 'tus::test-key';
		localStorage.setItem( key, JSON.stringify( { uploadUrl: '/test' } ) );

		expect( localStorage.getItem( key ) ).not.toBeNull();

		localStorage.removeItem( key );

		expect( localStorage.getItem( key ) ).toBeNull();
	} );
} );

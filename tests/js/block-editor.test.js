/**
 * Tests for the Block Editor TUS integration.
 */

// Mock tus-client module
jest.mock( '../../src/tus-client', () => ( {
	upload: jest.fn(),
	getPendingUploads: jest.fn( () => [] ),
} ) );

jest.mock( '@wordpress/hooks', () => ( {
	applyFilters: jest.fn( ( hookName, defaultValue ) => defaultValue ),
} ) );

jest.mock( '@wordpress/api-fetch', () => {
	const fn = jest.fn();
	fn.use = jest.fn();
	return { __esModule: true, default: fn };
} );

jest.mock( '@wordpress/data', () => ( {
	dispatch: jest.fn( () => ( {
		createWarningNotice: jest.fn(),
		createInfoNotice: jest.fn(),
	} ) ),
} ) );

jest.mock( '@wordpress/notices', () => ( {
	store: 'core/notices',
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( text ) => text,
	sprintf: ( format, ...args ) => {
		let result = format;
		let argIndex = 0;
		args.forEach( ( arg, index ) => {
			result = result.replace(
				new RegExp( `%${ index + 1 }\\$s`, 'g' ),
				String( arg )
			);
		} );
		result = result.replace( /%[ds]/g, () => String( args[ argIndex++ ] ) );
		return result.replace( /%%/g, '%' );
	},
	_n: ( single, plural, count ) => ( count === 1 ? single : plural ),
} ) );

import { upload } from '../../src/tus-client';

// Capture the middleware when it's registered
let tusMiddleware;

beforeAll( () => {
	const apiFetch = require( '@wordpress/api-fetch' ).default;
	apiFetch.use.mockImplementation( ( middleware ) => {
		tusMiddleware = middleware;
	} );

	// Import to trigger middleware registration
	require( '../../src/block-editor' );
} );

beforeEach( () => {
	jest.clearAllMocks();
	const { applyFilters } = require( '@wordpress/hooks' );
	applyFilters.mockImplementation(
		( hookName, defaultValue ) => defaultValue
	);
} );

describe( 'registerMiddleware', () => {
	it( 'registers middleware with apiFetch', () => {
		expect( tusMiddleware ).toBeDefined();
		expect( typeof tusMiddleware ).toBe( 'function' );
	} );
} );

describe( 'tusMiddleware', () => {
	let next;

	beforeEach( () => {
		next = jest.fn().mockResolvedValue( { id: 1 } );
	} );

	describe( 'isMediaUpload detection', () => {
		it( 'passes through non-POST requests', async () => {
			const options = {
				path: '/wp/v2/media',
				method: 'GET',
				body: new FormData(),
			};

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it( 'passes through non-media paths', async () => {
			const formData = new FormData();
			formData.append( 'file', new File( [ 'test' ], 'test.txt' ) );

			const options = {
				path: '/wp/v2/posts',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it( 'passes through requests without FormData body', async () => {
			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: { title: 'test' },
			};

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it( 'passes through FormData without file field', async () => {
			const formData = new FormData();
			formData.append( 'title', 'test' );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it( 'passes through FormData with non-File value for file field', async () => {
			const formData = new FormData();
			formData.append( 'file', 'not-a-file-object' );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it( 'intercepts media uploads with File in FormData', async () => {
			const file = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const formData = new FormData();
			formData.append( 'file', file );

			const attachmentData = { id: 123 };
			upload.mockResolvedValue( attachmentData );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			const result = await tusMiddleware( options, next );

			expect( upload ).toHaveBeenCalledWith( file, expect.any( Object ) );
			expect( next ).not.toHaveBeenCalled();
			expect( result ).toEqual( attachmentData );
		} );

		it( 'handles media paths with query strings', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			upload.mockResolvedValue( { id: 123 } );

			const options = {
				path: '/wp/v2/media?context=edit',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( upload ).toHaveBeenCalled();
		} );
	} );

	describe( 'TUS upload', () => {
		it( 'passes signal option to upload', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			const controller = new AbortController();
			upload.mockResolvedValue( { id: 123 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
				signal: controller.signal,
			};

			await tusMiddleware( options, next );

			expect( upload ).toHaveBeenCalledWith( file, {
				signal: controller.signal,
			} );
		} );

		it( 'returns attachment data on successful upload', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			const attachmentData = {
				id: 123,
				title: { rendered: 'Test' },
				source_url: 'http://example.com/test.txt',
			};
			upload.mockResolvedValue( attachmentData );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			const result = await tusMiddleware( options, next );

			expect( result ).toEqual( attachmentData );
		} );
	} );

	describe( 'fallback behavior', () => {
		it( 'falls back to standard upload on TUS error', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			const tusError = new Error( 'Network error' );
			upload.mockRejectedValue( tusError );
			next.mockResolvedValue( { id: 456 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			const result = await tusMiddleware( options, next );

			expect( upload ).toHaveBeenCalled();
			expect( next ).toHaveBeenCalledWith( options );
			expect( result ).toEqual( { id: 456 } );
			expect( console ).toHaveWarned();
		} );

		it( 'dispatches warning notice on TUS failure before fallback', async () => {
			const { dispatch } = require( '@wordpress/data' );
			const mockCreateWarningNotice = jest.fn();
			dispatch.mockReturnValue( {
				createWarningNotice: mockCreateWarningNotice,
				createInfoNotice: jest.fn(),
			} );

			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			upload.mockRejectedValue( new Error( 'Network error' ) );
			next.mockResolvedValue( { id: 456 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( dispatch ).toHaveBeenCalled();
			expect( mockCreateWarningNotice ).toHaveBeenCalledWith(
				'Resumable upload unavailable for this file. Using standard upload.',
				expect.objectContaining( {
					id: 'uploads-unleashed-fallback-test.txt',
					isDismissible: true,
					type: 'snackbar',
				} )
			);
			expect( console ).toHaveWarned();
		} );

		it( 'warning notice has snackbar type', async () => {
			const { dispatch } = require( '@wordpress/data' );
			const mockCreateWarningNotice = jest.fn();
			dispatch.mockReturnValue( {
				createWarningNotice: mockCreateWarningNotice,
				createInfoNotice: jest.fn(),
			} );

			const file = new File( [ 'test' ], 'report.pdf' );
			const formData = new FormData();
			formData.append( 'file', file );

			upload.mockRejectedValue( new Error( 'Server error' ) );
			next.mockResolvedValue( { id: 789 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( mockCreateWarningNotice ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.objectContaining( {
					type: 'snackbar',
				} )
			);
			expect( console ).toHaveWarned();
		} );

		it( 'respects allowFallback filter returning false', async () => {
			const { applyFilters } = require( '@wordpress/hooks' );
			const { dispatch } = require( '@wordpress/data' );
			const mockCreateWarningNotice = jest.fn();
			dispatch.mockReturnValue( {
				createWarningNotice: mockCreateWarningNotice,
				createInfoNotice: jest.fn(),
			} );

			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			const tusError = new Error( 'TUS failed' );
			upload.mockRejectedValue( tusError );
			applyFilters.mockImplementation( ( hookName, defaultValue ) => {
				if ( hookName === 'uploadsUnleashed.allowFallback' ) {
					return false;
				}
				return defaultValue;
			} );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await expect( tusMiddleware( options, next ) ).rejects.toThrow(
				'TUS failed'
			);

			expect( applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.allowFallback',
				true,
				tusError,
				file
			);
			expect( next ).not.toHaveBeenCalled();
			// Warning is logged before checking allowFallback filter
			expect( console ).toHaveWarned();
			// Notice should NOT be dispatched — fallback didn't happen
			expect( mockCreateWarningNotice ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'shouldUseTus filter', () => {
		it( 'skips TUS when filter returns false', async () => {
			const { applyFilters } = require( '@wordpress/hooks' );
			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );
			const formData = new FormData();
			formData.append( 'file', file );

			applyFilters.mockImplementation( ( hookName, defaultValue ) => {
				if ( hookName === 'uploadsUnleashed.shouldUseTus' ) {
					return false;
				}
				return defaultValue;
			} );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it( 'uses TUS when filter returns true', async () => {
			const file = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const formData = new FormData();
			formData.append( 'file', file );

			upload.mockResolvedValue( { id: 123 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( upload ).toHaveBeenCalled();
			expect( next ).not.toHaveBeenCalled();
		} );

		it( 'passes file to the filter', async () => {
			const { applyFilters } = require( '@wordpress/hooks' );
			const file = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const formData = new FormData();
			formData.append( 'file', file );

			upload.mockResolvedValue( { id: 123 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.shouldUseTus',
				true,
				file
			);
		} );
	} );
} );

describe( 'pending uploads notice', () => {
	it( 'dispatches info notice when pending uploads exist', () => {
		const { dispatch } = require( '@wordpress/data' );
		const mockCreateInfoNotice = jest.fn();
		dispatch.mockReturnValue( {
			createWarningNotice: jest.fn(),
			createInfoNotice: mockCreateInfoNotice,
		} );

		const { getPendingUploads } = require( '../../src/tus-client' );
		getPendingUploads.mockReturnValue( [
			{ key: 'k1', filename: 'test.txt', size: 1024 },
		] );

		jest.isolateModules( () => {
			const apiFetch = require( '@wordpress/api-fetch' ).default;
			apiFetch.use = jest.fn();
			require( '../../src/block-editor' );
		} );

		expect( mockCreateInfoNotice ).toHaveBeenCalledWith(
			expect.stringContaining( '1' ),
			expect.objectContaining( {
				id: 'uploads-unleashed-pending',
				isDismissible: true,
				type: 'snackbar',
			} )
		);
	} );

	it( 'does not dispatch notice when no pending uploads', () => {
		const { dispatch } = require( '@wordpress/data' );
		const mockCreateInfoNotice = jest.fn();
		dispatch.mockReturnValue( {
			createWarningNotice: jest.fn(),
			createInfoNotice: mockCreateInfoNotice,
		} );

		const { getPendingUploads } = require( '../../src/tus-client' );
		getPendingUploads.mockReturnValue( [] );

		jest.isolateModules( () => {
			const apiFetch = require( '@wordpress/api-fetch' ).default;
			apiFetch.use = jest.fn();
			require( '../../src/block-editor' );
		} );

		expect( mockCreateInfoNotice ).not.toHaveBeenCalled();
	} );
} );

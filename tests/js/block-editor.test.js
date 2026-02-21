/**
 * Tests for the Block Editor TUS integration.
 */

// Mock tus-client module
jest.mock( '../../src/tus-client', () => ( {
	upload: jest.fn(),
} ) );

import { upload } from '../../src/tus-client';

// Capture the middleware when it's registered
let tusMiddleware;

// Setup wp.apiFetch mock
beforeAll( () => {
	window.wp = {
		apiFetch: {
			use: jest.fn( ( middleware ) => {
				tusMiddleware = middleware;
			} ),
		},
		hooks: {
			applyFilters: jest.fn( ( hookName, defaultValue ) => defaultValue ),
		},
	};

	// Import to trigger registerMiddleware
	require( '../../src/block-editor' );
} );

beforeEach( () => {
	jest.clearAllMocks();
	window.wp.hooks.applyFilters.mockImplementation(
		( hookName, defaultValue ) => defaultValue
	);
} );

describe( 'registerMiddleware', () => {
	it( 'registers middleware with wp.apiFetch', () => {
		expect( tusMiddleware ).toBeDefined();
		expect( typeof tusMiddleware ).toBe( 'function' );
	} );

	it( 'does not throw when wp.apiFetch is not available', () => {
		const originalWp = window.wp;
		window.wp = undefined;

		expect( () => {
			jest.isolateModules( () => {
				require( '../../src/block-editor' );
			} );
		} ).not.toThrow();

		window.wp = originalWp;
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

		it( 'respects allowFallback filter returning false', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			const tusError = new Error( 'TUS failed' );
			upload.mockRejectedValue( tusError );
			window.wp.hooks.applyFilters.mockImplementation(
				( hookName, defaultValue ) => {
					if ( hookName === 'uploadsUnleashed.allowFallback' ) {
						return false;
					}
					return defaultValue;
				}
			);

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await expect( tusMiddleware( options, next ) ).rejects.toThrow(
				'TUS failed'
			);

			expect( window.wp.hooks.applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.allowFallback',
				true,
				tusError,
				file
			);
			expect( next ).not.toHaveBeenCalled();
			// Warning is logged before checking allowFallback filter
			expect( console ).toHaveWarned();
		} );
	} );

	describe( 'shouldUseTus filter', () => {
		it( 'skips TUS when filter returns false', async () => {
			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );
			const formData = new FormData();
			formData.append( 'file', file );

			window.wp.hooks.applyFilters.mockImplementation(
				( hookName, defaultValue ) => {
					if ( hookName === 'uploadsUnleashed.shouldUseTus' ) {
						return false;
					}
					return defaultValue;
				}
			);

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

			expect( window.wp.hooks.applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.shouldUseTus',
				true,
				file
			);
		} );

		it( 'defaults to TUS when wp.hooks is unavailable', async () => {
			const file = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );
			const formData = new FormData();
			formData.append( 'file', file );

			const originalHooks = window.wp.hooks;
			window.wp.hooks = undefined;

			upload.mockResolvedValue( { id: 123 } );

			const options = {
				path: '/wp/v2/media',
				method: 'POST',
				body: formData,
			};

			await tusMiddleware( options, next );

			expect( upload ).toHaveBeenCalled();
			expect( next ).not.toHaveBeenCalled();

			window.wp.hooks = originalHooks;
		} );
	} );
} );

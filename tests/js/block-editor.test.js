/**
 * Tests for the Block Editor TUS integration.
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// Mock tus-client module
vi.mock( '../../src/tus-client', () => ( {
	upload: vi.fn(),
	getPendingUploads: vi.fn( () => [] ),
} ) );

vi.mock( '@wordpress/hooks', () => ( {
	applyFilters: vi.fn( ( hookName, defaultValue ) => defaultValue ),
} ) );

vi.mock( '@wordpress/api-fetch', () => {
	const fn = vi.fn();
	fn.use = vi.fn();
	return { __esModule: true, default: fn };
} );

vi.mock( '@wordpress/data', () => ( {
	dispatch: vi.fn( () => ( {
		createWarningNotice: vi.fn(),
		createInfoNotice: vi.fn(),
	} ) ),
} ) );

vi.mock( '@wordpress/notices', () => ( {
	store: 'core/notices',
} ) );

vi.mock( '@wordpress/i18n', () => ( {
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

import apiFetch from '@wordpress/api-fetch';
import { dispatch } from '@wordpress/data';
import { applyFilters } from '@wordpress/hooks';
import { upload } from '../../src/tus-client';

// Capture the middleware when it's registered
let tusMiddleware;

// Silences and records the fallback warnings logged by the middleware.
let consoleWarn;

beforeAll( async () => {
	apiFetch.use.mockImplementation( ( middleware ) => {
		tusMiddleware = middleware;
	} );

	// Import to trigger middleware registration
	await import( '../../src/block-editor' );
} );

beforeEach( () => {
	vi.clearAllMocks();
	consoleWarn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	applyFilters.mockImplementation(
		( hookName, defaultValue ) => defaultValue
	);
} );

afterEach( () => {
	consoleWarn.mockRestore();
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
		next = vi.fn().mockResolvedValue( { id: 1 } );
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

		it( 'intercepts the block editor upload path with _embed', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );

			upload.mockResolvedValue( { id: 123 } );

			await tusMiddleware(
				{
					path: '/wp/v2/media?_embed=wp:featuredmedia',
					method: 'POST',
					body: formData,
				},
				next
			);

			expect( upload ).toHaveBeenCalled();
			expect( next ).not.toHaveBeenCalled();
		} );

		it.each( [
			'/wp/v2/media/123/sideload',
			'/wp/v2/media/123/sideload?_locale=user',
			'/wp/v2/media/123/finalize',
			'/wp/v2/media/123/edit',
			'/wp/v2/media/123',
			'/wp/v2/media-library',
			'/my-plugin/v1/wp/v2/media',
		] )( 'passes through %s', async ( path ) => {
			const formData = new FormData();
			formData.append(
				'file',
				new File( [ 'test' ], 'image-150x150.png' )
			);

			const options = { path, method: 'POST', body: formData };

			await tusMiddleware( options, next );

			expect( next ).toHaveBeenCalledWith( options );
			expect( upload ).not.toHaveBeenCalled();
		} );

		it.each( [ 'generate_sub_sizes', 'convert_format' ] )(
			'intercepts uploads with %s=false and passes the flag on',
			async ( field ) => {
				const file = new File( [ 'test' ], 'image.png' );
				const formData = new FormData();
				formData.append( 'file', file );
				formData.append( field, 'false' );

				upload.mockResolvedValue( { id: 123 } );

				await tusMiddleware(
					{
						path: '/wp/v2/media?_embed=wp:featuredmedia',
						method: 'POST',
						body: formData,
					},
					next
				);

				expect( upload ).toHaveBeenCalledWith(
					file,
					expect.objectContaining( {
						params: expect.objectContaining( {
							[ field ]: 'false',
						} ),
					} )
				);
				expect( next ).not.toHaveBeenCalled();
			}
		);

		it( 'intercepts uploads with generate_sub_sizes=true and convert_format=true', async () => {
			const formData = new FormData();
			formData.append( 'file', new File( [ 'video' ], 'movie.mp4' ) );
			formData.append( 'generate_sub_sizes', 'true' );
			formData.append( 'convert_format', 'true' );

			upload.mockResolvedValue( { id: 123 } );

			await tusMiddleware(
				{
					path: '/wp/v2/media?_embed=wp:featuredmedia',
					method: 'POST',
					body: formData,
				},
				next
			);

			expect( upload ).toHaveBeenCalled();
			expect( next ).not.toHaveBeenCalled();
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

			expect( upload ).toHaveBeenCalledWith(
				file,
				expect.objectContaining( { signal: controller.signal } )
			);
		} );

		it( 'passes the form fields to upload as params', async () => {
			const file = new File( [ 'test' ], 'test.txt' );
			const formData = new FormData();
			formData.append( 'file', file );
			formData.append( 'post', '42' );
			formData.append( 'alt_text', 'A test file' );

			upload.mockResolvedValue( { id: 123 } );

			await tusMiddleware(
				{ path: '/wp/v2/media', method: 'POST', body: formData },
				next
			);

			expect( upload ).toHaveBeenCalledWith(
				file,
				expect.objectContaining( {
					params: expect.objectContaining( {
						post: '42',
						alt_text: 'A test file',
					} ),
				} )
			);
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
		/**
		 * Builds the error `upload()` rejects with, wrapping a TUS DetailedError.
		 *
		 * @param {string}      message Error message.
		 * @param {string}      method  Method of the failed request.
		 * @param {number|null} status  Response status, or null for a network error.
		 * @param {Object}      headers Request headers.
		 * @return {Error} The error.
		 */
		const tusError = ( message, method, status, headers = {} ) =>
			new Error( message, {
				cause: {
					originalRequest: {
						getMethod: () => method,
						getHeader: ( name ) => headers[ name ],
					},
					originalResponse:
						null === status ? null : { getStatus: () => status },
				},
			} );

		/**
		 * Builds a media upload request.
		 *
		 * @return {Object} apiFetch options.
		 */
		const uploadRequest = () => {
			const formData = new FormData();
			formData.append( 'file', new File( [ 'test' ], 'test.txt' ) );

			return { path: '/wp/v2/media', method: 'POST', body: formData };
		};

		let createWarningNotice;

		beforeEach( () => {
			createWarningNotice = vi.fn();
			dispatch.mockReturnValue( {
				createWarningNotice,
				createInfoNotice: vi.fn(),
			} );
			next.mockResolvedValue( { id: 456 } );
		} );

		it.each( [
			[ 'a network error', null ],
			[ 'a 404', 404 ],
			[ 'a 405', 405 ],
			[ 'a 501', 501 ],
		] )(
			'falls back to standard upload on %s when creating the upload',
			async ( label, status ) => {
				upload.mockRejectedValue(
					tusError( 'tus: failed to create upload', 'POST', status )
				);
				const options = uploadRequest();

				const result = await tusMiddleware( options, next );

				expect( next ).toHaveBeenCalledWith( options );
				expect( result ).toEqual( { id: 456 } );
				expect( consoleWarn ).toHaveBeenCalled();
			}
		);

		it( 'dispatches warning notice before fallback', async () => {
			upload.mockRejectedValue(
				tusError( 'tus: failed to create upload', 'POST', null )
			);

			await tusMiddleware( uploadRequest(), next );

			expect( createWarningNotice ).toHaveBeenCalledWith(
				'Resumable upload unavailable for this file. Using standard upload.',
				expect.objectContaining( {
					id: 'uploads-unleashed-fallback-test.txt',
					isDismissible: true,
					type: 'snackbar',
				} )
			);
		} );

		it.each( [
			[ 'an invalid file type', 400 ],
			[ 'a missing permission', 403 ],
			[ 'a file that is too large', 413 ],
			[ 'a server error', 500 ],
			[ 'a full disk', 507 ],
		] )(
			'rethrows the server message on %s when creating the upload',
			async ( label, status ) => {
				const error = tusError( 'Server says no.', 'POST', status );
				upload.mockRejectedValue( error );

				await expect(
					tusMiddleware( uploadRequest(), next )
				).rejects.toBe( error );

				expect( next ).not.toHaveBeenCalled();
				expect( createWarningNotice ).not.toHaveBeenCalled();
			}
		);

		it.each( [
			[ 'rejects a chunk', 'PATCH', 400, {} ],
			[ 'fails mid-upload', 'PATCH', null, {} ],
			[
				'rejects an overridden chunk',
				'POST',
				404,
				{ 'X-HTTP-Method-Override': 'PATCH' },
			],
			[ 'fails a resume check', 'HEAD', null, {} ],
		] )(
			'rethrows when the server %s',
			async ( label, method, status, headers ) => {
				const error = tusError(
					'Not enough space.',
					method,
					status,
					headers
				);
				upload.mockRejectedValue( error );

				await expect(
					tusMiddleware( uploadRequest(), next )
				).rejects.toBe( error );

				expect( next ).not.toHaveBeenCalled();
				expect( createWarningNotice ).not.toHaveBeenCalled();
			}
		);

		it( 'rethrows without fallback when the upload was cancelled', async () => {
			const controller = new AbortController();
			const error = tusError(
				'tus: failed to create upload',
				'POST',
				null
			);
			upload.mockImplementation( () => {
				controller.abort();
				return Promise.reject( error );
			} );
			const options = {
				...uploadRequest(),
				signal: controller.signal,
			};

			await expect( tusMiddleware( options, next ) ).rejects.toBe(
				error
			);

			expect( next ).not.toHaveBeenCalled();
			expect( createWarningNotice ).not.toHaveBeenCalled();
			expect( consoleWarn ).not.toHaveBeenCalled();
			expect( applyFilters ).not.toHaveBeenCalledWith(
				'uploadsUnleashed.allowFallback',
				expect.anything(),
				expect.anything(),
				expect.anything()
			);
		} );

		it( 'rethrows an AbortError without fallback', async () => {
			const error = tusError(
				'The user aborted a request.',
				'POST',
				null
			);
			error.name = 'AbortError';
			upload.mockRejectedValue( error );

			await expect( tusMiddleware( uploadRequest(), next ) ).rejects.toBe(
				error
			);

			expect( next ).not.toHaveBeenCalled();
			expect( createWarningNotice ).not.toHaveBeenCalled();
		} );

		it( 'rethrows errors without a TUS request', async () => {
			const error = new Error(
				'Upload completed but no attachment data received'
			);
			upload.mockRejectedValue( error );

			await expect( tusMiddleware( uploadRequest(), next ) ).rejects.toBe(
				error
			);

			expect( next ).not.toHaveBeenCalled();
			expect( createWarningNotice ).not.toHaveBeenCalled();
		} );

		it( 'respects allowFallback filter returning false', async () => {
			const error = tusError( 'TUS failed', 'POST', null );
			upload.mockRejectedValue( error );
			applyFilters.mockImplementation( ( hookName, defaultValue ) => {
				if ( hookName === 'uploadsUnleashed.allowFallback' ) {
					return false;
				}
				return defaultValue;
			} );
			const options = uploadRequest();

			await expect( tusMiddleware( options, next ) ).rejects.toThrow(
				'TUS failed'
			);

			expect( applyFilters ).toHaveBeenCalledWith(
				'uploadsUnleashed.allowFallback',
				true,
				error,
				options.body.get( 'file' )
			);
			expect( next ).not.toHaveBeenCalled();
			expect( createWarningNotice ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'shouldUseTus filter', () => {
		it( 'skips TUS when filter returns false', async () => {
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
	it( 'dispatches info notice when pending uploads exist', async () => {
		vi.resetModules();
		const data = await import( '@wordpress/data' );
		const tusClient = await import( '../../src/tus-client' );
		const { default: freshApiFetch } =
			await import( '@wordpress/api-fetch' );
		const mockCreateInfoNotice = vi.fn();
		data.dispatch.mockReturnValue( {
			createWarningNotice: vi.fn(),
			createInfoNotice: mockCreateInfoNotice,
		} );

		tusClient.getPendingUploads.mockReturnValue( [
			{ key: 'k1', filename: 'test.txt', size: 1024 },
		] );

		freshApiFetch.use = vi.fn();
		await import( '../../src/block-editor' );

		expect( mockCreateInfoNotice ).toHaveBeenCalledWith(
			expect.stringContaining( '1' ),
			expect.objectContaining( {
				id: 'uploads-unleashed-pending',
				isDismissible: true,
				type: 'snackbar',
			} )
		);
	} );

	it( 'does not dispatch notice when no pending uploads', async () => {
		vi.resetModules();
		const data = await import( '@wordpress/data' );
		const tusClient = await import( '../../src/tus-client' );
		const { default: freshApiFetch } =
			await import( '@wordpress/api-fetch' );
		const mockCreateInfoNotice = vi.fn();
		data.dispatch.mockReturnValue( {
			createWarningNotice: vi.fn(),
			createInfoNotice: mockCreateInfoNotice,
		} );

		tusClient.getPendingUploads.mockReturnValue( [] );

		freshApiFetch.use = vi.fn();
		await import( '../../src/block-editor' );

		expect( mockCreateInfoNotice ).not.toHaveBeenCalled();
	} );
} );

describe( 'resuming in the editor', () => {
	const pending = {
		key: 'k1',
		uploadUrl: '/wp-json/wp/v2/media/abc',
		filename: 'video.mp4',
		size: 4,
		lastModified: 1234567890,
	};
	const original = () =>
		new File( [ 'data' ], 'video.mp4', { lastModified: 1234567890 } );
	const flush = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	let notices;
	let tusClient;
	let input;

	/**
	 * Loads the module with one pending upload, then clicks the notice action and picks a file.
	 *
	 * @param {File|null}                    file         The file the user picks.
	 * @param {(uploadMock: Object) => void} [mockUpload] Sets up the upload mock.
	 */
	async function resumeWith( file, mockUpload = () => {} ) {
		vi.resetModules();
		const data = await import( '@wordpress/data' );
		tusClient = await import( '../../src/tus-client' );
		const { default: freshApiFetch } =
			await import( '@wordpress/api-fetch' );
		notices = {
			createInfoNotice: vi.fn(),
			createSuccessNotice: vi.fn(),
			createWarningNotice: vi.fn(),
			createErrorNotice: vi.fn(),
		};
		data.dispatch.mockReturnValue( notices );
		tusClient.getPendingUploads.mockReturnValue( [ pending ] );
		tusClient.upload.mockReset();
		mockUpload( tusClient.upload );
		freshApiFetch.use = vi.fn();

		const createElement = document.createElement.bind( document );
		vi.spyOn( document, 'createElement' ).mockImplementation( ( tag ) => {
			const element = createElement( tag );
			if ( 'input' === tag ) {
				input = element;
				element.click = () => {
					Object.defineProperty( element, 'files', {
						value: file ? [ file ] : [],
					} );
					element.dispatchEvent( new Event( 'change' ) );
				};
			}
			return element;
		} );

		await import( '../../src/block-editor' );

		const [ , options ] = notices.createInfoNotice.mock.calls[ 0 ];
		options.actions[ 0 ].onClick();
		await flush();
	}

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'offers to resume without leaving the editor', async () => {
		await resumeWith( null );

		const [ , options ] = notices.createInfoNotice.mock.calls[ 0 ];
		expect( options.actions[ 0 ].url ).toBeUndefined();
		expect( input.type ).toBe( 'file' );
		expect( tusClient.upload ).not.toHaveBeenCalled();
	} );

	it( 'resumes the upload of the original file and confirms it', async () => {
		const file = original();

		await resumeWith( file, ( uploadMock ) =>
			uploadMock.mockResolvedValue( { id: 1 } )
		);
		await flush();

		expect( tusClient.upload ).toHaveBeenCalledWith( file );
		expect( notices.createSuccessNotice ).toHaveBeenCalledWith(
			expect.stringContaining( 'video.mp4' ),
			expect.objectContaining( { type: 'snackbar' } )
		);
	} );

	it( 'shows the error when the resumed upload fails', async () => {
		await resumeWith( original(), ( uploadMock ) =>
			uploadMock.mockRejectedValue( new Error( 'Rejected' ) )
		);
		await flush();

		expect( notices.createErrorNotice ).toHaveBeenCalledWith(
			expect.stringContaining( 'Rejected' ),
			expect.objectContaining( { type: 'snackbar' } )
		);
	} );

	it.each( [
		[ 'another file', () => new File( [ 'data' ], 'other.mp4' ) ],
		[
			'a modified file',
			() => new File( [ 'data' ], 'video.mp4', { lastModified: 1 } ),
		],
	] )( 'does not upload %s', async ( label, makeFile ) => {
		await resumeWith( makeFile() );

		expect( tusClient.upload ).not.toHaveBeenCalled();
		expect( notices.createWarningNotice ).toHaveBeenCalledWith(
			expect.stringContaining( 'video.mp4' ),
			expect.objectContaining( { type: 'snackbar' } )
		);
	} );
} );

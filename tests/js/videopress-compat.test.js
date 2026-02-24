/**
 * Tests for the VideoPress compatibility filter.
 *
 * The filter is registered at module scope in tus-client.js via addFilter.
 * It skips TUS for video/* files when VideoPress is detected via three paths:
 * - wp.VideoPress (legacy Jetpack plupload path)
 * - videoPressEditorState.isVideoPressModuleActive (VideoPress package)
 * - videoPressEditorState.isStandaloneActive (standalone VideoPress plugin)
 * - Script tag for legacy Jetpack block editor middleware
 */

let videoPressFilter;

jest.mock( '@wordpress/hooks', () => ( {
	addFilter: jest.fn( ( hookName, namespace, callback ) => {
		if (
			hookName === 'uploadsUnleashed.shouldUseTus' &&
			namespace === 'uploads-unleashed/videopress-compat'
		) {
			videoPressFilter = callback;
		}
	} ),
} ) );

beforeAll( () => {
	// Import tus-client to trigger the addFilter side effect.
	// We need isolateModules so the module re-executes.
	jest.isolateModules( () => {
		require( '../../src/tus-client' );
	} );
} );

beforeEach( () => {
	// Clean up all VideoPress signals between tests
	if ( window.wp ) {
		delete window.wp.VideoPress;
	}
	delete window.videoPressEditorState;

	const scriptEl = document.getElementById(
		'jetpack-videopress-gutenberg-override-video-upload-js'
	);
	if ( scriptEl ) {
		scriptEl.remove();
	}
} );

describe( 'VideoPress compatibility filter', () => {
	it( 'is registered via addFilter', () => {
		expect( videoPressFilter ).toBeDefined();
		expect( typeof videoPressFilter ).toBe( 'function' );
	} );

	describe( 'legacy Jetpack module — plupload path', () => {
		it( 'returns false for video files when wp.VideoPress is present', () => {
			window.wp = window.wp || {};
			window.wp.VideoPress = {};

			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );

			expect( videoPressFilter( true, file ) ).toBe( false );
		} );
	} );

	describe( 'VideoPress package — block editor path', () => {
		it( 'returns false for video files when isVideoPressModuleActive is set', () => {
			window.videoPressEditorState = {
				isVideoPressModuleActive: '1',
			};

			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );

			expect( videoPressFilter( true, file ) ).toBe( false );
		} );

		it( 'returns false for video files when isStandaloneActive is set', () => {
			window.videoPressEditorState = {
				isStandaloneActive: '1',
			};

			const file = new File( [ 'video' ], 'movie.webm', {
				type: 'video/webm',
			} );

			expect( videoPressFilter( true, file ) ).toBe( false );
		} );

		it( 'does not trigger when isVideoPressModuleActive is empty string', () => {
			window.videoPressEditorState = {
				isVideoPressModuleActive: '',
				isStandaloneActive: '',
			};

			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );

			expect( videoPressFilter( true, file ) ).toBe( true );
		} );
	} );

	describe( 'legacy Jetpack module — block editor middleware', () => {
		it( 'returns false for video files when the middleware script tag exists', () => {
			const script = document.createElement( 'script' );
			script.id = 'jetpack-videopress-gutenberg-override-video-upload-js';
			document.head.appendChild( script );

			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );

			expect( videoPressFilter( true, file ) ).toBe( false );
		} );
	} );

	describe( 'passthrough behavior', () => {
		it( 'passes through for non-video files even with VideoPress active', () => {
			window.wp = window.wp || {};
			window.wp.VideoPress = {};

			const imageFile = new File( [ 'img' ], 'photo.jpg', {
				type: 'image/jpeg',
			} );

			expect( videoPressFilter( true, imageFile ) ).toBe( true );
		} );

		it( 'passes through for video files without VideoPress', () => {
			const file = new File( [ 'video' ], 'movie.mp4', {
				type: 'video/mp4',
			} );

			expect( videoPressFilter( true, file ) ).toBe( true );
		} );

		it( 'respects an already-false shouldUseTus value', () => {
			const file = new File( [ 'test' ], 'test.txt', {
				type: 'text/plain',
			} );

			expect( videoPressFilter( false, file ) ).toBe( false );
		} );
	} );

	describe( 'edge cases', () => {
		it( 'handles null file gracefully', () => {
			window.wp = window.wp || {};
			window.wp.VideoPress = {};

			expect( videoPressFilter( true, null ) ).toBe( true );
		} );

		it( 'handles file without type gracefully', () => {
			window.wp = window.wp || {};
			window.wp.VideoPress = {};

			const file = new File( [ 'data' ], 'noext' );
			Object.defineProperty( file, 'type', { value: '' } );

			expect( videoPressFilter( true, file ) ).toBe( true );
		} );
	} );
} );

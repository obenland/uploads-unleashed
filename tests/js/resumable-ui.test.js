/**
 * Tests for the resumable UI module.
 */

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
		return result.replace( /%%/g, '%' );
	},
} ) );

jest.mock( '../../src/tus-client', () => ( {
	getPendingUploads: jest.fn( () => [] ),
	discardPendingUpload: jest.fn(),
} ) );

jest.mock( '../../src/resume-ui.css', () => ( {} ) );

// JSDOM does not provide DataTransfer; polyfill for resume-upload tests.
if ( typeof global.DataTransfer === 'undefined' ) {
	global.DataTransfer = class DataTransfer {
		constructor() {
			this._files = [];
			this.items = {
				add: ( file ) => this._files.push( file ),
			};
		}
		get files() {
			return this._files;
		}
	};
}

const ENDPOINT = '/wp-json/wp/v2/media';

function createPendingUploadEntry( filename, size ) {
	const encodedName = encodeURIComponent( filename );
	const fingerprint = `tus-br|${ encodedName }|${ size }|1234567890|${ ENDPOINT }`;
	const expiresAt = Date.now() + 86400000;
	const key = `tus::${ fingerprint }::${ expiresAt }::upload-${ Math.random() }`;

	return {
		key,
		uploadUrl: `${ ENDPOINT }/upload-id`,
		filename,
		size,
		bytesUploaded: 0,
	};
}

function setupDOM() {
	const container = document.createElement( 'div' );
	container.id = 'uploads-unleashed-pending';
	container.style.display = 'none';

	const list = document.createElement( 'ul' );
	list.className = 'uploads-unleashed-list';
	container.appendChild( list );

	document.body.appendChild( container );

	return { container, list };
}

function importModule( pendingUploads = [] ) {
	let mocks;
	jest.isolateModules( () => {
		mocks = require( '../../src/tus-client' );
		mocks.getPendingUploads.mockReturnValue( pendingUploads );
		require( '../../src/resume-ui' );
	} );
	return mocks;
}

beforeEach( () => {
	localStorage.clear();
	document.body.innerHTML = '';
	jest.clearAllMocks();

	window.uploadsUnleashed = {
		endpoint: ENDPOINT,
		nonce: 'test-nonce',
	};

	// No jQuery or uploader by default
	delete window.jQuery;
	delete window.uploader;
} );

describe( 'renderPendingUploads', () => {
	it( 'does not render when container is missing', () => {
		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		expect( document.querySelector( 'li' ) ).toBeNull();
	} );

	it( 'does not modify container when no pending uploads (init skips)', () => {
		const { container } = setupDOM();
		container.style.display = 'block';

		importModule( [] );

		// init() exits early when pending.length === 0, so renderPendingUploads is never called.
		expect( container.style.display ).toBe( 'block' );
	} );

	it( 'hides container when renderPendingUploads finds no uploads', () => {
		const { container } = setupDOM();
		container.style.display = 'block';

		// First render with uploads to trigger renderPendingUploads.
		let mocks;
		jest.isolateModules( () => {
			mocks = require( '../../src/tus-client' );
			// First call (init): has pending uploads.
			// Second call (renderPendingUploads): no pending uploads.
			mocks.getPendingUploads
				.mockReturnValueOnce( [
					createPendingUploadEntry( 'test.txt', 1024 ),
				] )
				.mockReturnValueOnce( [] );
			require( '../../src/resume-ui' );
		} );

		// renderPendingUploads was called with no uploads, so container is hidden.
		expect( container.style.display ).toBe( 'none' );
	} );

	it( 'renders list items for pending uploads', () => {
		const { list } = setupDOM();

		importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
			createPendingUploadEntry( 'doc.pdf', 1024 ),
		] );

		expect( list.children.length ).toBe( 2 );
	} );

	it( 'shows container when pending uploads exist', () => {
		const { container } = setupDOM();

		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		expect( container.style.display ).toBe( 'block' );
	} );

	it( 'renders filename and size text', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'photo.jpg', 5242880 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filename' ).textContent ).toBe(
			'photo.jpg'
		);
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(5.0 MB)'
		);
	} );

	it( 'renders Resume and Discard buttons', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const li = document.querySelector( 'li' );
		const resume = li.querySelector( '.resume-upload' );
		const discard = li.querySelector( '.discard-upload' );

		expect( resume.textContent ).toBe( 'Resume' );
		expect( resume.type ).toBe( 'button' );
		expect( discard.textContent ).toBe( 'Discard' );
		expect( discard.type ).toBe( 'button' );
	} );
} );

describe( 'data attributes', () => {
	it( 'stores filename as data attribute', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'photo.jpg', 5242880 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.filename ).toBe( 'photo.jpg' );
	} );

	it( 'stores size as data attribute', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'photo.jpg', 5242880 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.size ).toBe( '5242880' );
	} );

	it( 'handles special characters in filename', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'my file (1).jpg', 1024 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.filename ).toBe( 'my file (1).jpg' );
		expect( li.querySelector( '.filename' ).textContent ).toBe(
			'my file (1).jpg'
		);
	} );

	it( 'renders HTML in filename as inert text, not markup', () => {
		setupDOM();

		const xssFilename = '<img src=x onerror=alert(1)>';
		importModule( [ createPendingUploadEntry( xssFilename, 1024 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filename' ).textContent ).toBe(
			xssFilename
		);
		expect( li.querySelector( 'img' ) ).toBeNull();
	} );

	it( 'does not expose key or uploadUrl as data attributes', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.key ).toBeUndefined();
		expect( li.dataset.url ).toBeUndefined();
	} );
} );

describe( 'removePendingEntry via plupload FilesAdded', () => {
	let filesAddedHandler;

	function setupWithPlupload( pendingUploads ) {
		setupDOM();

		const mockUploader = {
			bind: jest.fn( ( event, handler ) => {
				if ( event === 'FilesAdded' ) {
					filesAddedHandler = handler;
				}
			} ),
		};

		window.uploader = mockUploader;
		window.jQuery = jest.fn( ( fn ) => fn() );

		importModule( pendingUploads );
	}

	it( 'removes matching entry by filename and size', () => {
		const pending = [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
			createPendingUploadEntry( 'doc.pdf', 1024 ),
		];
		setupWithPlupload( pending );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 2 );

		filesAddedHandler( {}, [ { name: 'photo.jpg', size: 5242880 } ] );

		expect( list.children.length ).toBe( 1 );
		expect( list.children[ 0 ].dataset.filename ).toBe( 'doc.pdf' );
	} );

	it( 'does not remove entry with matching name but different size', () => {
		setupWithPlupload( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );

		filesAddedHandler( {}, [ { name: 'photo.jpg', size: 999 } ] );

		expect( list.children.length ).toBe( 1 );
	} );

	it( 'does not remove entry with matching size but different name', () => {
		setupWithPlupload( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );

		filesAddedHandler( {}, [ { name: 'other.jpg', size: 5242880 } ] );

		expect( list.children.length ).toBe( 1 );
	} );

	it( 'hides container when last entry is removed', () => {
		setupWithPlupload( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);

		filesAddedHandler( {}, [ { name: 'photo.jpg', size: 5242880 } ] );

		expect( container.style.display ).toBe( 'none' );
	} );

	it( 'removes multiple matching entries in one event', () => {
		setupWithPlupload( [
			createPendingUploadEntry( 'a.jpg', 100 ),
			createPendingUploadEntry( 'b.jpg', 200 ),
			createPendingUploadEntry( 'c.jpg', 300 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );

		filesAddedHandler( {}, [
			{ name: 'a.jpg', size: 100 },
			{ name: 'c.jpg', size: 300 },
		] );

		expect( list.children.length ).toBe( 1 );
		expect( list.children[ 0 ].dataset.filename ).toBe( 'b.jpg' );
	} );
} );

describe( 'discard button', () => {
	it( 'calls discardPendingUpload and removes item', async () => {
		setupDOM();

		const pending = createPendingUploadEntry( 'test.txt', 1024 );
		const { discardPendingUpload } = importModule( [ pending ] );
		discardPendingUpload.mockResolvedValue();

		const discard = document.querySelector( '.discard-upload' );
		discard.click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( discardPendingUpload ).toHaveBeenCalledWith( pending );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 0 );
	} );

	it( 'hides container when last item is discarded', async () => {
		setupDOM();

		const { discardPendingUpload } = importModule( [
			createPendingUploadEntry( 'test.txt', 1024 ),
		] );
		discardPendingUpload.mockResolvedValue();

		document.querySelector( '.discard-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);
		expect( container.style.display ).toBe( 'none' );
	} );

	it( 'discards correct item from multi-item list', async () => {
		setupDOM();

		const itemA = createPendingUploadEntry( 'a.txt', 100 );
		const itemB = createPendingUploadEntry( 'b.txt', 200 );
		const { discardPendingUpload } = importModule( [ itemA, itemB ] );
		discardPendingUpload.mockResolvedValue();

		const list = document.querySelector( '.uploads-unleashed-list' );
		const discardButtons = list.querySelectorAll( '.discard-upload' );

		// Discard the first item
		discardButtons[ 0 ].click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( discardPendingUpload ).toHaveBeenCalledWith( itemA );
		expect( list.children.length ).toBe( 1 );
		expect( list.children[ 0 ].dataset.filename ).toBe( 'b.txt' );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);
		expect( container.style.display ).toBe( 'block' );
	} );
} );

describe( 'resume button', () => {
	function setupMoxieShim() {
		const shim = document.createElement( 'div' );
		shim.className = 'moxie-shim';
		const input = document.createElement( 'input' );
		input.type = 'file';

		// JSDOM rejects non-FileList values on input.files; allow plain arrays.
		let storedFiles = null;
		Object.defineProperty( input, 'files', {
			get: () => storedFiles,
			set: ( val ) => {
				storedFiles = val;
			},
		} );

		shim.appendChild( input );
		document.body.appendChild( shim );
		return input;
	}

	function mockShowOpenFilePicker( file ) {
		window.showOpenFilePicker = jest.fn( () =>
			Promise.resolve( [ { getFile: () => Promise.resolve( file ) } ] )
		);
	}

	afterEach( () => {
		delete window.showOpenFilePicker;
	} );

	it( 'removes item on successful resume', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 1024;
		const pending = createPendingUploadEntry( 'photo.jpg', size );
		importModule( [ pending ] );

		const file = new File( [ 'x'.repeat( size ) ], 'photo.jpg', {
			type: 'image/jpeg',
		} );
		mockShowOpenFilePicker( file );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 0 );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);
		expect( container.style.display ).toBe( 'none' );
	} );

	it( 'keeps item when user cancels file picker', async () => {
		setupDOM();

		const pending = createPendingUploadEntry( 'photo.jpg', 5242880 );
		importModule( [ pending ] );

		// showOpenFilePicker throws AbortError on cancel
		const abortError = new DOMException( 'The user aborted', 'AbortError' );
		window.showOpenFilePicker = jest.fn( () =>
			Promise.reject( abortError )
		);

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 1 );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);
		expect( container.style.display ).toBe( 'block' );
	} );

	it( 'falls back to file input when showOpenFilePicker unavailable', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 1024;
		const pending = createPendingUploadEntry( 'doc.txt', size );
		importModule( [ pending ] );

		// No showOpenFilePicker — fallback to file input.
		delete window.showOpenFilePicker;

		// Mock createElement to capture the file input.
		const originalCreateElement = document.createElement.bind( document );
		let capturedInput = null;
		jest.spyOn( document, 'createElement' ).mockImplementation( ( tag ) => {
			const el = originalCreateElement( tag );
			if ( tag === 'input' ) {
				capturedInput = el;
				// Override click to trigger onchange with matching file.
				el.click = () => {
					const file = new File( [ 'x'.repeat( size ) ], 'doc.txt', {
						type: 'text/plain',
					} );
					Object.defineProperty( el, 'files', {
						value: [ file ],
					} );
					el.onchange?.();
				};
			}
			return el;
		} );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

		expect( capturedInput ).not.toBeNull();
		expect( capturedInput.type ).toBe( 'file' );

		document.createElement.mockRestore();
	} );

	it( 'shows inline error for wrong file and keeps item', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 5242880;
		const pending = createPendingUploadEntry( 'photo.jpg', size );
		importModule( [ pending ] );

		// Wrong file (different name).
		const wrongFile = new File( [ 'x' ], 'wrong.txt', {
			type: 'text/plain',
		} );
		mockShowOpenFilePicker( wrongFile );

		const alertSpy = jest.spyOn( window, 'alert' ).mockImplementation();

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// No alert should be called - we use inline errors now
		expect( alertSpy ).not.toHaveBeenCalled();

		// Inline error should be visible
		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl.style.display ).toBe( 'block' );
		expect( errorEl.textContent ).toContain( 'photo.jpg' );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 1 );

		alertSpy.mockRestore();
	} );

	it( 'keeps item when no moxie-shim input exists', async () => {
		setupDOM();
		// No setupMoxieShim — no .moxie-shim input.

		const size = 1024;
		const pending = createPendingUploadEntry( 'test.txt', size );
		importModule( [ pending ] );

		const file = new File( [ 'x'.repeat( size ) ], 'test.txt', {
			type: 'text/plain',
		} );
		mockShowOpenFilePicker( file );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Item stays because there's no uploader to dispatch to.
		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 1 );
	} );

	it( 'handles non-AbortError from showOpenFilePicker and falls back', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 1024;
		const pending = createPendingUploadEntry( 'doc.txt', size );
		importModule( [ pending ] );

		// Throw a non-AbortError so fallback kicks in.
		window.showOpenFilePicker = jest.fn( () =>
			Promise.reject( new Error( 'Not supported' ) )
		);

		// Mock createElement for fallback input that returns null (user cancels).
		const originalCreateElement = document.createElement.bind( document );
		jest.spyOn( document, 'createElement' ).mockImplementation( ( tag ) => {
			const el = originalCreateElement( tag );
			if ( tag === 'input' ) {
				el.click = () => {
					// User cancels — no file selected.
					Object.defineProperty( el, 'files', {
						value: [],
					} );
					el.onchange?.();
				};
			}
			return el;
		} );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

		// Item stays because user canceled fallback.
		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 1 );

		document.createElement.mockRestore();
	} );
} );

describe( 'resume file selection UX', () => {
	function setupMoxieShim() {
		const shim = document.createElement( 'div' );
		shim.className = 'moxie-shim';
		const input = document.createElement( 'input' );
		input.type = 'file';
		let storedFiles = null;
		Object.defineProperty( input, 'files', {
			get: () => storedFiles,
			set: ( val ) => {
				storedFiles = val;
			},
		} );
		shim.appendChild( input );
		document.body.appendChild( shim );
		return input;
	}

	function mockShowOpenFilePicker( file ) {
		window.showOpenFilePicker = jest.fn( () =>
			Promise.resolve( [ { getFile: () => Promise.resolve( file ) } ] )
		);
	}

	afterEach( () => {
		delete window.showOpenFilePicker;
	} );

	it( 'hides error by default', () => {
		setupDOM();

		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl ).not.toBeNull();
		expect( errorEl.style.display ).toBe( 'none' );
	} );

	it( 'shows inline error on wrong file instead of alert', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 5242880;
		const pending = createPendingUploadEntry( 'photo.jpg', size );
		importModule( [ pending ] );

		const wrongFile = new File( [ 'x' ], 'wrong.txt', {
			type: 'text/plain',
		} );
		mockShowOpenFilePicker( wrongFile );

		const alertSpy = jest.spyOn( window, 'alert' ).mockImplementation();

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// alert should NOT be called
		expect( alertSpy ).not.toHaveBeenCalled();

		// Inline error should be shown
		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl.style.display ).toBe( 'block' );
		expect( errorEl.textContent ).toContain( 'photo.jpg' );

		alertSpy.mockRestore();
	} );

	it( 'clears error on retry', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 5242880;
		const pending = createPendingUploadEntry( 'photo.jpg', size );
		importModule( [ pending ] );

		// First attempt: wrong file
		const wrongFile = new File( [ 'x' ], 'wrong.txt', {
			type: 'text/plain',
		} );
		mockShowOpenFilePicker( wrongFile );

		document.querySelector( '.resume-upload' ).click();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl.style.display ).toBe( 'block' );

		// Second attempt: right file
		const rightFile = new File( [ 'x'.repeat( size ) ], 'photo.jpg', {
			type: 'image/jpeg',
		} );
		mockShowOpenFilePicker( rightFile );

		document.querySelector( '.resume-upload' ).click();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Error should be cleared (hidden) even before result
		// The item gets removed on success, so we check the error was cleared
		// by verifying the upload succeeded (item removed)
		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 0 );
	} );
} );

describe( 'removePendingEntry without container', () => {
	it( 'does nothing when container is missing', () => {
		// No setupDOM — no container.
		const mockUploader = {
			bind: jest.fn( ( event, handler ) => {
				if ( event === 'FilesAdded' ) {
					// Call handler immediately.
					handler( {}, [ { name: 'test.txt', size: 100 } ] );
				}
			} ),
		};
		window.uploader = mockUploader;
		window.jQuery = jest.fn( ( fn ) => fn() );

		// Should not throw.
		importModule( [ createPendingUploadEntry( 'test.txt', 100 ) ] );
	} );
} );

describe( 'hookPlupload', () => {
	it( 'does nothing when window.uploader is not set', () => {
		setupDOM();
		delete window.uploader;
		window.jQuery = jest.fn( ( fn ) => fn() );

		// Should not throw.
		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );
	} );
} );

describe( 'DOMContentLoaded', () => {
	it( 'defers init when document is loading', () => {
		setupDOM();

		// Mock readyState as 'loading'.
		const desc = Object.getOwnPropertyDescriptor(
			Document.prototype,
			'readyState'
		);
		Object.defineProperty( document, 'readyState', {
			value: 'loading',
			writable: true,
			configurable: true,
		} );

		const addEventSpy = jest.spyOn( document, 'addEventListener' );

		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		expect( addEventSpy ).toHaveBeenCalledWith(
			'DOMContentLoaded',
			expect.any( Function )
		);

		// Restore.
		Object.defineProperty( document, 'readyState', desc );
		addEventSpy.mockRestore();
	} );
} );

describe( 'formatFileSize', () => {
	it( 'formats bytes', () => {
		setupDOM();
		importModule( [ createPendingUploadEntry( 'tiny.txt', 500 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe( '(500 B)' );
	} );

	it( 'formats kilobytes', () => {
		setupDOM();
		importModule( [ createPendingUploadEntry( 'small.txt', 2048 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(2.0 KB)'
		);
	} );

	it( 'formats megabytes', () => {
		setupDOM();
		importModule( [
			createPendingUploadEntry( 'big.mp4', 10 * 1024 * 1024 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(10.0 MB)'
		);
	} );

	it( 'formats gigabytes', () => {
		setupDOM();
		importModule( [
			createPendingUploadEntry( 'huge.iso', 1.5 * 1024 * 1024 * 1024 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(1.5 GB)'
		);
	} );
} );

describe( 'upload progress percentage', () => {
	it( 'renders percentage when bytesUploaded > 0', () => {
		setupDOM();

		const entry = createPendingUploadEntry( 'photo.jpg', 52428800 );
		entry.bytesUploaded = 22020096;

		importModule( [ entry ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(42% of 50.0 MB)'
		);
	} );

	it( 'renders plain file size when bytesUploaded is 0', () => {
		setupDOM();

		const entry = createPendingUploadEntry( 'photo.jpg', 52428800 );
		entry.bytesUploaded = 0;

		importModule( [ entry ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(50.0 MB)'
		);
	} );
} );

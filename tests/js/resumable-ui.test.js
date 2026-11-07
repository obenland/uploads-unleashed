/**
 * Tests for the resumable UI module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock( '@wordpress/i18n', () => ( {
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

vi.mock( '@wordpress/a11y', () => ( {
	speak: vi.fn(),
} ) );

vi.mock( '../../src/tus-client', () => ( {
	getPendingUploads: vi.fn( () => [] ),
	discardPendingUpload: vi.fn(),
} ) );

vi.mock( '../../src/resume-ui.css', () => ( {} ) );

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
const LAST_MODIFIED = 1234567890;

function createPendingUploadEntry( filename, size ) {
	const encodedName = encodeURIComponent( filename );
	const fingerprint = `tus-br|${ encodedName }|${ size }|${ LAST_MODIFIED }|${ ENDPOINT }|1|1`;
	const expiresAt = Date.now() + 86400000;
	const key = `tus::${ fingerprint }::${ expiresAt }::upload-${ Math.random() }`;

	return {
		key,
		uploadUrl: `${ ENDPOINT }/upload-id`,
		filename,
		size,
		lastModified: LAST_MODIFIED,
		bytesUploaded: 0,
	};
}

function setupDOM() {
	const container = document.createElement( 'div' );
	container.id = 'uploads-unleashed-pending';
	container.style.display = 'none';

	const notice = document.createElement( 'p' );
	notice.className = 'uploads-unleashed-notice';
	container.appendChild( notice );

	const list = document.createElement( 'ul' );
	list.className = 'uploads-unleashed-list';
	container.appendChild( list );

	document.body.appendChild( container );

	return { container, list, notice };
}

/**
 * Discards a pending upload through the inline confirmation.
 *
 * @param {HTMLLIElement} li The pending upload list item.
 */
function discardItem( li ) {
	li.querySelector( '.discard-upload' ).click();
	li.querySelector( '.confirm-discard' ).click();
}

async function importModule( pendingUploads = [] ) {
	vi.resetModules();
	const mocks = await import( '../../src/tus-client' );
	mocks.getPendingUploads.mockReturnValue( pendingUploads );
	await import( '../../src/resume-ui' );
	return mocks;
}

beforeEach( () => {
	localStorage.clear();
	document.body.innerHTML = '';
	vi.clearAllMocks();

	window.uploadsUnleashed = {
		endpoint: ENDPOINT,
		nonce: 'test-nonce',
	};

	// No jQuery or uploader by default
	delete window.jQuery;
	delete window.uploader;
} );

describe( 'renderPendingUploads', () => {
	it( 'does not render when container is missing', async () => {
		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		expect( document.querySelector( 'li' ) ).toBeNull();
	} );

	it( 'does not modify container when no pending uploads (init skips)', async () => {
		const { container } = setupDOM();
		container.style.display = 'block';

		await importModule( [] );

		// init() exits early when pending.length === 0, so renderPendingUploads is never called.
		expect( container.style.display ).toBe( 'block' );
	} );

	it( 'hides container when renderPendingUploads finds no uploads', async () => {
		const { container } = setupDOM();
		container.style.display = 'block';

		// First render with uploads to trigger renderPendingUploads.
		vi.resetModules();
		const mocks = await import( '../../src/tus-client' );
		/*
		 * First call (init): has pending uploads.
		 * Second call (renderPendingUploads): no pending uploads.
		 */
		mocks.getPendingUploads
			.mockReturnValueOnce( [
				createPendingUploadEntry( 'test.txt', 1024 ),
			] )
			.mockReturnValueOnce( [] );
		await import( '../../src/resume-ui' );

		// renderPendingUploads was called with no uploads, so container is hidden.
		expect( container.style.display ).toBe( 'none' );
	} );

	it( 'renders list items for pending uploads', async () => {
		const { list } = setupDOM();

		await importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
			createPendingUploadEntry( 'doc.pdf', 1024 ),
		] );

		expect( list.children.length ).toBe( 2 );
	} );

	it( 'shows container when pending uploads exist', async () => {
		const { container } = setupDOM();

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		expect( container.style.display ).toBe( 'block' );
	} );

	it( 'renders filename and size text', async () => {
		setupDOM();

		await importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filename' ).textContent ).toBe(
			'photo.jpg'
		);
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(5.0 MB)'
		);
	} );

	it( 'renders Resume and Discard buttons', async () => {
		setupDOM();

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

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
	it( 'stores filename as data attribute', async () => {
		setupDOM();

		await importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.filename ).toBe( 'photo.jpg' );
	} );

	it( 'stores size as data attribute', async () => {
		setupDOM();

		await importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.size ).toBe( '5242880' );
	} );

	it( 'handles special characters in filename', async () => {
		setupDOM();

		await importModule( [
			createPendingUploadEntry( 'my file (1).jpg', 1024 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.filename ).toBe( 'my file (1).jpg' );
		expect( li.querySelector( '.filename' ).textContent ).toBe(
			'my file (1).jpg'
		);
	} );

	it( 'renders HTML in filename as inert text, not markup', async () => {
		setupDOM();

		const xssFilename = '<img src=x onerror=alert(1)>';
		await importModule( [ createPendingUploadEntry( xssFilename, 1024 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filename' ).textContent ).toBe(
			xssFilename
		);
		expect( li.querySelector( 'img' ) ).toBeNull();
	} );

	it( 'does not expose key or uploadUrl as data attributes', async () => {
		setupDOM();

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.dataset.key ).toBeUndefined();
		expect( li.dataset.url ).toBeUndefined();
	} );
} );

describe( 'removePendingEntry via plupload FilesAdded', () => {
	let filesAddedHandler;

	async function setupWithPlupload( pendingUploads ) {
		setupDOM();

		const mockUploader = {
			bind: vi.fn( ( event, handler ) => {
				if ( event === 'FilesAdded' ) {
					filesAddedHandler = handler;
				}
			} ),
		};

		window.uploader = mockUploader;
		window.jQuery = vi.fn( ( fn ) => fn() );

		await importModule( pendingUploads );
	}

	it( 'removes matching entry by filename and size', async () => {
		const pending = [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
			createPendingUploadEntry( 'doc.pdf', 1024 ),
		];
		await setupWithPlupload( pending );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 2 );

		filesAddedHandler( {}, [ { name: 'photo.jpg', size: 5242880 } ] );

		expect( list.children.length ).toBe( 1 );
		expect( list.children[ 0 ].dataset.filename ).toBe( 'doc.pdf' );
	} );

	it( 'does not remove entry with matching name but different size', async () => {
		await setupWithPlupload( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );

		filesAddedHandler( {}, [ { name: 'photo.jpg', size: 999 } ] );

		expect( list.children.length ).toBe( 1 );
	} );

	it( 'does not remove entry with matching size but different name', async () => {
		await setupWithPlupload( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );

		filesAddedHandler( {}, [ { name: 'other.jpg', size: 5242880 } ] );

		expect( list.children.length ).toBe( 1 );
	} );

	it( 'hides container when last entry is removed', async () => {
		await setupWithPlupload( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);

		filesAddedHandler( {}, [ { name: 'photo.jpg', size: 5242880 } ] );

		expect( container.style.display ).toBe( 'none' );
	} );

	it( 'removes multiple matching entries in one event', async () => {
		await setupWithPlupload( [
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
		const { discardPendingUpload } = await importModule( [ pending ] );
		discardPendingUpload.mockResolvedValue();

		discardItem( document.querySelector( '.uploads-unleashed-list li' ) );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( discardPendingUpload ).toHaveBeenCalledWith( pending );

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 0 );
	} );

	it( 'hides container when last item is discarded', async () => {
		setupDOM();

		const { discardPendingUpload } = await importModule( [
			createPendingUploadEntry( 'test.txt', 1024 ),
		] );
		discardPendingUpload.mockResolvedValue();

		discardItem( document.querySelector( '.uploads-unleashed-list li' ) );

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
		const { discardPendingUpload } = await importModule( [ itemA, itemB ] );
		discardPendingUpload.mockResolvedValue();

		const list = document.querySelector( '.uploads-unleashed-list' );

		// Discard the first item
		discardItem( list.children[ 0 ] );

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
		window.showOpenFilePicker = vi.fn( () =>
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
		await importModule( [ pending ] );

		const file = new File( [ 'x'.repeat( size ) ], 'photo.jpg', {
			type: 'image/jpeg',
			lastModified: LAST_MODIFIED,
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
		await importModule( [ pending ] );

		// showOpenFilePicker throws AbortError on cancel
		const abortError = new DOMException( 'The user aborted', 'AbortError' );
		window.showOpenFilePicker = vi.fn( () => Promise.reject( abortError ) );

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
		await importModule( [ pending ] );

		// No showOpenFilePicker — fallback to file input.
		delete window.showOpenFilePicker;

		// Mock createElement to capture the file input.
		const originalCreateElement = document.createElement.bind( document );
		let capturedInput = null;
		vi.spyOn( document, 'createElement' ).mockImplementation( ( tag ) => {
			const el = originalCreateElement( tag );
			if ( tag === 'input' ) {
				capturedInput = el;
				// Override click to trigger onchange with matching file.
				el.click = () => {
					const file = new File( [ 'x'.repeat( size ) ], 'doc.txt', {
						type: 'text/plain',
						lastModified: LAST_MODIFIED,
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
		await importModule( [ pending ] );

		// Wrong file (different name).
		const wrongFile = new File( [ 'x' ], 'wrong.txt', {
			type: 'text/plain',
			lastModified: LAST_MODIFIED,
		} );
		mockShowOpenFilePicker( wrongFile );

		const alertSpy = vi.spyOn( window, 'alert' ).mockImplementation();

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

	it( 'shows inline error for a modified file and keeps item', async () => {
		setupDOM();
		const input = setupMoxieShim();

		const size = 1024;
		const pending = createPendingUploadEntry( 'photo.jpg', size );
		await importModule( [ pending ] );

		// Same name and size, but edited since the upload started.
		const modifiedFile = new File( [ 'x'.repeat( size ) ], 'photo.jpg', {
			type: 'image/jpeg',
			lastModified: LAST_MODIFIED + 1000,
		} );
		mockShowOpenFilePicker( modifiedFile );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl.style.display ).toBe( 'block' );
		expect( errorEl.textContent ).toContain( 'photo.jpg' );
		expect( input.files ).toBeNull();

		const list = document.querySelector( '.uploads-unleashed-list' );
		expect( list.children.length ).toBe( 1 );
	} );

	it( 'keeps item when no moxie-shim input exists', async () => {
		setupDOM();
		// No setupMoxieShim — no .moxie-shim input.

		const size = 1024;
		const pending = createPendingUploadEntry( 'test.txt', size );
		await importModule( [ pending ] );

		const file = new File( [ 'x'.repeat( size ) ], 'test.txt', {
			type: 'text/plain',
			lastModified: LAST_MODIFIED,
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
		await importModule( [ pending ] );

		// Throw a non-AbortError so fallback kicks in.
		window.showOpenFilePicker = vi.fn( () =>
			Promise.reject( new Error( 'Not supported' ) )
		);

		// Mock createElement for fallback input that returns null (user cancels).
		const originalCreateElement = document.createElement.bind( document );
		vi.spyOn( document, 'createElement' ).mockImplementation( ( tag ) => {
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
		window.showOpenFilePicker = vi.fn( () =>
			Promise.resolve( [ { getFile: () => Promise.resolve( file ) } ] )
		);
	}

	afterEach( () => {
		delete window.showOpenFilePicker;
	} );

	it( 'hides error by default', async () => {
		setupDOM();

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl ).not.toBeNull();
		expect( errorEl.style.display ).toBe( 'none' );
	} );

	it( 'shows inline error on wrong file instead of alert', async () => {
		setupDOM();
		setupMoxieShim();

		const size = 5242880;
		const pending = createPendingUploadEntry( 'photo.jpg', size );
		await importModule( [ pending ] );

		const wrongFile = new File( [ 'x' ], 'wrong.txt', {
			type: 'text/plain',
			lastModified: LAST_MODIFIED,
		} );
		mockShowOpenFilePicker( wrongFile );

		const alertSpy = vi.spyOn( window, 'alert' ).mockImplementation();

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
		await importModule( [ pending ] );

		// First attempt: wrong file
		const wrongFile = new File( [ 'x' ], 'wrong.txt', {
			type: 'text/plain',
			lastModified: LAST_MODIFIED,
		} );
		mockShowOpenFilePicker( wrongFile );

		document.querySelector( '.resume-upload' ).click();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl.style.display ).toBe( 'block' );

		// Second attempt: right file
		const rightFile = new File( [ 'x'.repeat( size ) ], 'photo.jpg', {
			type: 'image/jpeg',
			lastModified: LAST_MODIFIED,
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
	it( 'does nothing when container is missing', async () => {
		// No setupDOM — no container.
		const mockUploader = {
			bind: vi.fn( ( event, handler ) => {
				if ( event === 'FilesAdded' ) {
					// Call handler immediately.
					handler( {}, [ { name: 'test.txt', size: 100 } ] );
				}
			} ),
		};
		window.uploader = mockUploader;
		window.jQuery = vi.fn( ( fn ) => fn() );

		// Explicit assertion so vitest/expect-expect sees the "should not throw" intent.
		await expect(
			importModule( [ createPendingUploadEntry( 'test.txt', 100 ) ] )
		).resolves.toBeDefined();
	} );
} );

describe( 'hookPlupload', () => {
	it( 'does nothing when window.uploader is not set', async () => {
		setupDOM();
		delete window.uploader;
		window.jQuery = vi.fn( ( fn ) => fn() );

		await expect(
			importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] )
		).resolves.toBeDefined();
	} );
} );

describe( 'DOMContentLoaded', () => {
	it( 'defers init when document is loading', async () => {
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

		const addEventSpy = vi.spyOn( document, 'addEventListener' );

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

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
	it( 'formats bytes', async () => {
		setupDOM();
		await importModule( [ createPendingUploadEntry( 'tiny.txt', 500 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe( '(500 B)' );
	} );

	it( 'formats kilobytes', async () => {
		setupDOM();
		await importModule( [ createPendingUploadEntry( 'small.txt', 2048 ) ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(2.0 KB)'
		);
	} );

	it( 'formats megabytes', async () => {
		setupDOM();
		await importModule( [
			createPendingUploadEntry( 'big.mp4', 10 * 1024 * 1024 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(10.0 MB)'
		);
	} );

	it( 'formats gigabytes', async () => {
		setupDOM();
		await importModule( [
			createPendingUploadEntry( 'huge.iso', 1.5 * 1024 * 1024 * 1024 ),
		] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(1.5 GB)'
		);
	} );
} );

describe( 'upload progress percentage', () => {
	it( 'renders percentage when bytesUploaded > 0', async () => {
		setupDOM();

		const entry = createPendingUploadEntry( 'photo.jpg', 52428800 );
		entry.bytesUploaded = 22020096;

		await importModule( [ entry ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(42% of 50.0 MB)'
		);
	} );

	it( 'renders plain file size when bytesUploaded is 0', async () => {
		setupDOM();

		const entry = createPendingUploadEntry( 'photo.jpg', 52428800 );
		entry.bytesUploaded = 0;

		await importModule( [ entry ] );

		const li = document.querySelector( 'li' );
		expect( li.querySelector( '.filesize' ).textContent ).toBe(
			'(50.0 MB)'
		);
	} );
} );

describe( 'accessibility', () => {
	it( 'sets aria-label on Resume button containing filename', async () => {
		setupDOM();

		await importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const resumeBtn = document.querySelector( '.resume-upload' );
		expect( resumeBtn.getAttribute( 'aria-label' ) ).toBe(
			'Resume upload of photo.jpg'
		);
	} );

	it( 'sets aria-label on Discard button containing filename', async () => {
		setupDOM();

		await importModule( [
			createPendingUploadEntry( 'photo.jpg', 5242880 ),
		] );

		const discardBtn = document.querySelector( '.discard-upload' );
		expect( discardBtn.getAttribute( 'aria-label' ) ).toBe(
			'Discard upload of photo.jpg'
		);
	} );

	it( 'sets role and aria-label on container', async () => {
		setupDOM();

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);
		expect( container.getAttribute( 'role' ) ).toBe( 'region' );
		expect( container.getAttribute( 'aria-label' ) ).toBe(
			'Pending uploads'
		);
	} );

	it( 'calls speak on discard with filename', async () => {
		setupDOM();

		const pending = createPendingUploadEntry( 'report.pdf', 2048 );
		const { discardPendingUpload } = await importModule( [ pending ] );
		const { speak } = await import( '@wordpress/a11y' );
		discardPendingUpload.mockResolvedValue();

		discardItem( document.querySelector( '.uploads-unleashed-list li' ) );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( speak ).toHaveBeenCalledWith(
			'Upload of report.pdf discarded',
			'polite'
		);
	} );

	it( 'calls speak on successful resume', async () => {
		setupDOM();

		// Add moxie-shim input so resumeUpload can dispatch the file.
		const shim = document.createElement( 'div' );
		shim.className = 'moxie-shim';
		const fileInput = document.createElement( 'input' );
		fileInput.type = 'file';
		let storedFiles = null;
		Object.defineProperty( fileInput, 'files', {
			get: () => storedFiles,
			set: ( val ) => {
				storedFiles = val;
			},
		} );
		shim.appendChild( fileInput );
		document.body.appendChild( shim );

		const size = 1024;
		const pending = createPendingUploadEntry( 'video.mp4', size );
		await importModule( [ pending ] );
		const { speak } = await import( '@wordpress/a11y' );

		const file = new File( [ 'x'.repeat( size ) ], 'video.mp4', {
			type: 'video/mp4',
			lastModified: LAST_MODIFIED,
		} );
		window.showOpenFilePicker = vi.fn( () =>
			Promise.resolve( [ { getFile: () => Promise.resolve( file ) } ] )
		);

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( speak ).toHaveBeenCalledWith(
			'Resuming upload of video.mp4',
			'polite'
		);
	} );

	it( 'does not call speak when resume is canceled', async () => {
		setupDOM();

		const pending = createPendingUploadEntry( 'video.mp4', 1024 );
		await importModule( [ pending ] );
		const { speak } = await import( '@wordpress/a11y' );

		const abortError = new DOMException( 'The user aborted', 'AbortError' );
		window.showOpenFilePicker = vi.fn( () => Promise.reject( abortError ) );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( speak ).not.toHaveBeenCalled();
	} );

	it( 'moves focus to next item after discard', async () => {
		setupDOM();

		const itemA = createPendingUploadEntry( 'a.txt', 100 );
		const itemB = createPendingUploadEntry( 'b.txt', 200 );
		const { discardPendingUpload } = await importModule( [ itemA, itemB ] );
		discardPendingUpload.mockResolvedValue();

		const list = document.querySelector( '.uploads-unleashed-list' );

		// Discard the first item.
		discardItem( list.children[ 0 ] );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Focus should move to the next item's Resume button.
		const nextResumeBtn =
			list.children[ 0 ].querySelector( '.resume-upload' );
		expect( document.activeElement ).toBe( nextResumeBtn );
	} );

	it( 'moves focus to last item when discarding last in list', async () => {
		setupDOM();

		const itemA = createPendingUploadEntry( 'a.txt', 100 );
		const itemB = createPendingUploadEntry( 'b.txt', 200 );
		const { discardPendingUpload } = await importModule( [ itemA, itemB ] );
		discardPendingUpload.mockResolvedValue();

		const list = document.querySelector( '.uploads-unleashed-list' );

		// Discard the last item.
		discardItem( list.children[ 1 ] );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		// Focus should move to the previous (now last) item's Resume button.
		const lastResumeBtn =
			list.lastElementChild.querySelector( '.resume-upload' );
		expect( document.activeElement ).toBe( lastResumeBtn );
	} );

	it( 'moves focus to browse button when list becomes empty', async () => {
		setupDOM();

		const browseBtn = document.createElement( 'button' );
		browseBtn.id = 'plupload-browse-button';
		document.body.appendChild( browseBtn );

		const pending = createPendingUploadEntry( 'only.txt', 512 );
		const { discardPendingUpload } = await importModule( [ pending ] );
		discardPendingUpload.mockResolvedValue();

		discardItem( document.querySelector( '.uploads-unleashed-list li' ) );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( document.activeElement ).toBe( browseBtn );
	} );
} );

describe( 'upload.php pending notice', () => {
	it( 'shows notice container when pending uploads exist', async () => {
		setupDOM();

		// Add the upload.php notice container
		const notice = document.createElement( 'div' );
		notice.id = 'uploads-unleashed-pending-notice';
		notice.style.display = 'none';
		document.body.appendChild( notice );

		await importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		expect( notice.style.display ).toBe( 'block' );
	} );

	it( 'keeps notice hidden when no pending uploads', async () => {
		setupDOM();

		const notice = document.createElement( 'div' );
		notice.id = 'uploads-unleashed-pending-notice';
		notice.style.display = 'none';
		document.body.appendChild( notice );

		await importModule( [] );

		// init() exits early when no pending, so container remains hidden
		expect( notice.style.display ).toBe( 'none' );
	} );
} );

/**
 * Adds the plupload file input that resumed files are dispatched to.
 */
function setupMoxieInput() {
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
}

/**
 * Makes the file picker return the given file.
 *
 * @param {File} file The file the user picks.
 */
function pickFile( file ) {
	window.showOpenFilePicker = vi.fn( () =>
		Promise.resolve( [ { getFile: () => Promise.resolve( file ) } ] )
	);
}

/**
 * Installs a mock plupload instance and returns its bound handlers.
 *
 * @return {Object} Handlers keyed by event name.
 */
function setupUploader() {
	const handlers = {};
	window.uploader = {
		bind: vi.fn( ( event, handler ) => {
			handlers[ event ] = handler;
		} ),
	};
	window.jQuery = vi.fn( ( fn ) => fn() );
	return handlers;
}

describe( 'discard confirmation', () => {
	it( 'asks for confirmation instead of discarding right away', async () => {
		setupDOM();

		const { discardPendingUpload } = await importModule( [
			createPendingUploadEntry( 'movie.mp4', 1024 ),
		] );

		const li = document.querySelector( '.uploads-unleashed-list li' );
		li.querySelector( '.discard-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( discardPendingUpload ).not.toHaveBeenCalled();

		const group = li.querySelector( '.uploads-unleashed-confirm' );
		expect( group ).not.toBeNull();
		expect( group.getAttribute( 'role' ) ).toBe( 'group' );

		const label = document.getElementById(
			group.getAttribute( 'aria-labelledby' )
		);
		expect( label.textContent ).toContain( 'movie.mp4' );

		expect( li.querySelector( '.resume-upload' ).style.display ).toBe(
			'none'
		);
		expect( li.querySelector( '.discard-upload' ).style.display ).toBe(
			'none'
		);
		expect( li.querySelector( '.confirm-discard' ) ).not.toBeNull();
	} );

	it( 'moves focus to Cancel when asking for confirmation', async () => {
		setupDOM();

		await importModule( [ createPendingUploadEntry( 'movie.mp4', 1024 ) ] );

		const li = document.querySelector( '.uploads-unleashed-list li' );
		li.querySelector( '.discard-upload' ).click();

		expect( document.activeElement ).toBe(
			li.querySelector( '.cancel-discard' )
		);
	} );

	it( 'restores the buttons and focuses Discard on Cancel', async () => {
		setupDOM();

		const { discardPendingUpload } = await importModule( [
			createPendingUploadEntry( 'movie.mp4', 1024 ),
		] );

		const li = document.querySelector( '.uploads-unleashed-list li' );
		const discardBtn = li.querySelector( '.discard-upload' );
		discardBtn.click();
		li.querySelector( '.cancel-discard' ).click();

		expect( li.querySelector( '.uploads-unleashed-confirm' ) ).toBeNull();
		expect( li.querySelector( '.resume-upload' ).style.display ).toBe( '' );
		expect( discardBtn.style.display ).toBe( '' );
		expect( document.activeElement ).toBe( discardBtn );
		expect( discardPendingUpload ).not.toHaveBeenCalled();
	} );

	it( 'cancels on Escape', async () => {
		setupDOM();

		const { discardPendingUpload } = await importModule( [
			createPendingUploadEntry( 'movie.mp4', 1024 ),
		] );

		const li = document.querySelector( '.uploads-unleashed-list li' );
		const discardBtn = li.querySelector( '.discard-upload' );
		discardBtn.click();

		li.querySelector( '.cancel-discard' ).dispatchEvent(
			new window.KeyboardEvent( 'keydown', {
				key: 'Escape',
				bubbles: true,
			} )
		);

		expect( li.querySelector( '.uploads-unleashed-confirm' ) ).toBeNull();
		expect( document.activeElement ).toBe( discardBtn );
		expect( discardPendingUpload ).not.toHaveBeenCalled();
	} );

	it( 'labels the confirm button with the filename', async () => {
		setupDOM();

		await importModule( [ createPendingUploadEntry( 'movie.mp4', 1024 ) ] );

		const li = document.querySelector( '.uploads-unleashed-list li' );
		li.querySelector( '.discard-upload' ).click();

		expect(
			li.querySelector( '.confirm-discard' ).getAttribute( 'aria-label' )
		).toBe( 'Discard upload of movie.mp4' );
	} );
} );

describe( 'resume focus management', () => {
	afterEach( () => {
		delete window.showOpenFilePicker;
	} );

	it( 'moves focus to the next item after resuming', async () => {
		setupDOM();
		setupMoxieInput();

		await importModule( [
			createPendingUploadEntry( 'a.mp4', 100 ),
			createPendingUploadEntry( 'b.mp4', 200 ),
		] );
		pickFile( new File( [ 'x'.repeat( 100 ) ], 'a.mp4' ) );

		const list = document.querySelector( '.uploads-unleashed-list' );
		const resumeBtn = list.children[ 0 ].querySelector( '.resume-upload' );
		resumeBtn.focus();
		resumeBtn.click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( list.children.length ).toBe( 1 );
		expect( document.activeElement ).toBe(
			list.children[ 0 ].querySelector( '.resume-upload' )
		);
	} );

	it( 'moves focus to the browse button after resuming the last item', async () => {
		setupDOM();
		setupMoxieInput();

		const browseBtn = document.createElement( 'button' );
		browseBtn.id = 'plupload-browse-button';
		document.body.appendChild( browseBtn );

		await importModule( [ createPendingUploadEntry( 'a.mp4', 100 ) ] );
		pickFile( new File( [ 'x'.repeat( 100 ) ], 'a.mp4' ) );

		const resumeBtn = document.querySelector( '.resume-upload' );
		resumeBtn.focus();
		resumeBtn.click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		expect( document.activeElement ).toBe( browseBtn );
	} );

	it( 'moves focus when plupload removes the focused item', async () => {
		setupDOM();
		const handlers = setupUploader();

		await importModule( [
			createPendingUploadEntry( 'a.mp4', 100 ),
			createPendingUploadEntry( 'b.mp4', 200 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );
		list.children[ 0 ].querySelector( '.discard-upload' ).focus();

		handlers.FilesAdded( {}, [ { name: 'a.mp4', size: 100 } ] );

		expect( document.activeElement ).toBe(
			list.children[ 0 ].querySelector( '.resume-upload' )
		);
	} );

	it( 'leaves focus alone when plupload removes another item', async () => {
		setupDOM();
		const handlers = setupUploader();

		await importModule( [
			createPendingUploadEntry( 'a.mp4', 100 ),
			createPendingUploadEntry( 'b.mp4', 200 ),
		] );

		const list = document.querySelector( '.uploads-unleashed-list' );
		const focused = list.children[ 1 ].querySelector( '.discard-upload' );
		focused.focus();

		handlers.FilesAdded( {}, [ { name: 'a.mp4', size: 100 } ] );

		expect( document.activeElement ).toBe( focused );
	} );
} );

describe( 'file mismatch announcement', () => {
	afterEach( () => {
		delete window.showOpenFilePicker;
	} );

	it( 'announces the mismatch error assertively', async () => {
		setupDOM();
		setupMoxieInput();

		await importModule( [ createPendingUploadEntry( 'photo.jpg', 1024 ) ] );
		const { speak } = await import( '@wordpress/a11y' );
		pickFile( new File( [ 'x' ], 'wrong.jpg' ) );

		document.querySelector( '.resume-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const errorEl = document.querySelector( '.uploads-unleashed-error' );
		expect( errorEl.textContent ).toContain( 'photo.jpg' );
		expect( speak ).toHaveBeenCalledWith(
			errorEl.textContent,
			'assertive'
		);
	} );
} );

describe( 'resumed upload progress announcements', () => {
	let now;

	beforeEach( () => {
		now = Date.now();
		vi.spyOn( Date, 'now' ).mockImplementation( () => now );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete window.showOpenFilePicker;
	} );

	/**
	 * Sets up a page with a pending upload that plupload then picks up.
	 *
	 * @return {Promise<Object>} The plupload handlers and the speak mock.
	 */
	async function setupResumedUpload() {
		setupDOM();
		const handlers = setupUploader();

		await importModule( [ createPendingUploadEntry( 'movie.mp4', 1000 ) ] );
		const { speak } = await import( '@wordpress/a11y' );

		handlers.FilesAdded( {}, [ { name: 'movie.mp4', size: 1000 } ] );
		speak.mockClear();

		return { handlers, speak };
	}

	it( 'announces progress in 10% steps at most every few seconds', async () => {
		const { handlers, speak } = await setupResumedUpload();
		const start = now;
		const file = { name: 'movie.mp4', size: 1000, percent: 0 };
		const progress = ( percent, elapsed ) => {
			now = start + elapsed;
			file.percent = percent;
			handlers.UploadProgress( {}, file );
		};

		// Too soon after "Resuming upload of …".
		progress( 42.5, 1000 );
		expect( speak ).not.toHaveBeenCalled();

		progress( 43, 6000 );
		expect( speak ).toHaveBeenCalledTimes( 1 );
		expect( speak ).toHaveBeenLastCalledWith(
			'Uploading movie.mp4: 40%',
			'polite'
		);

		// New step, but too soon after the last announcement.
		progress( 55, 7000 );
		expect( speak ).toHaveBeenCalledTimes( 1 );

		progress( 56, 12000 );
		expect( speak ).toHaveBeenCalledTimes( 2 );
		expect( speak ).toHaveBeenLastCalledWith(
			'Uploading movie.mp4: 50%',
			'polite'
		);

		// Same step, long after the last announcement.
		progress( 59, 30000 );
		expect( speak ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'does not announce progress for uploads that were not resumed', async () => {
		const { handlers, speak } = await setupResumedUpload();

		now += 60000;
		handlers.UploadProgress(
			{},
			{ name: 'other.mp4', size: 1000, percent: 50 }
		);

		expect( speak ).not.toHaveBeenCalled();
	} );

	it( 'announces progress for uploads resumed with the Resume button', async () => {
		setupDOM();
		setupMoxieInput();
		const handlers = setupUploader();

		await importModule( [ createPendingUploadEntry( 'movie.mp4', 100 ) ] );
		const { speak } = await import( '@wordpress/a11y' );
		pickFile( new File( [ 'x'.repeat( 100 ) ], 'movie.mp4' ) );

		document.querySelector( '.resume-upload' ).click();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		speak.mockClear();

		now += 60000;
		handlers.UploadProgress(
			{},
			{ name: 'movie.mp4', size: 100, percent: 71 }
		);

		expect( speak ).toHaveBeenCalledWith(
			'Uploading movie.mp4: 70%',
			'polite'
		);
	} );

	it( 'stops announcing once the upload reaches 100%', async () => {
		const { handlers, speak } = await setupResumedUpload();
		const file = { name: 'movie.mp4', size: 1000, percent: 100 };

		now += 60000;
		handlers.UploadProgress( {}, file );

		file.percent = 95;
		now += 60000;
		handlers.UploadProgress( {}, file );

		expect( speak ).not.toHaveBeenCalled();
	} );
} );

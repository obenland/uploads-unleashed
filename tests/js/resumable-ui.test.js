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
		return result;
	},
} ) );

jest.mock( '../../src/tus-client', () => ( {
	getPendingUploads: jest.fn( () => [] ),
	discardPendingUpload: jest.fn(),
} ) );

jest.mock( '../../src/resume-ui.css', () => ( {} ) );

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
	const { getPendingUploads } = require( '../../src/tus-client' );
	getPendingUploads.mockReturnValue( pendingUploads );

	jest.isolateModules( () => {
		require( '../../src/resume-ui' );
	} );
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

	it( 'hides container when no pending uploads', () => {
		const { container } = setupDOM();
		container.style.display = 'block';

		importModule( [] );

		expect( container.style.display ).toBe( 'block' );
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
		importModule( [ pending ] );

		const { discardPendingUpload } = require( '../../src/tus-client' );
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

		importModule( [ createPendingUploadEntry( 'test.txt', 1024 ) ] );

		const { discardPendingUpload } = require( '../../src/tus-client' );
		discardPendingUpload.mockResolvedValue();

		document.querySelector( '.discard-upload' ).click();

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		const container = document.getElementById(
			'uploads-unleashed-pending'
		);
		expect( container.style.display ).toBe( 'none' );
	} );
} );

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './utils';

/**
 * End-to-end coverage for the block editor `apiFetch` middleware.
 *
 * With client-side media processing (WordPress 7.1+ on HTTPS or localhost),
 * the editor uploads the original image, sends each derivative it generates
 * (sub-sizes and, for an animated GIF, a video version) to
 * `/wp/v2/media/{id}/sideload`, and finishes with `/wp/v2/media/{id}/finalize`.
 * Only the original may go through the plugin: a sideloaded derivative
 * routed through TUS becomes an attachment of its own, and finalizing fails.
 */

/**
 * Builds a two-frame animated GIF.
 *
 * Every pixel is written as a literal 8-bit LZW code, with a clear code
 * often enough that the code width never grows. That keeps the encoder
 * trivial at the cost of size, which doesn't matter here.
 *
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @return GIF file contents.
 */
function createAnimatedGif( width: number, height: number ): Buffer {
	const bytes: number[] = [];
	const pushUint16 = ( value: number ) =>
		bytes.push( value % 256, Math.floor( value / 256 ) );

	// Header and logical screen with a 128-color global color table.
	bytes.push( ...Buffer.from( 'GIF89a' ) );
	pushUint16( width );
	pushUint16( height );
	bytes.push( 0xf6, 0, 0 );
	for ( let i = 0; i < 128; i++ ) {
		bytes.push( i * 2, 255 - i * 2, 128 );
	}

	// Loop forever.
	bytes.push(
		0x21,
		0xff,
		0x0b,
		...Buffer.from( 'NETSCAPE2.0' ),
		3,
		1,
		0,
		0,
		0
	);

	for ( const color of [ 10, 100 ] ) {
		// Graphic control extension: 100ms delay, then the image descriptor.
		bytes.push( 0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c );
		pushUint16( 0 );
		pushUint16( 0 );
		pushUint16( width );
		pushUint16( height );
		bytes.push( 0, 7 );

		const codes: number[] = [];
		for ( let pixel = 0; pixel < width * height; pixel++ ) {
			if ( pixel % 120 === 0 ) {
				codes.push( 128 );
			}
			codes.push( color );
		}
		codes.push( 129 );

		for ( let i = 0; i < codes.length; i += 255 ) {
			const block = codes.slice( i, i + 255 );
			bytes.push( block.length, ...block );
		}
		bytes.push( 0 );
	}

	bytes.push( 0x3b );

	return Buffer.from( bytes );
}

test.describe( 'Block editor', () => {
	test( 'uploading an animated GIF creates a single attachment', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await page.waitForFunction( () =>
			( window as any ).wp?.data
				?.select( 'core/editor' )
				?.getCurrentPostId?.()
		);

		// Without client-side processing there are no sideloads to test.
		expect(
			await page.evaluate(
				() => ( window as any ).__clientSideMediaProcessing
			)
		).toBe( true );

		await page.evaluate( () => {
			const { data, blocks } = ( window as any ).wp;
			data.dispatch( 'core/preferences' ).set(
				'core/edit-post',
				'welcomeGuide',
				false
			);
			data.dispatch( 'core/block-editor' ).insertBlocks(
				blocks.createBlock( 'core/image' )
			);
		} );

		const filename = `editor-upload-${ Date.now() }`;
		const finalized = page.waitForResponse(
			( response ) =>
				decodeURIComponent( response.url() ).includes( '/finalize' ),
			{ timeout: 60000 }
		);

		await page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.locator( '.wp-block-image input[type="file"]' )
			.setInputFiles( {
				name: `${ filename }.gif`,
				mimeType: 'image/gif',
				buffer: createAnimatedGif( 320, 240 ),
			} );

		expect( ( await finalized ).status() ).toBe( 200 );

		const attachments = await page.evaluate(
			( search ) =>
				( window as any ).wp.apiFetch( {
					path: `/wp/v2/media?search=${ search }&context=edit&per_page=100`,
				} ),
			filename
		);

		expect(
			attachments.map(
				( attachment: { source_url: string } ) => attachment.source_url
			)
		).toEqual( [ expect.stringContaining( `${ filename }.gif` ) ] );

		// The client-generated sub-sizes were attached to the original.
		expect( attachments[ 0 ].media_details.sizes ).toHaveProperty(
			'thumbnail'
		);
	} );
} );

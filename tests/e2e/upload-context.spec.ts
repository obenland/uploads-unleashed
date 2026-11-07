import { test, expect, type Response } from '@playwright/test';
import path from 'node:path';
import { loginAsAdmin } from './utils';

/**
 * End-to-end coverage for the upload context: an upload from the media
 * modal is attached to the post being edited.
 */

type WpGlobal = {
	apiFetch: ( options: Record< string, unknown > ) => Promise< unknown >;
	data: {
		select: ( store: string ) => { getCurrentPostId: () => number };
	};
	media: ( options: Record< string, unknown > ) => { open: () => void };
};

/**
 * Whether a response completes a TUS upload.
 *
 * @param response A network response.
 * @return True for a successful PATCH to an upload URL.
 */
function isCompletedTusPatch( response: Response ): boolean {
	return (
		'PATCH' === response.request().method() &&
		decodeURIComponent( response.url() ).includes( 'wp/v2/media/' ) &&
		200 === response.status()
	);
}

test( 'attaches an upload from the media modal to the post being edited', async ( {
	page,
} ) => {
	await loginAsAdmin( page );
	await page.goto( '/wp-admin/post-new.php' );

	const postId = ( await (
		await page.waitForFunction( () =>
			( window as unknown as { wp?: WpGlobal } ).wp?.data
				?.select( 'core/editor' )
				?.getCurrentPostId?.()
		)
	).jsonValue() ) as number;

	await page.evaluate( () => {
		( window as unknown as { wp: WpGlobal } ).wp
			.media( { title: 'Select', multiple: false } )
			.open();
	} );

	const completed = page.waitForResponse( isCompletedTusPatch, {
		timeout: 30000,
	} );

	await page
		.locator( '.media-modal .moxie-shim input[type="file"]' )
		.first()
		.setInputFiles( path.resolve( __dirname, 'fixtures/test-image.png' ) );

	const { id } = ( await ( await completed ).json() ) as { id: number };
	const attachment = ( await page.evaluate(
		( attachmentId ) =>
			( window as unknown as { wp: WpGlobal } ).wp.apiFetch( {
				path: `/wp/v2/media/${ attachmentId }?context=edit`,
			} ),
		id
	) ) as { post: number | null };

	expect( attachment.post ).toBe( postId );
} );

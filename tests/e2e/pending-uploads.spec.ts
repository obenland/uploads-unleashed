import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAsAdmin } from './utils';

/**
 * Keyboard and focus coverage for the interrupted uploads list on
 * Media → Add New.
 */

/**
 * Last-modified timestamp shared by the seeded entries and the picked files,
 * so their TUS fingerprints match.
 */
const LAST_MODIFIED = 1700000000000;

/**
 * Seeds localStorage with interrupted uploads and reloads Media → Add New.
 *
 * @param page  Playwright page, already logged in.
 * @param files Name and size of each interrupted upload.
 */
async function seedPendingUploads(
	page: Page,
	files: Array< { name: string; size: number } >
): Promise< void > {
	await page.goto( '/wp-admin/media-new.php' );
	await page.evaluate(
		( { entries, lastModified } ) => {
			const { endpoint } = (
				window as unknown as { uploadsUnleashed: { endpoint: string } }
			 ).uploadsUnleashed;
			const expiresAt = Date.now() + 60 * 60 * 1000;

			Object.keys( localStorage )
				.filter( ( key ) => key.startsWith( 'tus' ) )
				.forEach( ( key ) => localStorage.removeItem( key ) );

			entries.forEach( ( { name, size }, index ) => {
				const fingerprint = [
					'tus-br',
					encodeURIComponent( name ),
					size,
					lastModified,
					endpoint,
				].join( '|' );
				localStorage.setItem(
					`tus::${ fingerprint }::${ expiresAt }::${ index }`,
					JSON.stringify( {
						uploadUrl: `${ endpoint }/00000000-0000-4000-8000-00000000000${ index }`,
					} )
				);
			} );
		},
		{ entries: files, lastModified: LAST_MODIFIED }
	);
	await page.reload();
	await expect(
		page.getByRole( 'region', { name: 'Pending uploads' } )
	).toBeVisible();
}

test.describe( 'Pending uploads keyboard access', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test( 'confirms Discard inline and manages focus', async ( { page } ) => {
		await seedPendingUploads( page, [
			{ name: 'keyboard-discard.txt', size: 2048 },
		] );

		const region = page.getByRole( 'region', { name: 'Pending uploads' } );
		const discard = region.getByRole( 'button', {
			name: 'Discard upload of keyboard-discard.txt',
		} );

		await discard.focus();
		await page.keyboard.press( 'Enter' );

		const confirmGroup = region.getByRole( 'group', {
			name: /keyboard-discard\.txt/,
		} );
		await expect( confirmGroup ).toBeVisible();
		await expect(
			confirmGroup.getByRole( 'button', { name: 'Cancel' } )
		).toBeFocused();

		// Escape backs out and returns focus to Discard.
		await page.keyboard.press( 'Escape' );
		await expect( confirmGroup ).toHaveCount( 0 );
		await expect( discard ).toBeFocused();

		// Confirming discards the upload and moves focus to the uploader.
		await page.keyboard.press( 'Enter' );
		await page.keyboard.press( 'Shift+Tab' );
		await expect(
			confirmGroup.getByRole( 'button', {
				name: 'Discard upload of keyboard-discard.txt',
			} )
		).toBeFocused();
		await page.keyboard.press( 'Enter' );

		await expect( region ).toBeHidden();
		await expect( page.locator( '#plupload-browse-button' ) ).toBeFocused();
		expect(
			await page.evaluate(
				() =>
					Object.keys( localStorage ).filter( ( key ) =>
						key.startsWith( 'tus::' )
					).length
			)
		).toBe( 0 );
	} );

	test( 'moves focus to the next upload after resuming', async ( {
		page,
	} ) => {
		await seedPendingUploads( page, [
			{ name: 'keyboard-first.txt', size: 1024 },
			{ name: 'keyboard-second.txt', size: 1024 },
		] );

		const region = page.getByRole( 'region', { name: 'Pending uploads' } );
		const resumeFirst = region.getByRole( 'button', {
			name: 'Resume upload of keyboard-first.txt',
		} );
		const resumeSecond = region.getByRole( 'button', {
			name: 'Resume upload of keyboard-second.txt',
		} );

		// Stand in for the native file picker with the original file.
		await page.evaluate( ( lastModified ) => {
			(
				window as unknown as {
					showOpenFilePicker: () => Promise< unknown[] >;
				}
			 ).showOpenFilePicker = async () => [
				{
					getFile: async () =>
						new File(
							[ 'x'.repeat( 1024 ) ],
							'keyboard-first.txt',
							{
								type: 'text/plain',
								lastModified,
							}
						),
				},
			];
		}, LAST_MODIFIED );

		await resumeFirst.focus();
		await page.keyboard.press( 'Enter' );

		await expect( resumeFirst ).toHaveCount( 0 );
		await expect( resumeSecond ).toBeFocused();
	} );
} );

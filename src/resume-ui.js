/**
 * Pending Uploads UI
 *
 * Displays interrupted/resumable uploads in the media uploader with
 * Resume and Discard buttons.
 *
 * @package
 */

import { sprintf, __ } from '@wordpress/i18n';
import { getPendingUploads, discardPendingUpload } from './tus-client';
import './resume-ui.css';

/**
 * Formats file size for display.
 *
 * @param {number} bytes File size in bytes.
 * @return {string} Formatted file size string.
 */
function formatFileSize( bytes ) {
	if ( bytes < 1024 ) {
		return bytes + ' B';
	}
	if ( bytes < 1024 * 1024 ) {
		return ( bytes / 1024 ).toFixed( 1 ) + ' KB';
	}
	return ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) + ' MB';
}

/**
 * Prompts user to re-select a file for resuming upload.
 * Uses File System Access API if available, falls back to file input.
 *
 * @param {Object} pendingUpload          Pending upload metadata.
 * @param {string} pendingUpload.filename Original filename.
 * @param {number} pendingUpload.size     File size in bytes.
 * @return {Promise<boolean>} True if upload was resumed, false if canceled.
 */
async function resumeUpload( pendingUpload ) {
	let file = null;

	// Extract file extension for filtering (more reliable than MIME type)
	const extMatch = pendingUpload.filename.match( /\.[^.]+$/ );
	const extension = extMatch ? extMatch[ 0 ].toLowerCase() : '';

	// Try File System Access API first (Chrome/Edge)
	if ( 'showOpenFilePicker' in window ) {
		try {
			const [ handle ] = await window.showOpenFilePicker( {
				multiple: false,
				types: extension
					? [
							{
								description: pendingUpload.filename,
								accept: { '*/*': [ extension ] },
							},
					  ]
					: undefined,
			} );
			file = await handle.getFile();
		} catch {
			// User canceled or API error - fall through to fallback
		}
	}

	// Fallback: Create hidden file input
	if ( ! file ) {
		file = await new Promise( ( resolve ) => {
			const input = document.createElement( 'input' );
			input.type = 'file';
			if ( extension ) {
				input.accept = extension;
			}
			input.onchange = () => resolve( input.files?.[ 0 ] || null );
			input.click();
		} );
	}

	if ( ! file ) {
		return false; // User canceled
	}

	// Verify file matches expected fingerprint (name + size)
	if (
		file.name !== pendingUpload.filename ||
		file.size !== pendingUpload.size
	) {
		// eslint-disable-next-line no-alert
		alert(
			sprintf(
				/* translators: 1: filename, 2: file size */
				__(
					'Please select the original file: %1$s (%2$s)',
					'uploads-unleashed'
				),
				pendingUpload.filename,
				formatFileSize( pendingUpload.size )
			)
		);
		return false;
	}

	// Trigger upload - tus-js-client will auto-detect and resume via fingerprint
	// Find the plupload file input and dispatch the file to it
	const uploader = document.querySelector( '.moxie-shim input[type="file"]' );
	if ( uploader ) {
		const dataTransfer = new DataTransfer();
		dataTransfer.items.add( file );
		uploader.files = dataTransfer.files;
		uploader.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		return true;
	}
	return false;
}

/**
 * Creates a pending upload list item using DOM APIs.
 *
 * @param {Object} item Pending upload item.
 * @return {HTMLLIElement} The list item element.
 */
function createPendingUploadItem( item ) {
	const li = document.createElement( 'li' );

	const filenameSpan = document.createElement( 'span' );
	filenameSpan.className = 'filename';
	filenameSpan.textContent = item.filename;

	const sizeSpan = document.createElement( 'span' );
	sizeSpan.className = 'filesize';
	sizeSpan.textContent = `(${ formatFileSize( item.size ) })`;

	const resumeBtn = document.createElement( 'button' );
	resumeBtn.type = 'button';
	resumeBtn.className = 'button resume-upload';
	resumeBtn.textContent = __( 'Resume', 'uploads-unleashed' );

	const discardBtn = document.createElement( 'button' );
	discardBtn.type = 'button';
	discardBtn.className = 'button discard-upload';
	discardBtn.textContent = __( 'Discard', 'uploads-unleashed' );

	li.append( filenameSpan, sizeSpan, resumeBtn, discardBtn );

	return li;
}

/**
 * Renders the pending uploads list.
 */
function renderPendingUploads() {
	const container = document.getElementById( 'uploads-unleashed-pending' );
	const list = container?.querySelector( '.uploads-unleashed-list' );
	if ( ! container || ! list ) {
		return;
	}

	const pending = getPendingUploads();
	if ( pending.length === 0 ) {
		container.style.display = 'none';
		return;
	}

	list.replaceChildren(
		...pending.map( ( item ) => {
			const li = createPendingUploadItem( item );

			li.querySelector( '.resume-upload' ).addEventListener(
				'click',
				async () => {
					const resumed = await resumeUpload( item );
					if ( resumed ) {
						li.remove();
						if ( list.children.length === 0 ) {
							container.style.display = 'none';
						}
					}
				}
			);

			li.querySelector( '.discard-upload' ).addEventListener(
				'click',
				async () => {
					await discardPendingUpload( item );
					li.remove();
					if ( list.children.length === 0 ) {
						container.style.display = 'none';
					}
				}
			);

			return li;
		} )
	);

	container.style.display = 'block';
}

/**
 * Removes a pending upload entry from the UI by filename and size.
 *
 * @param {string} filename File name to match.
 * @param {number} size     File size to match.
 */
function removePendingEntry( filename, size ) {
	const container = document.getElementById( 'uploads-unleashed-pending' );
	const list = container?.querySelector( '.uploads-unleashed-list' );
	if ( ! container || ! list ) {
		return;
	}

	list.querySelectorAll( 'li' ).forEach( ( li ) => {
		const entryFilename =
			li.querySelector( '.filename' )?.textContent || '';
		const entrySize =
			li.querySelector( '.filesize' )?.textContent || '';
		if (
			entryFilename === filename &&
			entrySize === `(${ formatFileSize( size ) })`
		) {
			li.remove();
		}
	} );

	if ( list.children.length === 0 ) {
		container.style.display = 'none';
	}
}

/**
 * Hooks into plupload to detect when files are added.
 */
function hookPlupload() {
	const uploader = window.uploader;
	if ( ! uploader ) {
		return;
	}

	uploader.bind( 'FilesAdded', ( ...args ) => {
		const files = args[ 1 ];
		files.forEach( ( file ) => {
			removePendingEntry( file.name, file.size );
		} );
	} );
}

/**
 * Initializes the pending uploads UI.
 */
function init() {
	const pending = getPendingUploads();
	if ( pending.length === 0 ) {
		return;
	}

	renderPendingUploads();

	// Hook plupload via jQuery ready (uploader is created by handlers.js)
	if ( typeof window.jQuery !== 'undefined' ) {
		window.jQuery( hookPlupload );
	}
}

// Initialize when DOM ready
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}

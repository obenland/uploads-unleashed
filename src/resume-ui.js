/**
 * Pending Uploads UI
 *
 * Displays interrupted/resumable uploads in the media uploader with
 * Resume and Discard buttons.
 *
 * @package
 */

import { sprintf, __ } from '@wordpress/i18n';
import { speak } from '@wordpress/a11y';
import {
	getPendingUploads,
	discardPendingUpload,
} from '@uploads-unleashed/tus-client';
import './resume-ui.css';

/**
 * Formats file size for display.
 *
 * @param {number} bytes File size in bytes.
 * @return {string} Formatted file size string.
 */
const SIZE_FORMATTER = new Intl.NumberFormat( undefined, {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
} );

function formatFileSize( bytes ) {
	if ( bytes < 1024 ) {
		return bytes + ' B';
	}
	if ( bytes < 1024 * 1024 ) {
		return SIZE_FORMATTER.format( bytes / 1024 ) + ' KB';
	}
	if ( bytes < 1024 * 1024 * 1024 ) {
		return SIZE_FORMATTER.format( bytes / ( 1024 * 1024 ) ) + ' MB';
	}
	return SIZE_FORMATTER.format( bytes / ( 1024 * 1024 * 1024 ) ) + ' GB';
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
		} catch ( err ) {
			// User canceled — don't fall through to a second dialog
			if ( err instanceof DOMException && err.name === 'AbortError' ) {
				return false;
			}
			// Other API error — fall through to fallback
		}
	}

	// Fallback: Create hidden file input (browsers without showOpenFilePicker)
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
 * @param {Object} item               Pending upload item from getPendingUploads().
 * @param {string} item.key           LocalStorage key.
 * @param {string} item.uploadUrl     TUS upload URL.
 * @param {string} item.filename      Original filename.
 * @param {number} item.size          File size in bytes.
 * @param {number} item.bytesUploaded Bytes already uploaded (0 if none).
 * @return {HTMLLIElement} The list item element.
 */
function createPendingUploadItem( item ) {
	const li = document.createElement( 'li' );
	li.dataset.filename = item.filename;
	li.dataset.size = item.size;

	const filenameSpan = document.createElement( 'span' );
	filenameSpan.className = 'filename';
	filenameSpan.textContent = item.filename;

	const sizeSpan = document.createElement( 'span' );
	sizeSpan.className = 'filesize';
	if ( item.bytesUploaded > 0 ) {
		const percent = Math.min(
			100,
			Math.round( ( item.bytesUploaded / item.size ) * 100 )
		);
		sizeSpan.textContent = sprintf(
			/* translators: 1: upload percentage, 2: total file size */
			__( '(%1$s%% of %2$s)', 'uploads-unleashed' ),
			percent,
			formatFileSize( item.size )
		);
	} else {
		sizeSpan.textContent = `(${ formatFileSize( item.size ) })`;
	}

	const resumeBtn = document.createElement( 'button' );
	resumeBtn.type = 'button';
	resumeBtn.className = 'button resume-upload';
	resumeBtn.textContent = __( 'Resume', 'uploads-unleashed' );
	resumeBtn.setAttribute(
		'aria-label',
		sprintf(
			/* translators: 1: filename */
			__( 'Resume upload of %1$s', 'uploads-unleashed' ),
			item.filename
		)
	);

	const discardBtn = document.createElement( 'button' );
	discardBtn.type = 'button';
	discardBtn.className = 'button discard-upload';
	discardBtn.textContent = __( 'Discard', 'uploads-unleashed' );
	discardBtn.setAttribute(
		'aria-label',
		sprintf(
			/* translators: 1: filename */
			__( 'Discard upload of %1$s', 'uploads-unleashed' ),
			item.filename
		)
	);

	li.append( filenameSpan, sizeSpan, resumeBtn, discardBtn );

	return li;
}

/**
 * Renders the pending uploads list and binds resume/discard handlers.
 */
function renderPendingUploads() {
	const container = document.getElementById( 'uploads-unleashed-pending' );
	const list = container?.querySelector( '.uploads-unleashed-list' );
	if ( ! container || ! list ) {
		return;
	}

	container.setAttribute( 'role', 'region' );
	container.setAttribute(
		'aria-label',
		__( 'Pending uploads', 'uploads-unleashed' )
	);

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
						speak(
							sprintf(
								/* translators: 1: filename */
								__(
									'Resuming upload of %1$s',
									'uploads-unleashed'
								),
								item.filename
							),
							'polite'
						);
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
					const nextLi = li.nextElementSibling;
					li.remove();
					speak(
						sprintf(
							/* translators: 1: filename */
							__(
								'Upload of %1$s discarded',
								'uploads-unleashed'
							),
							item.filename
						),
						'polite'
					);
					if ( list.children.length === 0 ) {
						container.style.display = 'none';
						document
							.getElementById( 'plupload-browse-button' )
							?.focus();
					} else if ( nextLi ) {
						nextLi.querySelector( '.resume-upload' )?.focus();
					} else {
						list.lastElementChild
							?.querySelector( '.resume-upload' )
							?.focus();
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
		if (
			li.dataset.filename === filename &&
			parseInt( li.dataset.size, 10 ) === size
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

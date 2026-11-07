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
 * Percentage steps in which resumed upload progress is announced.
 */
const PROGRESS_STEP = 10;

/**
 * Minimum time between two progress announcements, in milliseconds.
 */
const PROGRESS_INTERVAL_MS = 5000;

/**
 * Announcement state of resumed uploads, keyed by getUploadKey().
 *
 * @type {Map<string, {step: number, announcedAt: number}>}
 */
const resumedUploads = new Map();

/**
 * Counter for unique discard confirmation IDs.
 */
let confirmationCount = 0;

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
 * @param {Object}                    pendingUpload              Pending upload metadata.
 * @param {string}                    pendingUpload.filename     Original filename.
 * @param {number}                    pendingUpload.size         File size in bytes.
 * @param {number}                    pendingUpload.lastModified Last modified time of the original file.
 * @param {Object}                    options                    Optional settings.
 * @param {(message: string) => void} options.onMismatch         Callback when selected file doesn't match.
 * @return {Promise<boolean>} True if upload was resumed, false if canceled.
 */
async function resumeUpload( pendingUpload, options = {} ) {
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
		if ( options.onMismatch ) {
			options.onMismatch(
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
		}
		return false;
	}

	// The fingerprint includes the modification time, so a changed file would start over.
	if ( file.lastModified !== pendingUpload.lastModified ) {
		if ( options.onMismatch ) {
			options.onMismatch(
				sprintf(
					/* translators: 1: filename */
					__(
						'%1$s changed since the upload started, so it can no longer be resumed. Discard this upload and upload the file again.',
						'uploads-unleashed'
					),
					pendingUpload.filename
				)
			);
		}
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

	const errorMsg = document.createElement( 'span' );
	errorMsg.className = 'uploads-unleashed-error';
	errorMsg.style.display = 'none';

	li.append( filenameSpan, sizeSpan, resumeBtn, discardBtn, errorMsg );

	return li;
}

/**
 * Builds the key that identifies an upload by filename and size.
 *
 * @param {string} filename File name.
 * @param {number} size     File size in bytes.
 * @return {string} Upload key.
 */
function getUploadKey( filename, size ) {
	return `${ size }:${ filename }`;
}

/**
 * Starts announcing progress for a resumed upload.
 *
 * The first announcement waits PROGRESS_INTERVAL_MS, so it doesn't cut off
 * the "Resuming upload" message.
 *
 * @param {string} filename File name.
 * @param {number} size     File size in bytes.
 */
function trackResumedUpload( filename, size ) {
	const key = getUploadKey( filename, size );
	if ( ! resumedUploads.has( key ) ) {
		resumedUploads.set( key, { step: 0, announcedAt: Date.now() } );
	}
}

/**
 * Announces the progress of a resumed upload to screen readers.
 *
 * Announces each PROGRESS_STEP percent at most every PROGRESS_INTERVAL_MS.
 *
 * @param {Object} file         Plupload file object.
 * @param {string} file.name    File name.
 * @param {number} file.size    File size in bytes.
 * @param {number} file.percent Upload progress percentage.
 */
function announceProgress( file ) {
	const key = getUploadKey( file.name, file.size );
	const state = resumedUploads.get( key );
	if ( ! state ) {
		return;
	}

	if ( file.percent >= 100 ) {
		resumedUploads.delete( key );
		return;
	}

	const step = Math.floor( file.percent / PROGRESS_STEP ) * PROGRESS_STEP;
	const now = Date.now();
	if (
		step <= state.step ||
		now - state.announcedAt < PROGRESS_INTERVAL_MS
	) {
		return;
	}

	state.step = step;
	state.announcedAt = now;
	speak(
		sprintf(
			/* translators: 1: filename, 2: upload percentage */
			__( 'Uploading %1$s: %2$s%%', 'uploads-unleashed' ),
			file.name,
			step
		),
		'polite'
	);
}

/**
 * Removes a pending upload list item and hides the list once it's empty.
 *
 * @param {HTMLLIElement} li        The list item to remove.
 * @param {boolean}       moveFocus Whether to move focus to the next item, or the uploader if none is left.
 */
function removeListItem( li, moveFocus ) {
	const container = document.getElementById( 'uploads-unleashed-pending' );
	const list = li.parentElement;
	const sibling = li.nextElementSibling || li.previousElementSibling;

	li.remove();

	if ( list && list.children.length === 0 && container ) {
		container.style.display = 'none';
	}

	if ( ! moveFocus ) {
		return;
	}

	if ( sibling ) {
		// A sibling waiting for discard confirmation has its Resume button hidden.
		(
			sibling.querySelector( '.cancel-discard' ) ||
			sibling.querySelector( '.resume-upload' )
		)?.focus();
	} else {
		document.getElementById( 'plupload-browse-button' )?.focus();
	}
}

/**
 * Replaces the Resume and Discard buttons with an inline discard confirmation.
 *
 * Focus moves to Cancel, so pressing Enter twice doesn't discard by accident.
 * Cancel and Escape restore the buttons and return focus to Discard.
 *
 * @param {HTMLLIElement}       li        The pending upload list item.
 * @param {Object}              item      Pending upload item from getPendingUploads().
 * @param {() => Promise<void>} onConfirm Called when the user confirms.
 */
function confirmDiscard( li, item, onConfirm ) {
	const resumeBtn = li.querySelector( '.resume-upload' );
	const discardBtn = li.querySelector( '.discard-upload' );
	const questionId = `uploads-unleashed-confirm-${ ++confirmationCount }`;

	const group = document.createElement( 'span' );
	group.className = 'uploads-unleashed-confirm';
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-labelledby', questionId );

	const question = document.createElement( 'span' );
	question.id = questionId;
	question.className = 'uploads-unleashed-confirm-text';
	question.textContent = sprintf(
		/* translators: 1: filename */
		__(
			'Discard the interrupted upload of %1$s? This cannot be undone.',
			'uploads-unleashed'
		),
		item.filename
	);

	const confirmBtn = document.createElement( 'button' );
	confirmBtn.type = 'button';
	confirmBtn.className = 'button confirm-discard';
	confirmBtn.textContent = __( 'Discard', 'uploads-unleashed' );
	confirmBtn.setAttribute(
		'aria-label',
		sprintf(
			/* translators: 1: filename */
			__( 'Discard upload of %1$s', 'uploads-unleashed' ),
			item.filename
		)
	);

	const cancelBtn = document.createElement( 'button' );
	cancelBtn.type = 'button';
	cancelBtn.className = 'button cancel-discard';
	cancelBtn.textContent = __( 'Cancel', 'uploads-unleashed' );

	const cancel = () => {
		group.remove();
		resumeBtn.style.display = '';
		discardBtn.style.display = '';
		discardBtn.focus();
	};

	cancelBtn.addEventListener( 'click', cancel );
	group.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			event.preventDefault();
			cancel();
		}
	} );
	confirmBtn.addEventListener( 'click', () => {
		confirmBtn.disabled = true;
		cancelBtn.disabled = true;
		onConfirm();
	} );

	group.append( question, confirmBtn, cancelBtn );
	resumeBtn.style.display = 'none';
	discardBtn.style.display = 'none';
	discardBtn.after( group );
	cancelBtn.focus();
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
					const errorEl = li.querySelector(
						'.uploads-unleashed-error'
					);
					if ( errorEl ) {
						errorEl.style.display = 'none';
					}

					const resumed = await resumeUpload( item, {
						onMismatch: ( message ) => {
							if ( errorEl ) {
								errorEl.textContent = message;
								errorEl.style.display = 'block';
							}
							speak( message, 'assertive' );
						},
					} );
					if ( resumed ) {
						trackResumedUpload( item.filename, item.size );
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

						// Plupload may have removed the item already.
						if ( li.isConnected ) {
							removeListItem( li, true );
						}
					}
				}
			);

			li.querySelector( '.discard-upload' ).addEventListener(
				'click',
				() =>
					confirmDiscard( li, item, async () => {
						await discardPendingUpload( item );
						removeListItem( li, true );
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
					} )
			);

			return li;
		} )
	);

	container.style.display = 'block';
}

/**
 * Removes a pending upload entry from the UI by filename and size.
 *
 * Moves focus on if the removed entry had it.
 *
 * @param {string} filename File name to match.
 * @param {number} size     File size to match.
 * @return {boolean} Whether a pending entry matched.
 */
function removePendingEntry( filename, size ) {
	const container = document.getElementById( 'uploads-unleashed-pending' );
	const list = container?.querySelector( '.uploads-unleashed-list' );
	if ( ! container || ! list ) {
		return false;
	}

	let matched = false;
	list.querySelectorAll( 'li' ).forEach( ( li ) => {
		if (
			li.dataset.filename === filename &&
			parseInt( li.dataset.size, 10 ) === size
		) {
			matched = true;
			removeListItem( li, li.contains( li.ownerDocument.activeElement ) );
		}
	} );

	return matched;
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
			if ( removePendingEntry( file.name, file.size ) ) {
				trackResumedUpload( file.name, file.size );
			}
		} );
	} );

	uploader.bind( 'UploadProgress', ( ...args ) => {
		announceProgress( args[ 1 ] );
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

	// Show notice on upload.php if pending uploads exist.
	const noticeContainer = document.getElementById(
		'uploads-unleashed-pending-notice'
	);
	if ( noticeContainer ) {
		noticeContainer.style.display = 'block';
	}

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

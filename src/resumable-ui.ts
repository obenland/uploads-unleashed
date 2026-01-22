/**
 * Pending Uploads UI
 *
 * Displays interrupted/resumable uploads in the media uploader with
 * Resume and Discard buttons.
 *
 * @package resumable-uploads
 */

import { sprintf, __ } from '@wordpress/i18n';
import './resumable-ui.css';

interface PluploadFile {
	name: string;
	size: number;
}

interface PluploadInstance {
	bind: ( event: string, callback: ( uploader: PluploadInstance, files: PluploadFile[] ) => void ) => void;
}

declare global {
	interface Window {
		resumableUploads?: {
			endpoint: string;
			nonce: string;
		};
		uploader?: PluploadInstance;
		jQuery?: ( callback: () => void ) => void;
	}
}

interface PendingUpload {
	key: string;
	uploadUrl: string;
	filename: string;
	filetype: string;
	size: number;
}

const endpoint = window.resumableUploads?.endpoint || '';
const nonce = window.resumableUploads?.nonce || '';

/**
 * Parses localStorage for pending TUS uploads.
 */
function parsePendingUploads(): PendingUpload[] {
	const pending: PendingUpload[] = [];

	for ( let i = 0; i < localStorage.length; i++ ) {
		const key = localStorage.key( i );
		if ( ! key?.startsWith( 'tus::tus-br-' ) ) {
			continue;
		}
		if ( ! key.includes( endpoint ) ) {
			continue;
		}

		try {
			const data = JSON.parse( localStorage.getItem( key ) || '' );
			// Parse fingerprint: tus::tus-br-{filename}-{filetype}-{size}-{lastModified}-{endpoint}::{id}
			const fingerprint = key.split( '::' )[ 1 ];
			const parts = fingerprint.split( '-' );
			// Filename may contain dashes, so join all but last 4 parts
			const filename = parts.slice( 2, -4 ).join( '-' );
			const filetype = parts[ parts.length - 4 ];
			const size = parseInt( parts[ parts.length - 3 ], 10 );

			pending.push( {
				key,
				uploadUrl: data.uploadUrl,
				filename: decodeURIComponent( filename ),
				filetype,
				size,
			} );
		} catch {
			// Ignore malformed entries
		}
	}
	return pending;
}

/**
 * Formats file size for display.
 */
function formatFileSize( bytes: number ): string {
	if ( bytes < 1024 ) {
		return bytes + ' B';
	}
	if ( bytes < 1024 * 1024 ) {
		return ( bytes / 1024 ).toFixed( 1 ) + ' KB';
	}
	return ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) + ' MB';
}

/**
 * Cancels the server-side upload session.
 */
async function cancelServerUpload( uploadUrl: string ): Promise< void > {
	try {
		await fetch( uploadUrl, {
			method: 'DELETE',
			headers: { 'X-WP-Nonce': nonce },
		} );
	} catch {
		// Ignore errors - session may already be expired
	}
}

/**
 * Discards an upload by canceling server-side and removing from localStorage.
 */
async function discardUpload(
	key: string,
	uploadUrl: string
): Promise< void > {
	// 1. Cancel server-side session
	await cancelServerUpload( uploadUrl );

	// 2. Remove from localStorage
	localStorage.removeItem( key );
}

/**
 * Prompts user to re-select a file for resuming upload.
 * Uses File System Access API if available, falls back to file input.
 */
async function resumeUpload( upload: PendingUpload ): Promise< boolean > {
	let file: File | null = null;

	// Try File System Access API first (Chrome/Edge)
	if ( 'showOpenFilePicker' in window ) {
		try {
			const [ handle ] = await ( window as Window & { showOpenFilePicker: ( options: object ) => Promise< FileSystemFileHandle[] > } ).showOpenFilePicker( {
				types: [
					{
						description: upload.filename,
						accept: { [ upload.filetype ]: [] },
					},
				],
				multiple: false,
			} );
			file = await handle.getFile();
		} catch {
			// User cancelled or API error - fall through to fallback
		}
	}

	// Fallback: Create hidden file input
	if ( ! file ) {
		file = await new Promise< File | null >( ( resolve ) => {
			const input = document.createElement( 'input' );
			input.type = 'file';
			input.accept = upload.filetype;
			input.onchange = () => resolve( input.files?.[ 0 ] || null );
			input.click();
		} );
	}

	if ( ! file ) {
		return false; // User cancelled
	}

	// Verify file matches expected fingerprint (name + size)
	if ( file.name !== upload.filename || file.size !== upload.size ) {
		// eslint-disable-next-line no-alert
		alert(
			sprintf(
				/* translators: 1: filename, 2: file size */
				__( 'Please select the original file: %1$s (%2$s)', 'resumable-uploads' ),
				upload.filename,
				formatFileSize( upload.size )
			)
		);
		return false;
	}

	// Trigger upload - tus-js-client will auto-detect and resume via fingerprint
	// Find the plupload file input and dispatch the file to it
	const uploader = document.querySelector(
		'.moxie-shim input[type="file"]'
	) as HTMLInputElement;
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
 * Renders the pending uploads list.
 */
function renderPendingUploads(): void {
	const container = document.getElementById( 'resumable-uploads-pending' );
	const list = container?.querySelector(
		'.resumable-uploads-list'
	) as HTMLUListElement | null;
	if ( ! container || ! list ) {
		return;
	}

	const pending = parsePendingUploads();
	if ( pending.length === 0 ) {
		container.style.display = 'none';
		return;
	}

	list.innerHTML = pending
		.map(
			( upload ) => `
		<li data-key="${ upload.key }" data-url="${ upload.uploadUrl }"
			data-filename="${ upload.filename }" data-filetype="${ upload.filetype }" data-size="${ upload.size }">
			<span class="filename">${ upload.filename }</span>
			<span class="filesize">(${ formatFileSize( upload.size ) })</span>
			<button type="button" class="button resume-upload">${ __( 'Resume', 'resumable-uploads' ) }</button>
			<button type="button" class="button discard-upload">${ __( 'Discard', 'resumable-uploads' ) }</button>
		</li>
	`
		)
		.join( '' );

	// Bind resume buttons
	list.querySelectorAll( '.resume-upload' ).forEach( ( btn ) => {
		btn.addEventListener( 'click', async ( e ) => {
			const li = ( e.target as Element ).closest( 'li' );
			if ( ! li ) {
				return;
			}

			const upload: PendingUpload = {
				key: li.getAttribute( 'data-key' ) || '',
				uploadUrl: li.getAttribute( 'data-url' ) || '',
				filename: li.getAttribute( 'data-filename' ) || '',
				filetype: li.getAttribute( 'data-filetype' ) || '',
				size: parseInt( li.getAttribute( 'data-size' ) || '0', 10 ),
			};
			const resumed = await resumeUpload( upload );
			if ( resumed ) {
				li.remove();
				if ( list.children.length === 0 ) {
					container.style.display = 'none';
				}
			}
		} );
	} );

	// Bind discard buttons
	list.querySelectorAll( '.discard-upload' ).forEach( ( btn ) => {
		btn.addEventListener( 'click', async ( e ) => {
			const li = ( e.target as Element ).closest( 'li' );
			const key = li?.getAttribute( 'data-key' );
			const url = li?.getAttribute( 'data-url' );
			if ( key && url ) {
				await discardUpload( key, url );
				li?.remove();
				if ( list.children.length === 0 ) {
					container.style.display = 'none';
				}
			}
		} );
	} );

	container.style.display = 'block';
}

/**
 * Removes a pending upload entry from the UI by filename and size.
 */
function removePendingEntry( filename: string, size: number ): void {
	const container = document.getElementById( 'resumable-uploads-pending' );
	const list = container?.querySelector( '.resumable-uploads-list' );
	if ( ! container || ! list ) {
		return;
	}

	const entries = list.querySelectorAll( 'li' );
	entries.forEach( ( li ) => {
		const entryFilename = li.getAttribute( 'data-filename' );
		const entrySize = parseInt( li.getAttribute( 'data-size' ) || '0', 10 );
		if ( entryFilename === filename && entrySize === size ) {
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
function hookPlupload(): void {
	const uploader = window.uploader;
	if ( ! uploader ) {
		return;
	}

	uploader.bind( 'FilesAdded', ( _up, files ) => {
		files.forEach( ( file ) => {
			removePendingEntry( file.name, file.size );
		} );
	} );
}

/**
 * Initializes the pending uploads UI.
 */
function init(): void {
	const pending = parsePendingUploads();
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

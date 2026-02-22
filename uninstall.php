<?php
/**
 * Uninstall handler for Uploads Unleashed.
 *
 * Removes all plugin data on deletion:
 * - Chunk files and storage directory from uploads.
 * - Upload session transients from the options table.
 * - Scheduled cleanup cron events.
 *
 * On multisite, iterates all sites in the network.
 *
 * @package uploads-unleashed
 */

// Exit if not called by WordPress uninstall.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require_once __DIR__ . '/includes/class-uploads-unleashed-tus-upload-session.php';
require_once __DIR__ . '/includes/class-uploads-unleashed-tus-chunk-storage.php';

if ( is_multisite() ) {
	$sites = get_sites(
		array(
			'fields'                 => 'ids',
			'number'                 => 0,
			'update_site_cache'      => false,
			'update_site_meta_cache' => false,
		)
	);

	foreach ( $sites as $site_id ) {
		switch_to_blog( $site_id );

		try {
			Uploads_Unleashed_TUS_Chunk_Storage::delete_all();
			Uploads_Unleashed_TUS_Upload_Session::delete_all();
			wp_clear_scheduled_hook( 'uploads_unleashed_cleanup' );
		} finally {
			restore_current_blog();
		}
	}
} else {
	Uploads_Unleashed_TUS_Chunk_Storage::delete_all();
	Uploads_Unleashed_TUS_Upload_Session::delete_all();
	wp_clear_scheduled_hook( 'uploads_unleashed_cleanup' );
}

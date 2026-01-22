<?php
/**
 * Plugin Name: Resumable Uploads
 * Plugin URI: https://github.com/obenland/resumable-uploads
 * Description: TUS protocol support for resumable media uploads in WordPress.
 * Version: 0.1.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Author: Konstantin Obenland
 * Author URI: https://developer.wordpress.org
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: resumable-uploads
 *
 * @package resumable-uploads
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RESUMABLE_UPLOADS_VERSION', '0.1.0' );
define( 'RESUMABLE_UPLOADS_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'RESUMABLE_UPLOADS_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Include required files.
require_once RESUMABLE_UPLOADS_PLUGIN_DIR . 'includes/class-tus-upload-session.php';
require_once RESUMABLE_UPLOADS_PLUGIN_DIR . 'includes/class-tus-chunk-storage.php';
require_once RESUMABLE_UPLOADS_PLUGIN_DIR . 'includes/class-rest-tus-controller.php';

/**
 * Initializes the plugin.
 *
 * @since 0.1.0
 */
function resumable_uploads_init() {
	// Schedule cleanup cron if not already scheduled.
	if ( ! wp_next_scheduled( 'resumable_uploads_cleanup' ) ) {
		wp_schedule_event( time(), 'hourly', 'resumable_uploads_cleanup' );
	}
}
add_action( 'plugins_loaded', 'resumable_uploads_init' );

/**
 * Registers REST API routes.
 *
 * @since 0.1.0
 */
function resumable_uploads_register_routes() {
	$controller = new REST_TUS_Controller();
	$controller->register_routes();
}
add_action( 'rest_api_init', 'resumable_uploads_register_routes' );

/**
 * Adds TUS headers to OPTIONS requests.
 *
 * @since 0.1.0
 *
 * @param WP_REST_Response $response The response object.
 * @param WP_REST_Server   $server   The REST server instance.
 * @param WP_REST_Request  $request  The request object.
 *
 * @return WP_REST_Response Modified response.
 */
function resumable_uploads_add_options_headers( WP_REST_Response $response, WP_REST_Server $server, WP_REST_Request $request ): WP_REST_Response {
	if ( 'OPTIONS' !== $request->get_method() ) {
		return $response;
	}

	$route = $request->get_route();
	if ( 0 !== strpos( $route, '/wp/v2/media/tus' ) ) {
		return $response;
	}

	$controller = new REST_TUS_Controller();
	return $controller->add_options_headers( $response );
}
add_filter( 'rest_post_dispatch', 'resumable_uploads_add_options_headers', 10, 3 );

/**
 * Cleans up expired uploads.
 *
 * @since 0.1.0
 */
function resumable_uploads_cleanup() {
	TUS_Chunk_Storage::cleanup_expired();
}
add_action( 'resumable_uploads_cleanup', 'resumable_uploads_cleanup' );

/**
 * Clears the scheduled cleanup event on plugin deactivation.
 *
 * @since 0.1.0
 */
function resumable_uploads_deactivate() {
	$timestamp = wp_next_scheduled( 'resumable_uploads_cleanup' );
	if ( $timestamp ) {
		wp_unschedule_event( $timestamp, 'resumable_uploads_cleanup' );
	}
}
register_deactivation_hook( __FILE__, 'resumable_uploads_deactivate' );

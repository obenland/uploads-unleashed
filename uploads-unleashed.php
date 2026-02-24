<?php
/**
 * Plugin Name: Uploads Unleashed
 * Plugin URI: https://en.wp.obenland.it/uploads-unleashed/
 * Description: Upload large files to WordPress without hitting size limits or losing progress when your connection drops.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Author: Konstantin Obenland
 * Author URI: https://konstantin.obenland.it
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: uploads-unleashed
 *
 * @package uploads-unleashed
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'UPLOADS_UNLEASHED_VERSION', '1.0.0' );
define( 'UPLOADS_UNLEASHED_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'UPLOADS_UNLEASHED_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Include required files.
require_once UPLOADS_UNLEASHED_PLUGIN_DIR . 'includes/class-uploads-unleashed-tus-upload-session.php';
require_once UPLOADS_UNLEASHED_PLUGIN_DIR . 'includes/class-uploads-unleashed-tus-chunk-storage.php';
require_once UPLOADS_UNLEASHED_PLUGIN_DIR . 'includes/class-uploads-unleashed-tus-controller.php';

/**
 * Initializes the plugin.
 *
 * @since 0.1.0
 */
function uploads_unleashed_init() {
	// Schedule cleanup cron if not already scheduled.
	if ( ! wp_next_scheduled( 'uploads_unleashed_cleanup' ) ) {
		wp_schedule_event( time(), 'daily', 'uploads_unleashed_cleanup' );
	}
}
add_action( 'plugins_loaded', 'uploads_unleashed_init' );

/**
 * Registers the TUS uploader scripts.
 *
 * @since 0.1.0
 */
function uploads_unleashed_register_scripts() {
	// Register vendored tus-js-client library.
	wp_register_script( 'uploads-unleashed-tus', UPLOADS_UNLEASHED_PLUGIN_URL . 'build/tus.min.js', array(), '4.3.1', true );

	// Register core TUS library.
	$tus_client_asset = require UPLOADS_UNLEASHED_PLUGIN_DIR . 'build/tus-client.asset.php';

	wp_register_script(
		'uploads-unleashed',
		UPLOADS_UNLEASHED_PLUGIN_URL . 'build/tus-client.js',
		$tus_client_asset['dependencies'],
		$tus_client_asset['version'],
		true
	);
	wp_localize_script(
		'uploads-unleashed',
		'uploadsUnleashed',
		array(
			'endpoint' => rest_url( 'wp/v2/media' ),
			'nonce'    => wp_create_nonce( 'wp_rest' ),
		)
	);

	// Register and enqueue the pending uploads UI script.
	$ui_asset = require UPLOADS_UNLEASHED_PLUGIN_DIR . 'build/resume-ui.asset.php';
	wp_register_script(
		'uploads-unleashed-ui',
		UPLOADS_UNLEASHED_PLUGIN_URL . 'build/resume-ui.js',
		$ui_asset['dependencies'],
		$ui_asset['version'],
		true
	);

	wp_set_script_translations( 'uploads-unleashed-ui', 'uploads-unleashed' );

	wp_register_style(
		'uploads-unleashed-ui',
		UPLOADS_UNLEASHED_PLUGIN_URL . 'build/resume-ui.css',
		array(),
		$ui_asset['version']
	);

	// Register WordPress media uploader integration (plupload-based).
	$plupload_asset = require UPLOADS_UNLEASHED_PLUGIN_DIR . 'build/plupload.asset.php';

	wp_register_script(
		'uploads-unleashed-plupload',
		UPLOADS_UNLEASHED_PLUGIN_URL . 'build/plupload.js',
		array_merge( $plupload_asset['dependencies'], array( 'wp-plupload', 'plupload-handlers' ) ),
		$plupload_asset['version'],
		true
	);

	// Register block editor integration.
	$block_editor_asset = require UPLOADS_UNLEASHED_PLUGIN_DIR . 'build/block-editor.asset.php';

	wp_register_script(
		'uploads-unleashed-block-editor',
		UPLOADS_UNLEASHED_PLUGIN_URL . 'build/block-editor.js',
		$block_editor_asset['dependencies'],
		$block_editor_asset['version'],
		true
	);
}
add_action( 'init', 'uploads_unleashed_register_scripts' );

/**
 * Enqueues the TUS uploader script when media scripts are loaded.
 *
 * @since 0.1.0
 */
function uploads_unleashed_enqueue_scripts() {
	wp_enqueue_script( 'uploads-unleashed-plupload' );
}
add_action( 'wp_enqueue_media', 'uploads_unleashed_enqueue_scripts' );
add_action( 'admin_print_scripts-media-new.php', 'uploads_unleashed_enqueue_scripts' );

/**
 * Enqueues the pending uploads UI on media-new.php.
 *
 * @since 0.1.0
 */
function uploads_unleashed_enqueue_ui() {
	wp_enqueue_script( 'uploads-unleashed-ui' );
	wp_enqueue_style( 'uploads-unleashed-ui' );
}
add_action( 'admin_print_scripts-media-new.php', 'uploads_unleashed_enqueue_ui' );

/**
 * Enqueues the TUS integration for the block editor.
 *
 * @since 0.1.0
 */
function uploads_unleashed_enqueue_block_editor() {
	wp_enqueue_script( 'uploads-unleashed-block-editor' );
}
add_action( 'enqueue_block_editor_assets', 'uploads_unleashed_enqueue_block_editor' );

/**
 * Renders the pending uploads UI container.
 *
 * @since 0.1.0
 */
function uploads_unleashed_pending_ui() {
	?>
	<div id="uploads-unleashed-pending" class="uploads-unleashed-pending notice notice-alt notice-info inline" style="display: none;">
		<p class="uploads-unleashed-notice">
			<strong><?php esc_html_e( 'Pick up where you left off:', 'uploads-unleashed' ); ?></strong>
		</p>
		<ul class="uploads-unleashed-list"></ul>
	</div>
	<?php
}
add_action( 'post-plupload-upload-ui', 'uploads_unleashed_pending_ui' );

/**
 * Registers REST API routes.
 *
 * @since 0.1.0
 */
function uploads_unleashed_register_routes() {
	$controller = new Uploads_Unleashed_TUS_Controller();
	$controller->register_routes();
}
add_action( 'rest_api_init', 'uploads_unleashed_register_routes' );

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
function uploads_unleashed_add_options_headers( WP_REST_Response $response, WP_REST_Server $server, WP_REST_Request $request ): WP_REST_Response {
	if ( 'OPTIONS' !== $request->get_method() ) {
		return $response;
	}

	$route = $request->get_route();
	if ( 0 !== strpos( $route, '/wp/v2/media' ) ) {
		return $response;
	}

	$controller = new Uploads_Unleashed_TUS_Controller();
	return $controller->add_options_headers( $response, $request );
}
add_filter( 'rest_post_dispatch', 'uploads_unleashed_add_options_headers', 10, 3 );

/**
 * Adds TUS headers to the CORS allowed headers list.
 *
 * These are request headers that the server accepts from cross-origin clients.
 *
 * @since 1.0.0
 *
 * @param string[] $headers The list of allowed headers.
 * @return string[] Modified list with TUS headers.
 */
function uploads_unleashed_cors_allowed_headers( array $headers ): array {
	return array_merge(
		$headers,
		array(
			'Tus-Resumable',
			'Upload-Length',
			'Upload-Offset',
			'Upload-Metadata',
			'Upload-Checksum',
			'X-HTTP-Method-Override',
		)
	);
}
add_filter( 'rest_allowed_cors_headers', 'uploads_unleashed_cors_allowed_headers' );

/**
 * Exposes TUS headers in CORS responses.
 *
 * These are response headers that the browser allows JavaScript to read
 * in cross-origin contexts.
 *
 * @since 1.0.0
 *
 * @param string[] $headers The list of exposed headers.
 * @return string[] Modified list with TUS headers.
 */
function uploads_unleashed_cors_exposed_headers( array $headers ): array {
	return array_merge(
		$headers,
		array(
			'Tus-Resumable',
			'Upload-Offset',
			'Upload-Length',
			'Upload-Expires',
			'Tus-Version',
			'Tus-Extension',
			'Tus-Max-Size',
			'Location',
		)
	);
}
add_filter( 'rest_exposed_cors_headers', 'uploads_unleashed_cors_exposed_headers' );

/**
 * Intercepts TUS upload creation on the standard media endpoint.
 *
 * Detects POST requests to /wp/v2/media with an Upload-Length header
 * and routes them to the TUS controller for session creation.
 *
 * @since 1.0.0
 *
 * @param mixed           $result  Response to replace the requested version with. Can be anything
 *                                 a normal endpoint can return, or null to not hijack the request.
 * @param WP_REST_Server  $server  Server instance.
 * @param WP_REST_Request $request Request used to generate the response.
 * @return mixed|WP_REST_Response|WP_Error Original result, TUS response, or error.
 */
function uploads_unleashed_intercept_tus_creation( $result, $server, $request ) {
	if ( 'POST' !== $request->get_method() ) {
		return $result;
	}

	if ( '/wp/v2/media' !== $request->get_route() ) {
		return $result;
	}

	if ( null === $request->get_header( 'upload_length' ) ) {
		return $result;
	}

	$controller = new Uploads_Unleashed_TUS_Controller();

	$permission = $controller->create_item_permissions_check( $request );
	if ( is_wp_error( $permission ) ) {
		return $permission;
	}

	return $controller->create_item( $request );
}
add_filter( 'rest_pre_dispatch', 'uploads_unleashed_intercept_tus_creation', 10, 3 );

/**
 * Cleans up expired uploads.
 *
 * @since 0.1.0
 */
function uploads_unleashed_cleanup() {
	Uploads_Unleashed_TUS_Chunk_Storage::cleanup_expired();
}
add_action( 'uploads_unleashed_cleanup', 'uploads_unleashed_cleanup' );

/**
 * Filters the upload size limit to reflect actual available space.
 *
 * With TUS resumable uploads, PHP's upload_max_filesize is irrelevant
 * since uploads are chunked. The real limit is available disk space
 * (or quota on multisite), minus any in-progress uploads.
 *
 * @since 0.1.0
 *
 * @param int $size Upload size limit in bytes.
 * @return int Adjusted upload size limit in bytes.
 */
function uploads_unleashed_filter_upload_size_limit( int $size ): int {
	$pending_size = ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_total_pending_size();

	if ( is_multisite() ) {
		// On multisite, use quota-based available space.
		$available = get_upload_space_available();
	} else {
		// On single-site, use available disk space.
		$upload_dir = wp_upload_dir();
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- disk_free_space may be disabled on some hosts.
		$available = @disk_free_space( $upload_dir['basedir'] );

		if ( false === $available ) {
			// If we can't determine disk space, keep the original limit.
			return $size;
		}
	}

	return max( 0, (int) $available - $pending_size );
}
add_filter( 'upload_size_limit', 'uploads_unleashed_filter_upload_size_limit', 20 );

/**
 * Clears the scheduled cleanup event on plugin deactivation.
 *
 * @since 0.1.0
 */
function uploads_unleashed_deactivate() {
	$timestamp = wp_next_scheduled( 'uploads_unleashed_cleanup' );
	if ( $timestamp ) {
		wp_unschedule_event( $timestamp, 'uploads_unleashed_cleanup' );
	}
}
register_deactivation_hook( __FILE__, 'uploads_unleashed_deactivate' );

// Register WP-CLI command.
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	require_once UPLOADS_UNLEASHED_PLUGIN_DIR . 'includes/class-uploads-unleashed-cli-command.php';
	WP_CLI::add_command( 'tus', 'Uploads_Unleashed_CLI_Command' );
}

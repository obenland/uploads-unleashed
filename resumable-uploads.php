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

/**
 * Initializes the plugin.
 *
 * @since 0.1.0
 */
function resumable_uploads_init() {
	// Plugin initialization will go here.
}
add_action( 'plugins_loaded', 'resumable_uploads_init' );

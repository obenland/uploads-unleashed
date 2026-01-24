<?php
/**
 * Plugin initialization tests.
 *
 * @package resumable-uploads
 */

/**
 * Tests for the plugin initialization and base functions.
 */
class Test_Plugin_Init extends WP_UnitTestCase {

	/**
	 * Test that required constants are defined.
	 */
	public function test_constants_are_defined() {
		$this->assertTrue( defined( 'RESUMABLE_UPLOADS_VERSION' ) );
		$this->assertTrue( defined( 'RESUMABLE_UPLOADS_PLUGIN_DIR' ) );
		$this->assertTrue( defined( 'RESUMABLE_UPLOADS_PLUGIN_URL' ) );

		$this->assertSame( '0.2.0', RESUMABLE_UPLOADS_VERSION );
	}

	/**
	 * Test that plugin init hook is registered.
	 */
	public function test_init_hook_registered() {
		$this->assertSame( 10, has_action( 'plugins_loaded', 'resumable_uploads_init' ) );
	}

	/**
	 * Test that script registration hook is registered.
	 */
	public function test_register_scripts_hook_registered() {
		$this->assertSame( 10, has_action( 'init', 'resumable_uploads_register_scripts' ) );
	}

	/**
	 * Test that enqueue hooks are registered.
	 */
	public function test_enqueue_hooks_registered() {
		$this->assertSame( 10, has_action( 'wp_enqueue_media', 'resumable_uploads_enqueue_scripts' ) );
		$this->assertSame( 10, has_action( 'admin_print_scripts-media-new.php', 'resumable_uploads_enqueue_scripts' ) );
		$this->assertSame( 10, has_action( 'admin_print_scripts-media-new.php', 'resumable_uploads_enqueue_ui' ) );
		$this->assertSame( 10, has_action( 'enqueue_block_editor_assets', 'resumable_uploads_enqueue_block_editor' ) );
	}

	/**
	 * Test that REST routes hook is registered.
	 */
	public function test_rest_routes_hook_registered() {
		$this->assertSame( 10, has_action( 'rest_api_init', 'resumable_uploads_register_routes' ) );
	}

	/**
	 * Test that OPTIONS headers filter is registered.
	 */
	public function test_options_headers_filter_registered() {
		$this->assertSame( 10, has_filter( 'rest_post_dispatch', 'resumable_uploads_add_options_headers' ) );
	}

	/**
	 * Test that cleanup action is registered.
	 */
	public function test_cleanup_action_registered() {
		$this->assertSame( 10, has_action( 'resumable_uploads_cleanup', 'resumable_uploads_cleanup' ) );
	}

	/**
	 * Test that upload size limit filter is registered.
	 */
	public function test_upload_size_limit_filter_registered() {
		$this->assertSame( 20, has_filter( 'upload_size_limit', 'resumable_uploads_filter_upload_size_limit' ) );
	}

	/**
	 * Test that pending UI hook is registered.
	 */
	public function test_pending_ui_hook_registered() {
		$this->assertSame( 10, has_action( 'post-plupload-upload-ui', 'resumable_uploads_pending_ui' ) );
	}

	/**
	 * Test that cron is scheduled after init.
	 */
	public function test_cron_scheduled_on_init() {
		// Clear any existing scheduled event.
		$timestamp = wp_next_scheduled( 'resumable_uploads_cleanup' );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, 'resumable_uploads_cleanup' );
		}

		// Call init.
		resumable_uploads_init();

		// Verify cron is scheduled.
		$this->assertNotFalse( wp_next_scheduled( 'resumable_uploads_cleanup' ) );
	}

	/**
	 * Test that init does not reschedule if already scheduled.
	 */
	public function test_cron_not_rescheduled() {
		// Clear any existing scheduled event first.
		$existing_timestamp = wp_next_scheduled( 'resumable_uploads_cleanup' );
		if ( $existing_timestamp ) {
			wp_unschedule_event( $existing_timestamp, 'resumable_uploads_cleanup' );
		}

		// Schedule the event at a specific future time.
		$first_timestamp = time() + HOUR_IN_SECONDS;
		wp_schedule_event( $first_timestamp, 'daily', 'resumable_uploads_cleanup' );

		// Call init again.
		resumable_uploads_init();

		// Verify timestamp hasn't changed.
		$this->assertSame( $first_timestamp, wp_next_scheduled( 'resumable_uploads_cleanup' ) );

		// Cleanup.
		wp_unschedule_event( $first_timestamp, 'resumable_uploads_cleanup' );
	}

	/**
	 * Test that deactivation clears cron.
	 */
	public function test_deactivation_clears_cron() {
		// Clear any existing scheduled events first.
		$existing_timestamp = wp_next_scheduled( 'resumable_uploads_cleanup' );
		if ( $existing_timestamp ) {
			wp_unschedule_event( $existing_timestamp, 'resumable_uploads_cleanup' );
		}

		// Schedule the event.
		$timestamp = time() + HOUR_IN_SECONDS;
		wp_schedule_event( $timestamp, 'daily', 'resumable_uploads_cleanup' );

		// Verify it's scheduled.
		$this->assertNotFalse( wp_next_scheduled( 'resumable_uploads_cleanup' ) );

		// Deactivate.
		resumable_uploads_deactivate();

		// Verify cron is cleared.
		$this->assertFalse( wp_next_scheduled( 'resumable_uploads_cleanup' ) );
	}

	/**
	 * Test that deactivation handles no scheduled event gracefully.
	 */
	public function test_deactivation_handles_no_scheduled_event() {
		// Clear any existing scheduled event.
		$timestamp = wp_next_scheduled( 'resumable_uploads_cleanup' );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, 'resumable_uploads_cleanup' );
		}

		// Deactivate should not throw error.
		resumable_uploads_deactivate();

		$this->assertFalse( wp_next_scheduled( 'resumable_uploads_cleanup' ) );
	}

	/**
	 * Test that pending UI outputs correct HTML structure.
	 */
	public function test_pending_ui_output() {
		ob_start();
		resumable_uploads_pending_ui();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'id="resumable-uploads-pending"', $output );
		$this->assertStringContainsString( 'class="resumable-uploads-pending', $output );
		$this->assertStringContainsString( 'notice notice-alt notice-info', $output );
		$this->assertStringContainsString( 'resumable-uploads-notice', $output );
		$this->assertStringContainsString( 'resumable-uploads-list', $output );
		$this->assertStringContainsString( 'display: none', $output );
	}

	/**
	 * Test cleanup function calls storage cleanup.
	 */
	public function test_cleanup_function() {
		// Create an expired upload session.
		$upload_id    = wp_generate_uuid4();
		$session_data = array(
			'upload_id'  => $upload_id,
			'user_id'    => 1,
			'filename'   => 'test.txt',
			'filetype'   => 'text/plain',
			'length'     => 1024,
			'offset'     => 0,
			'created_at' => time() - DAY_IN_SECONDS * 2,
			'expires_at' => time() - DAY_IN_SECONDS,
		);
		set_transient( 'tus_upload_' . $upload_id, $session_data, DAY_IN_SECONDS );

		// Create the chunk file.
		$storage = new TUS_Chunk_Storage();
		$storage->append( $upload_id, 'test data', 0 );

		$this->assertTrue( $storage->exists( $upload_id ) );

		// Run cleanup.
		resumable_uploads_cleanup();

		// Verify chunk is deleted.
		$this->assertFalse( $storage->exists( $upload_id ) );
	}

	/**
	 * Test OPTIONS headers filter ignores non-OPTIONS requests.
	 */
	public function test_options_headers_ignores_non_options() {
		$request  = new WP_REST_Request( 'GET', '/wp/v2/media/tus' );
		$response = new WP_REST_Response();

		$result = resumable_uploads_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayNotHasKey( 'Tus-Resumable', $headers );
	}

	/**
	 * Test OPTIONS headers filter ignores non-TUS routes.
	 */
	public function test_options_headers_ignores_non_tus_routes() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/posts' );
		$response = new WP_REST_Response();

		$result = resumable_uploads_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayNotHasKey( 'Tus-Resumable', $headers );
	}

	/**
	 * Test OPTIONS headers filter adds TUS headers for TUS route.
	 */
	public function test_options_headers_adds_tus_headers() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media/tus' );
		$response = new WP_REST_Response();

		$result = resumable_uploads_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayHasKey( 'Tus-Resumable', $headers );
		$this->assertArrayHasKey( 'Tus-Version', $headers );
		$this->assertArrayHasKey( 'Tus-Extension', $headers );
		$this->assertArrayHasKey( 'Tus-Max-Size', $headers );
	}

	/**
	 * Test OPTIONS headers filter works for upload-specific routes.
	 */
	public function test_options_headers_works_for_upload_routes() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media/tus/abc-123' );
		$response = new WP_REST_Response();

		$result = resumable_uploads_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayHasKey( 'Tus-Resumable', $headers );
	}

	/**
	 * Test that REST routes are registered.
	 */
	public function test_routes_are_registered() {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/wp/v2/media/tus', $routes );
		$this->assertArrayHasKey( '/wp/v2/media/tus/(?P<id>[a-zA-Z0-9-]+)', $routes );
	}

	/**
	 * Clean up after all tests in the class.
	 */
	public static function tear_down_after_class() {
		// Clean up any scheduled events.
		$timestamp = wp_next_scheduled( 'resumable_uploads_cleanup' );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, 'resumable_uploads_cleanup' );
		}

		// Clean up storage directory.
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';

		if ( is_dir( $chunks_dir ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation in tests.
			@unlink( trailingslashit( $chunks_dir ) . '.htaccess' );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation in tests.
			@unlink( trailingslashit( $chunks_dir ) . 'index.php' );

			$files = glob( trailingslashit( $chunks_dir ) . '*.part' );
			if ( $files ) {
				// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- Direct file operation in tests.
				array_map( 'unlink', $files );
			}

			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation in tests.
			@rmdir( $chunks_dir );
		}

		parent::tear_down_after_class();
	}
}

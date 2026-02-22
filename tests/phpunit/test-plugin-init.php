<?php
/**
 * Plugin initialization tests.
 *
 * @package uploads-unleashed
 */

/**
 * Tests for the plugin initialization and base functions.
 */
class Test_Plugin_Init extends WP_UnitTestCase {

	/**
	 * Clean up after all tests in the class.
	 */
	public static function tear_down_after_class() {
		// Clean up any scheduled events for this hook.
		wp_clear_scheduled_hook( 'uploads_unleashed_cleanup' );

		parent::tear_down_after_class();
	}

	/**
	 * Test that required constants are defined.
	 */
	public function test_constants_are_defined() {
		$this->assertTrue( defined( 'UPLOADS_UNLEASHED_VERSION' ) );
		$this->assertTrue( defined( 'UPLOADS_UNLEASHED_PLUGIN_DIR' ) );
		$this->assertTrue( defined( 'UPLOADS_UNLEASHED_PLUGIN_URL' ) );

		$this->assertSame( '0.1.0', UPLOADS_UNLEASHED_VERSION );
	}

	/**
	 * Test that plugin init hook is registered.
	 */
	public function test_init_hook_registered() {
		$this->assertSame( 10, has_action( 'plugins_loaded', 'uploads_unleashed_init' ) );
	}

	/**
	 * Test that script registration hook is registered.
	 */
	public function test_register_scripts_hook_registered() {
		$this->assertSame( 10, has_action( 'init', 'uploads_unleashed_register_scripts' ) );
	}

	/**
	 * Test that enqueue hooks are registered.
	 */
	public function test_enqueue_hooks_registered() {
		$this->assertSame( 10, has_action( 'wp_enqueue_media', 'uploads_unleashed_enqueue_scripts' ) );
		$this->assertSame( 10, has_action( 'admin_print_scripts-media-new.php', 'uploads_unleashed_enqueue_scripts' ) );
		$this->assertSame( 10, has_action( 'admin_print_scripts-media-new.php', 'uploads_unleashed_enqueue_ui' ) );
		$this->assertSame( 10, has_action( 'enqueue_block_editor_assets', 'uploads_unleashed_enqueue_block_editor' ) );
	}

	/**
	 * Test that REST routes hook is registered.
	 */
	public function test_rest_routes_hook_registered() {
		$this->assertSame( 10, has_action( 'rest_api_init', 'uploads_unleashed_register_routes' ) );
	}

	/**
	 * Test that OPTIONS headers filter is registered.
	 */
	public function test_options_headers_filter_registered() {
		$this->assertSame( 10, has_filter( 'rest_post_dispatch', 'uploads_unleashed_add_options_headers' ) );
	}

	/**
	 * Test that CORS allowed headers filter is registered.
	 */
	public function test_cors_allowed_headers_filter_registered() {
		$this->assertSame( 10, has_filter( 'rest_allowed_cors_headers', 'uploads_unleashed_cors_allowed_headers' ) );
	}

	/**
	 * Test that CORS exposed headers filter is registered.
	 */
	public function test_cors_exposed_headers_filter_registered() {
		$this->assertSame( 10, has_filter( 'rest_exposed_cors_headers', 'uploads_unleashed_cors_exposed_headers' ) );
	}

	/**
	 * Test that CORS allowed headers include TUS headers.
	 */
	public function test_cors_allowed_headers_includes_tus_headers() {
		$headers = uploads_unleashed_cors_allowed_headers( array() );

		$this->assertContains( 'Tus-Resumable', $headers );
		$this->assertContains( 'Upload-Length', $headers );
		$this->assertContains( 'Upload-Offset', $headers );
		$this->assertContains( 'Upload-Metadata', $headers );
		$this->assertContains( 'Upload-Checksum', $headers );
		$this->assertContains( 'X-HTTP-Method-Override', $headers );
	}

	/**
	 * Test that CORS exposed headers include TUS headers.
	 */
	public function test_cors_exposed_headers_includes_tus_headers() {
		$headers = uploads_unleashed_cors_exposed_headers( array() );

		$this->assertContains( 'Tus-Resumable', $headers );
		$this->assertContains( 'Upload-Offset', $headers );
		$this->assertContains( 'Upload-Length', $headers );
		$this->assertContains( 'Upload-Expires', $headers );
		$this->assertContains( 'Location', $headers );
	}

	/**
	 * Test that CORS allowed headers preserves existing headers.
	 */
	public function test_cors_allowed_headers_preserves_existing() {
		$headers = uploads_unleashed_cors_allowed_headers( array( 'Authorization' ) );

		$this->assertContains( 'Authorization', $headers );
		$this->assertContains( 'Tus-Resumable', $headers );
	}

	/**
	 * Test that CORS exposed headers preserves existing headers.
	 */
	public function test_cors_exposed_headers_preserves_existing() {
		$headers = uploads_unleashed_cors_exposed_headers( array( 'X-WP-Total' ) );

		$this->assertContains( 'X-WP-Total', $headers );
		$this->assertContains( 'Tus-Resumable', $headers );
	}

	/**
	 * Test that cleanup action is registered.
	 */
	public function test_cleanup_action_registered() {
		$this->assertSame( 10, has_action( 'uploads_unleashed_cleanup', 'uploads_unleashed_cleanup' ) );
	}

	/**
	 * Test that upload size limit filter is registered.
	 */
	public function test_upload_size_limit_filter_registered() {
		$this->assertSame( 20, has_filter( 'upload_size_limit', 'uploads_unleashed_filter_upload_size_limit' ) );
	}

	/**
	 * Test that pending UI hook is registered.
	 */
	public function test_pending_ui_hook_registered() {
		$this->assertSame( 10, has_action( 'post-plupload-upload-ui', 'uploads_unleashed_pending_ui' ) );
	}

	/**
	 * Test that cron is scheduled after init.
	 */
	public function test_cron_scheduled_on_init() {
		// Clear any existing scheduled event.
		$timestamp = wp_next_scheduled( 'uploads_unleashed_cleanup' );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, 'uploads_unleashed_cleanup' );
		}

		// Call init.
		uploads_unleashed_init();

		// Verify cron is scheduled.
		$this->assertNotFalse( wp_next_scheduled( 'uploads_unleashed_cleanup' ) );
	}

	/**
	 * Test that init does not reschedule if already scheduled.
	 */
	public function test_cron_not_rescheduled() {
		// Clear any existing scheduled event first.
		$existing_timestamp = wp_next_scheduled( 'uploads_unleashed_cleanup' );
		if ( $existing_timestamp ) {
			wp_unschedule_event( $existing_timestamp, 'uploads_unleashed_cleanup' );
		}

		// Schedule the event at a specific future time.
		$first_timestamp = time() + HOUR_IN_SECONDS;
		wp_schedule_event( $first_timestamp, 'daily', 'uploads_unleashed_cleanup' );

		// Call init again.
		uploads_unleashed_init();

		// Verify timestamp hasn't changed.
		$this->assertSame( $first_timestamp, wp_next_scheduled( 'uploads_unleashed_cleanup' ) );

		// Cleanup.
		wp_unschedule_event( $first_timestamp, 'uploads_unleashed_cleanup' );
	}

	/**
	 * Test that deactivation clears cron.
	 */
	public function test_deactivation_clears_cron() {
		// Clear any existing scheduled events first.
		$existing_timestamp = wp_next_scheduled( 'uploads_unleashed_cleanup' );
		if ( $existing_timestamp ) {
			wp_unschedule_event( $existing_timestamp, 'uploads_unleashed_cleanup' );
		}

		// Schedule the event.
		$timestamp = time() + HOUR_IN_SECONDS;
		wp_schedule_event( $timestamp, 'daily', 'uploads_unleashed_cleanup' );

		// Verify it's scheduled.
		$this->assertNotFalse( wp_next_scheduled( 'uploads_unleashed_cleanup' ) );

		// Deactivate.
		uploads_unleashed_deactivate();

		// Verify cron is cleared.
		$this->assertFalse( wp_next_scheduled( 'uploads_unleashed_cleanup' ) );
	}

	/**
	 * Test that deactivation handles no scheduled event gracefully.
	 */
	public function test_deactivation_handles_no_scheduled_event() {
		// Clear any existing scheduled event.
		$timestamp = wp_next_scheduled( 'uploads_unleashed_cleanup' );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, 'uploads_unleashed_cleanup' );
		}

		// Deactivate should not throw error.
		uploads_unleashed_deactivate();

		$this->assertFalse( wp_next_scheduled( 'uploads_unleashed_cleanup' ) );
	}

	/**
	 * Test that pending UI outputs correct HTML structure.
	 */
	public function test_pending_ui_output() {
		ob_start();
		uploads_unleashed_pending_ui();
		$output = ob_get_clean();

		$this->assertStringContainsString( 'id="uploads-unleashed-pending"', $output );
		$this->assertStringContainsString( 'class="uploads-unleashed-pending', $output );
		$this->assertStringContainsString( 'notice notice-alt notice-info', $output );
		$this->assertStringContainsString( 'uploads-unleashed-notice', $output );
		$this->assertStringContainsString( 'uploads-unleashed-list', $output );
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
		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();
		$storage->append( $upload_id, 'test data', 0 );

		$this->assertTrue( $storage->exists( $upload_id ) );

		// Run cleanup.
		uploads_unleashed_cleanup();

		// Verify chunk is deleted.
		$this->assertFalse( $storage->exists( $upload_id ) );
	}

	/**
	 * Test OPTIONS headers filter ignores non-OPTIONS requests.
	 */
	public function test_options_headers_ignores_non_options() {
		$request  = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$response = new WP_REST_Response();

		$result = uploads_unleashed_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayNotHasKey( 'Tus-Resumable', $headers );
	}

	/**
	 * Test OPTIONS headers filter ignores non-TUS routes.
	 */
	public function test_options_headers_ignores_non_tus_routes() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/posts' );
		$response = new WP_REST_Response();

		$result = uploads_unleashed_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayNotHasKey( 'Tus-Resumable', $headers );
	}

	/**
	 * Test OPTIONS headers filter adds TUS headers for TUS route.
	 */
	public function test_options_headers_adds_tus_headers() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media' );
		$response = new WP_REST_Response();

		$result = uploads_unleashed_add_options_headers( $response, rest_get_server(), $request );

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
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media/00000000-0000-4000-8000-000000000000' );
		$response = new WP_REST_Response();

		$result = uploads_unleashed_add_options_headers( $response, rest_get_server(), $request );

		$headers = $result->get_headers();
		$this->assertArrayHasKey( 'Tus-Resumable', $headers );
	}

	/**
	 * Test that REST routes are registered.
	 */
	public function test_routes_are_registered() {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/wp/v2/media/(?P<id>[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', $routes );
	}

	/**
	 * Test that scripts are registered after register_scripts runs.
	 */
	public function test_register_scripts_registers_all_scripts() {
		// Scripts are registered during init, so they should already exist.
		$this->assertTrue( wp_script_is( 'uploads-unleashed-tus', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed-ui', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed-plupload', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed-block-editor', 'registered' ) );
	}

	/**
	 * Test that style is registered after register_scripts runs.
	 */
	public function test_register_scripts_registers_style() {
		$this->assertTrue( wp_style_is( 'uploads-unleashed-ui', 'registered' ) );
	}

	/**
	 * Test that enqueue_scripts enqueues plupload script.
	 */
	public function test_enqueue_scripts_enqueues_plupload() {
		uploads_unleashed_enqueue_scripts();

		$this->assertTrue( wp_script_is( 'uploads-unleashed-plupload', 'enqueued' ) );
	}

	/**
	 * Test that enqueue_ui enqueues script and style.
	 */
	public function test_enqueue_ui_enqueues_script_and_style() {
		uploads_unleashed_enqueue_ui();

		$this->assertTrue( wp_script_is( 'uploads-unleashed-ui', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'uploads-unleashed-ui', 'enqueued' ) );
	}

	/**
	 * Test that enqueue_block_editor enqueues block editor script.
	 */
	public function test_enqueue_block_editor_enqueues_script() {
		uploads_unleashed_enqueue_block_editor();

		$this->assertTrue( wp_script_is( 'uploads-unleashed-block-editor', 'enqueued' ) );
	}

	/**
	 * Test that intercept_tus_creation ignores non-POST methods.
	 */
	public function test_intercept_tus_creation_ignores_non_post() {
		$request = new WP_REST_Request( 'GET', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', KB_IN_BYTES );

		$result = uploads_unleashed_intercept_tus_creation( null, rest_get_server(), $request );

		$this->assertNull( $result );
	}

	/**
	 * Test that intercept_tus_creation ignores non-media routes.
	 */
	public function test_intercept_tus_creation_ignores_non_media_route() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/posts' );
		$request->set_header( 'Upload-Length', KB_IN_BYTES );

		$result = uploads_unleashed_intercept_tus_creation( null, rest_get_server(), $request );

		$this->assertNull( $result );
	}

	/**
	 * Test that intercept_tus_creation ignores requests without Upload-Length.
	 */
	public function test_intercept_tus_creation_ignores_missing_upload_length() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );

		$result = uploads_unleashed_intercept_tus_creation( null, rest_get_server(), $request );

		$this->assertNull( $result );
	}

	/**
	 * Test that intercept_tus_creation returns error for unauthenticated user.
	 */
	public function test_intercept_tus_creation_requires_auth() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', KB_IN_BYTES );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64 encoding.

		$result = uploads_unleashed_intercept_tus_creation( null, rest_get_server(), $request );

		$this->assertWPError( $result );
		$this->assertSame( 'rest_cannot_create_upload', $result->get_error_code() );
	}

	/**
	 * Test that intercept_tus_creation creates upload for authenticated user.
	 */
	public function test_intercept_tus_creation_creates_upload() {
		$admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin_id );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', KB_IN_BYTES );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64 encoding.

		$result = uploads_unleashed_intercept_tus_creation( null, rest_get_server(), $request );

		$this->assertInstanceOf( WP_REST_Response::class, $result );
		$this->assertSame( 201, $result->get_status() );
	}

	/**
	 * Test that upload_size_limit filter returns adjusted size.
	 */
	public function test_upload_size_limit_filter_returns_adjusted_size() {
		$adjusted = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		// Should return something based on disk space, which is always less than PHP_INT_MAX.
		$this->assertIsInt( $adjusted );
		$this->assertGreaterThanOrEqual( 0, $adjusted );
	}

	/**
	 * Test that intercept filter is registered.
	 */
	public function test_intercept_filter_registered() {
		$this->assertSame( 10, has_filter( 'rest_pre_dispatch', 'uploads_unleashed_intercept_tus_creation' ) );
	}

	/**
	 * Test that register_scripts function body is executed and scripts are registered.
	 *
	 * The function runs during `init` before PHPUnit coverage starts,
	 * so we deregister everything and call it again under coverage.
	 */
	public function test_register_scripts_function_body_is_covered() {
		// Deregister all scripts and styles registered by the plugin.
		wp_deregister_script( 'uploads-unleashed-tus' );
		wp_deregister_script( 'uploads-unleashed' );
		wp_deregister_script( 'uploads-unleashed-ui' );
		wp_deregister_script( 'uploads-unleashed-plupload' );
		wp_deregister_script( 'uploads-unleashed-block-editor' );
		wp_deregister_style( 'uploads-unleashed-ui' );

		// Verify they are deregistered.
		$this->assertFalse( wp_script_is( 'uploads-unleashed-tus', 'registered' ) );
		$this->assertFalse( wp_script_is( 'uploads-unleashed', 'registered' ) );
		$this->assertFalse( wp_script_is( 'uploads-unleashed-ui', 'registered' ) );
		$this->assertFalse( wp_script_is( 'uploads-unleashed-plupload', 'registered' ) );
		$this->assertFalse( wp_script_is( 'uploads-unleashed-block-editor', 'registered' ) );
		$this->assertFalse( wp_style_is( 'uploads-unleashed-ui', 'registered' ) );

		// Call the function directly to get coverage of lines 52-112.
		uploads_unleashed_register_scripts();

		// Verify all scripts are re-registered.
		$this->assertTrue( wp_script_is( 'uploads-unleashed-tus', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed-ui', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed-plupload', 'registered' ) );
		$this->assertTrue( wp_script_is( 'uploads-unleashed-block-editor', 'registered' ) );
		$this->assertTrue( wp_style_is( 'uploads-unleashed-ui', 'registered' ) );
	}

	/**
	 * Test upload_size_limit filter returns original size when disk_free_space fails.
	 *
	 * When disk_free_space() returns false (disabled function or inaccessible path),
	 * the filter should return the original $size value unchanged.
	 */
	public function test_upload_size_limit_returns_original_when_disk_free_space_fails() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Single-site only test.' );
		}

		// Point the upload directory to a non-existent path where disk_free_space returns false.
		$filter_callback = function ( $uploads ) {
			$uploads['basedir'] = '/non/existent/path/that/does/not/exist';
			return $uploads;
		};
		add_filter( 'upload_dir', $filter_callback );

		$original_size = 12345678;
		$result        = uploads_unleashed_filter_upload_size_limit( $original_size );

		remove_filter( 'upload_dir', $filter_callback );

		// When disk_free_space returns false, the function should return the original $size.
		$this->assertSame( $original_size, $result );
	}
}

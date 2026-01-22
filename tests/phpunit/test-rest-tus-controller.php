<?php
/**
 * REST TUS Controller tests.
 *
 * @package resumable-uploads
 */

// phpcs:disable WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64 encoding.

/**
 * Tests for the REST_TUS_Controller class.
 */
class Test_REST_TUS_Controller extends WP_Test_REST_Controller_Testcase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Subscriber user ID.
	 *
	 * @var int
	 */
	protected static int $subscriber_id;

	/**
	 * Set up class fixtures.
	 */
	public static function set_up_before_class() {
		parent::set_up_before_class();

		$factory        = self::factory();
		self::$admin_id = $factory->user->create(
			array(
				'role' => 'administrator',
			)
		);

		self::$subscriber_id = $factory->user->create(
			array(
				'role' => 'subscriber',
			)
		);
	}

	/**
	 * Set up each test.
	 */
	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * Clean up after each test.
	 */
	public function tear_down() {
		// Clean up .part files created during this test.
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';
		$files      = glob( trailingslashit( $chunks_dir ) . '*.part' );

		if ( $files ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- Direct file operation in tests.
			array_map( 'unlink', $files );
		}

		parent::tear_down();
	}

	/**
	 * Clean up after all tests in the class.
	 */
	public static function tear_down_after_class() {
		// Remove the TUS chunk storage directory and its protection files.
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';

		if ( is_dir( $chunks_dir ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- Direct file operation in tests.
			unlink( trailingslashit( $chunks_dir ) . '.htaccess' );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- Direct file operation in tests.
			unlink( trailingslashit( $chunks_dir ) . 'index.php' );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- Direct file operation in tests.
			rmdir( $chunks_dir );
		}

		parent::tear_down_after_class();
	}

	/**
	 * Test route registration.
	 */
	public function test_register_routes() {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/wp/v2/media/tus', $routes );
		$this->assertArrayHasKey( '/wp/v2/media/tus/(?P<id>[a-zA-Z0-9-]+)', $routes );
	}

	/**
	 * Test OPTIONS request returns TUS headers.
	 */
	public function test_options_returns_tus_headers() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media/tus' );
		$response = rest_get_server()->dispatch( $request );

		// The rest_post_dispatch filter isn't applied in test environment,
		// so we manually apply it to test the filter function.
		$response = resumable_uploads_add_options_headers( $response, rest_get_server(), $request );
		$headers  = $response->get_headers();

		$this->assertSame( '1.0.0', $headers['Tus-Resumable'] );
		$this->assertSame( '1.0.0', $headers['Tus-Version'] );
		$this->assertSame( 'creation,expiration,termination', $headers['Tus-Extension'] );
		$this->assertArrayHasKey( 'Tus-Max-Size', $headers );
	}

	/**
	 * Test create upload requires authentication.
	 */
	public function test_create_upload_requires_auth() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_cannot_create_upload', $response, 401 );
	}

	/**
	 * Test create upload requires upload_files capability.
	 */
	public function test_create_upload_requires_capability() {
		wp_set_current_user( self::$subscriber_id );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_cannot_create_upload', $response, 403 );
	}

	/**
	 * Test create upload requires Upload-Length header.
	 */
	public function test_create_upload_requires_length() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_upload_length_required', $response, 400 );
	}

	/**
	 * Test HEAD request returns correct offset.
	 */
	public function test_head_returns_offset() {
		// Create an upload first.
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );
		$headers  = $response->get_headers();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '0', (string) $headers['Upload-Offset'] );
		$this->assertSame( '1024', (string) $headers['Upload-Length'] );
		$this->assertSame( 'no-store', $headers['Cache-Control'] );
	}

	/**
	 * Test HEAD request for non-existent upload returns 404.
	 */
	public function test_head_not_found() {
		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/tus/nonexistent-id' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_upload_not_found', $response, 404 );
	}

	/**
	 * Test PATCH requires correct Content-Type.
	 */
	public function test_patch_requires_content_type() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		// Use text/plain instead of application/json to avoid WordPress JSON parsing.
		$request->set_header( 'Content-Type', 'text/plain' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 415, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_invalid_content_type', $data['code'] );
	}

	/**
	 * Test PATCH requires Upload-Offset header.
	 */
	public function test_patch_requires_offset() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_offset_required', $response, 400 );
	}

	/**
	 * Test PATCH returns 409 on offset mismatch.
	 */
	public function test_patch_offset_mismatch() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '100' ); // Wrong offset, should be 0.
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_offset_mismatch', $response, 409 );
	}

	/**
	 * Test PATCH uploads chunk successfully.
	 */
	public function test_patch_uploads_chunk() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$chunk_data = str_repeat( 'a', 512 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$headers = $response->get_headers();
		$this->assertArrayHasKey( 'Upload-Offset', $headers );
		$this->assertSame( '512', (string) $headers['Upload-Offset'] );

		// Verify session was updated.
		$upload = $session->get( $upload_id );
		$this->assertSame( 512, (int) $upload['offset'] );
	}

	/**
	 * Test user cannot access another user's upload.
	 */
	public function test_user_cannot_access_others_upload() {
		// Create upload as admin.
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		// Try to access as another admin.
		$other_admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $other_admin );

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_cannot_view_upload', $response, 403 );
	}

	/**
	 * Test complete upload creates attachment.
	 */
	public function test_complete_upload_creates_attachment() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 9,
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		// Complete uploads return 200 with attachment data.
		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertArrayHasKey( 'id', $data );

		$attachment = get_post( $data['id'] );

		$this->assertSame( 'attachment', $attachment->post_type );
		$this->assertSame( 'text/plain', $attachment->post_mime_type );

		// Cleanup.
		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test context parameter for schema.
	 *
	 * @doesNotPerformAssertions
	 */
	public function test_context_param() {
		// Controller does not use context parameter.
	}

	/**
	 * Test getting item.
	 *
	 * @doesNotPerformAssertions
	 */
	public function test_get_item() {
		// Controller does not implement get_item().
	}

	/**
	 * Test getting items.
	 *
	 * @doesNotPerformAssertions
	 */
	public function test_get_items() {
		// Controller does not implement get_items().
	}

	/**
	 * Test updating item.
	 *
	 * @doesNotPerformAssertions
	 */
	public function test_update_item() {
		// Controller does not implement update_item().
	}

	/**
	 * Test getting item schema.
	 */
	public function test_get_item_schema() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media/tus' );
		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		$this->assertArrayHasKey( 'schema', $data );
		$this->assertSame( 'tus-upload', $data['schema']['title'] );
	}

	/**
	 * Test creating item.
	 */
	public function test_create_item() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) . ',filetype ' . base64_encode( 'text/plain' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );
		$this->assertStringContainsString( '/wp/v2/media/tus/', $response->get_headers()['Location'] );
		$this->assertSame( '1.0.0', $response->get_headers()['Tus-Resumable'] );
		$this->assertArrayHasKey( 'Upload-Expires', $response->get_headers() );
	}

	/**
	 * Test deleting item.
	 */
	public function test_delete_item() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$this->assertNull( $session->get( $upload_id ) );
	}

	/**
	 * Test preparing item for response.
	 *
	 * @doesNotPerformAssertions
	 */
	public function test_prepare_item() {
		// Controller does not implement prepare_item().
	}

	/**
	 * Test POST with X-HTTP-Method-Override: HEAD returns offset.
	 */
	public function test_method_override_head() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'HEAD' );

		$response = rest_get_server()->dispatch( $request );
		$headers  = $response->get_headers();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '0', (string) $headers['Upload-Offset'] );
		$this->assertSame( '1024', (string) $headers['Upload-Length'] );
	}

	/**
	 * Test POST with X-HTTP-Method-Override: PATCH uploads chunk.
	 */
	public function test_method_override_patch() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$chunk_data = str_repeat( 'a', 512 );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'PATCH' );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$headers = $response->get_headers();
		$this->assertSame( '512', (string) $headers['Upload-Offset'] );
	}

	/**
	 * Test POST with X-HTTP-Method-Override: DELETE deletes upload.
	 */
	public function test_method_override_delete() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'DELETE' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$this->assertNull( $session->get( $upload_id ) );
	}

	/**
	 * Test POST without X-HTTP-Method-Override returns error.
	 */
	public function test_method_override_required() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request  = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_method_override_required', $data['code'] );
	}

	/**
	 * Test POST with invalid X-HTTP-Method-Override returns error.
	 */
	public function test_method_override_invalid() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'PUT' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_invalid_method_override', $data['code'] );
	}

	/**
	 * Test X-HTTP-Method-Override is case-insensitive.
	 */
	public function test_method_override_case_insensitive() {
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			)
		);

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'head' ); // lowercase

		$response = rest_get_server()->dispatch( $request );
		$headers  = $response->get_headers();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '0', (string) $headers['Upload-Offset'] );
	}
}

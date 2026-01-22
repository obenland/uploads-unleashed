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
	 * Helper method to create an upload session with a mock request.
	 *
	 * @param array $data Optional. Upload data (filename, filetype, length).
	 * @return string The upload ID.
	 */
	protected function create_upload_session( array $data = array() ): string {
		$data = array_merge(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$data
		);

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', (string) $data['length'] );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( $data['filename'] ) );

		return ( new TUS_Upload_Session() )->create( $data, $request );
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
		$this->assertSame( 'creation,expiration,termination,checksum', $headers['Tus-Extension'] );
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
		$upload_id = $this->create_upload_session();

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
		$upload_id = $this->create_upload_session();

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
		$upload_id = $this->create_upload_session();

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
		$upload_id = $this->create_upload_session();

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
		$upload_id  = $this->create_upload_session();
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
		$upload = ( new TUS_Upload_Session() )->get( $upload_id );
		$this->assertSame( 512, (int) $upload['offset'] );
	}

	/**
	 * Test user cannot access another user's upload.
	 */
	public function test_user_cannot_access_others_upload() {
		// Create upload as admin.
		$upload_id = $this->create_upload_session();

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
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

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
	 * Test complete upload returns REST API format.
	 *
	 * Verifies the response matches WP_REST_Attachments_Controller format,
	 * not wp_prepare_attachment_for_js() format.
	 */
	public function test_complete_upload_returns_rest_api_format() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		// REST API format uses snake_case keys.
		$this->assertArrayHasKey( 'source_url', $data );
		$this->assertArrayHasKey( 'alt_text', $data );
		$this->assertArrayHasKey( 'mime_type', $data );
		$this->assertArrayHasKey( 'media_type', $data );
		$this->assertArrayHasKey( 'media_details', $data );

		// REST API format has nested title/caption objects.
		$this->assertIsArray( $data['title'] );
		$this->assertArrayHasKey( 'raw', $data['title'] );
		$this->assertArrayHasKey( 'rendered', $data['title'] );

		$this->assertIsArray( $data['caption'] );
		$this->assertArrayHasKey( 'raw', $data['caption'] );
		$this->assertArrayHasKey( 'rendered', $data['caption'] );

		// Should NOT have wp_prepare_attachment_for_js() format keys.
		$this->assertArrayNotHasKey( 'url', $data );
		$this->assertArrayNotHasKey( 'alt', $data );
		$this->assertArrayNotHasKey( 'mime', $data );
		$this->assertArrayNotHasKey( 'filename', $data );
		$this->assertArrayNotHasKey( 'filesizeInBytes', $data );

		// Verify correct values.
		$this->assertSame( 'text/plain', $data['mime_type'] );
		$this->assertSame( 'file', $data['media_type'] );

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
		$upload_id = $this->create_upload_session();

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$this->assertNull( ( new TUS_Upload_Session() )->get( $upload_id ) );
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
		$upload_id = $this->create_upload_session();

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
		$upload_id  = $this->create_upload_session();
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
		$upload_id = $this->create_upload_session();

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'DELETE' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$this->assertNull( ( new TUS_Upload_Session() )->get( $upload_id ) );
	}

	/**
	 * Test POST without X-HTTP-Method-Override returns error.
	 */
	public function test_method_override_required() {
		$upload_id = $this->create_upload_session();

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
		$upload_id = $this->create_upload_session();

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
		$upload_id = $this->create_upload_session();

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'head' ); // Lowercase.

		$response = rest_get_server()->dispatch( $request );
		$headers  = $response->get_headers();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '0', (string) $headers['Upload-Offset'] );
	}

	/**
	 * Test that checksum extension is advertised.
	 */
	public function test_checksum_extension_advertised() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media/tus' );
		$response = rest_get_server()->dispatch( $request );

		// Apply the filter manually since rest_post_dispatch isn't called in tests.
		$response = resumable_uploads_add_options_headers( $response, rest_get_server(), $request );
		$headers  = $response->get_headers();

		$this->assertStringContainsString( 'checksum', $headers['Tus-Extension'] );
	}

	/**
	 * Test PATCH with valid SHA256 checksum succeeds.
	 */
	public function test_patch_with_valid_sha256_checksum() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$checksum = 'sha256 ' . base64_encode( hash( 'sha256', $chunk_data, true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', $checksum );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
	}

	/**
	 * Test PATCH with invalid checksum returns 460.
	 */
	public function test_patch_with_invalid_checksum_returns_460() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );
		// Wrong checksum (hash of different data).
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$wrong_checksum = 'sha256 ' . base64_encode( hash( 'sha256', 'different data', true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', $wrong_checksum );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 460, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_checksum_mismatch', $data['code'] );
	}

	/**
	 * Test PATCH without checksum header still works.
	 */
	public function test_patch_without_checksum_succeeds() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		// No Upload-Checksum header.
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
	}

	/**
	 * Test PATCH with unsupported checksum algorithm returns 400.
	 */
	public function test_patch_with_unsupported_algorithm_returns_400() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$checksum = 'unsupported_algo ' . base64_encode( 'somehash' );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', $checksum );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_unsupported_checksum_algorithm', $data['code'] );
	}

	/**
	 * Test PATCH with malformed checksum header returns 400.
	 */
	public function test_patch_with_malformed_checksum_returns_400() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', 'sha256-without-space' ); // Missing space.
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_invalid_checksum_format', $data['code'] );
	}

	/**
	 * Test PATCH with SHA1 checksum succeeds.
	 */
	public function test_patch_with_sha1_checksum() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'b', 256 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$checksum = 'sha1 ' . base64_encode( hash( 'sha1', $chunk_data, true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', $checksum );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
	}

	/**
	 * Test PATCH with MD5 checksum succeeds.
	 */
	public function test_patch_with_md5_checksum() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'c', 128 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$checksum = 'md5 ' . base64_encode( hash( 'md5', $chunk_data, true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', $checksum );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
	}

	/**
	 * Test PATCH with invalid base64 checksum returns 400.
	 */
	public function test_patch_with_invalid_base64_checksum_returns_400() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Upload-Checksum', 'sha256 not-valid-base64!!!' );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_invalid_checksum_encoding', $data['code'] );
	}

	/**
	 * Test PATCH with empty body returns error.
	 */
	public function test_patch_with_empty_body_returns_error() {
		$upload_id = $this->create_upload_session();

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( '' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_empty_chunk', $data['code'] );
	}

	/**
	 * Test HEAD request for expired upload returns 410.
	 */
	public function test_head_expired_upload_returns_410() {
		$upload_id    = wp_generate_uuid4();
		$session_data = array(
			'upload_id'  => $upload_id,
			'user_id'    => self::$admin_id,
			'filename'   => 'expired.txt',
			'filetype'   => 'text/plain',
			'length'     => 1024,
			'offset'     => 0,
			'created_at' => time() - DAY_IN_SECONDS * 2,
			'expires_at' => time() - DAY_IN_SECONDS, // Expired.
		);
		set_transient( 'tus_upload_' . $upload_id, $session_data, DAY_IN_SECONDS );

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 410, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_expired', $data['code'] );
	}

	/**
	 * Test PATCH for expired upload returns 410.
	 */
	public function test_patch_expired_upload_returns_410() {
		$upload_id    = wp_generate_uuid4();
		$session_data = array(
			'upload_id'  => $upload_id,
			'user_id'    => self::$admin_id,
			'filename'   => 'expired.txt',
			'filetype'   => 'text/plain',
			'length'     => 1024,
			'offset'     => 0,
			'created_at' => time() - DAY_IN_SECONDS * 2,
			'expires_at' => time() - DAY_IN_SECONDS, // Expired.
		);
		set_transient( 'tus_upload_' . $upload_id, $session_data, DAY_IN_SECONDS );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 410, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_expired', $data['code'] );
	}

	/**
	 * Test complete upload with invalid file type.
	 */
	public function test_complete_upload_rejects_invalid_file_type() {
		$php_content = '<?php echo "hi";';

		// Create a session with .php file type.
		$upload_id = $this->create_upload_session(
			array(
				'filename' => 'evil.php',
				'filetype' => 'application/x-php',
				'length'   => strlen( $php_content ),
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $php_content );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_invalid_file_type', $data['code'] );
	}

	/**
	 * Test that pre_finalize filter can block upload.
	 */
	public function test_pre_finalize_filter_can_block_upload() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$filter_callback = function () {
			return new WP_Error( 'blocked', 'Upload blocked by filter', array( 'status' => 403 ) );
		};
		add_filter( 'resumable_uploads_pre_finalize', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'resumable_uploads_pre_finalize', $filter_callback );

		$this->assertSame( 403, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'blocked', $data['code'] );
	}

	/**
	 * Test that finalize_upload filter can return custom result.
	 */
	public function test_finalize_filter_can_return_custom_result() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$custom_result   = array(
			'id'         => 999,
			'custom_key' => 'custom_value',
		);
		$filter_callback = function () use ( $custom_result ) {
			return $custom_result;
		};
		add_filter( 'resumable_uploads_finalize_upload', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'resumable_uploads_finalize_upload', $filter_callback );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 999, $data['id'] );
		$this->assertSame( 'custom_value', $data['custom_key'] );
	}

	/**
	 * Test that finalize_upload filter can return error.
	 */
	public function test_finalize_filter_can_return_error() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$filter_callback = function () {
			return new WP_Error( 'custom_error', 'Custom error message', array( 'status' => 422 ) );
		};
		add_filter( 'resumable_uploads_finalize_upload', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'resumable_uploads_finalize_upload', $filter_callback );

		$this->assertSame( 422, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'custom_error', $data['code'] );
	}

	/**
	 * Test upload_created action is fired.
	 */
	public function test_upload_created_action_fires() {
		$action_fired = false;
		$action_args  = array();

		$action_callback = function ( $upload_id, $upload, $request ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'upload_id' => $upload_id,
				'upload'    => $upload,
			);
		};
		add_action( 'resumable_uploads_upload_created', $action_callback, 10, 3 );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'action-test.txt' ) );

		rest_get_server()->dispatch( $request );

		remove_action( 'resumable_uploads_upload_created', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertNotEmpty( $action_args['upload_id'] );
		$this->assertSame( 'action-test.txt', $action_args['upload']['filename'] );
	}

	/**
	 * Test chunk_received action is fired.
	 */
	public function test_chunk_received_action_fires() {
		$upload_id = $this->create_upload_session();

		$action_fired = false;
		$action_args  = array();

		$action_callback = function ( $received_upload_id, $new_offset, $upload, $request ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'upload_id'  => $received_upload_id,
				'new_offset' => $new_offset,
			);
		};
		add_action( 'resumable_uploads_chunk_received', $action_callback, 10, 4 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( str_repeat( 'a', 512 ) );

		rest_get_server()->dispatch( $request );

		remove_action( 'resumable_uploads_chunk_received', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertSame( $upload_id, $action_args['upload_id'] );
		$this->assertSame( 512, $action_args['new_offset'] );
	}

	/**
	 * Test upload_deleted action is fired.
	 */
	public function test_upload_deleted_action_fires() {
		$upload_id = $this->create_upload_session();

		$action_fired = false;
		$action_args  = array();

		$action_callback = function ( $deleted_upload_id, $upload_data ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'upload_id'   => $deleted_upload_id,
				'upload_data' => $upload_data,
			);
		};
		add_action( 'resumable_uploads_upload_deleted', $action_callback, 10, 2 );

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/media/tus/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		remove_action( 'resumable_uploads_upload_deleted', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertSame( $upload_id, $action_args['upload_id'] );
		$this->assertNotNull( $action_args['upload_data'] );
	}

	/**
	 * Test upload_complete action is fired.
	 */
	public function test_upload_complete_action_fires() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$action_fired = false;
		$action_args  = array();

		$action_callback = function ( $attachment_id, $completed_upload_id, $upload_data ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'attachment_id' => $attachment_id,
				'upload_id'     => $completed_upload_id,
			);
		};
		add_action( 'resumable_uploads_upload_complete', $action_callback, 10, 3 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_action( 'resumable_uploads_upload_complete', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertSame( $upload_id, $action_args['upload_id'] );
		$this->assertGreaterThan( 0, $action_args['attachment_id'] );

		// Cleanup.
		wp_delete_attachment( $action_args['attachment_id'], true );
	}

	/**
	 * Test metadata parsing handles empty header.
	 */
	public function test_create_handles_empty_metadata() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		// No Upload-Metadata header.

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * Test metadata parsing handles multiple values.
	 */
	public function test_create_parses_multiple_metadata_values() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header(
			'Upload-Metadata',
			'filename ' . base64_encode( 'document.pdf' ) . ',filetype ' . base64_encode( 'application/pdf' ) . ',custom ' . base64_encode( 'value' )
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );

		// Extract upload ID from Location header.
		$location  = $response->get_headers()['Location'];
		$upload_id = basename( $location );

		$session = new TUS_Upload_Session();
		$upload  = $session->get( $upload_id );

		$this->assertSame( 'document.pdf', $upload['filename'] );
		$this->assertSame( 'application/pdf', $upload['filetype'] );
	}

	/**
	 * Test max upload size filter is applied.
	 */
	public function test_max_upload_size_filter_applied() {
		$filter_callback = function () {
			return 100; // Very small limit.
		};
		add_filter( 'resumable_uploads_max_upload_size', $filter_callback );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/tus' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'resumable_uploads_max_upload_size', $filter_callback );

		$this->assertSame( 413, $response->get_status() );
	}

	/**
	 * Test attachment data filter is applied.
	 */
	public function test_attachment_data_filter_applied() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$filter_callback = function ( $data, $attachment_id, $upload_data ) {
			$data['filtered'] = true;
			return $data;
		};
		add_filter( 'resumable_uploads_attachment_data', $filter_callback, 10, 3 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'resumable_uploads_attachment_data', $filter_callback );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['filtered'] );

		// Cleanup.
		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test wp_handle_upload_prefilter integration.
	 */
	public function test_upload_prefilter_can_reject_upload() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$filter_callback = function ( $file ) {
			$file['error'] = 'File rejected by security scan';
			return $file;
		};
		add_filter( 'wp_handle_upload_prefilter', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/tus/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'wp_handle_upload_prefilter', $filter_callback );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_error', $data['code'] );
		$this->assertStringContainsString( 'security scan', $data['message'] );
	}
}

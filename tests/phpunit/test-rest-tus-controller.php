<?php
/**
 * REST TUS Controller tests.
 *
 * @package uploads-unleashed
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// phpcs:disable WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64 encoding.

/**
 * Tests for the Uploads_Unleashed_TUS_Controller class.
 */
class Test_Uploads_Unleashed_TUS_Controller extends WP_Test_REST_Controller_Testcase {

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
		$files      = array_merge( (array) glob( trailingslashit( $chunks_dir ) . '*.part' ), (array) glob( trailingslashit( $chunks_dir ) . '*.lock' ) );

		if ( $files ) {
			array_map( 'wp_delete_file', $files );
		}

		parent::tear_down();
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) $data['length'] );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( $data['filename'] ) );

		return ( new Uploads_Unleashed_TUS_Upload_Session() )->create( $data, $request );
	}

	/**
	 * Helper method to send a PATCH request with chunk data.
	 *
	 * @param string $upload_id The upload ID.
	 * @param int    $offset    The Upload-Offset header value.
	 * @param string $body      The chunk data.
	 * @return WP_REST_Response The response.
	 */
	protected function send_chunk( string $upload_id, int $offset, string $body ): WP_REST_Response {
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', (string) $offset );
		$request->set_body( $body );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Helper method to send a HEAD (or GET) request for an upload.
	 *
	 * @param string $upload_id The upload ID.
	 * @param string $method    Optional. HTTP method. Default HEAD.
	 * @return WP_REST_Response The response.
	 */
	protected function send_head( string $upload_id, string $method = 'HEAD' ): WP_REST_Response {
		return rest_get_server()->dispatch( new WP_REST_Request( $method, '/wp/v2/media/' . $upload_id ) );
	}

	/**
	 * Helper method to count attachments.
	 *
	 * @return int Number of attachments.
	 */
	protected function count_attachments(): int {
		return count(
			get_posts(
				array(
					'post_type'   => 'attachment',
					'post_status' => 'any',
					'numberposts' => -1,
					'fields'      => 'ids',
				)
			)
		);
	}

	/**
	 * Test route registration.
	 */
	public function test_register_routes() {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/wp/v2/media/(?P<id>[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', $routes );
	}

	/**
	 * Test OPTIONS request returns TUS headers.
	 */
	public function test_options_returns_tus_headers() {
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media' );
		$response = rest_get_server()->dispatch( $request );

		// The rest_post_dispatch filter isn't applied in test environment,
		// so we manually apply it to test the filter function.
		$response = uploads_unleashed_add_options_headers( $response, rest_get_server(), $request );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_cannot_create_upload', $response, 403 );
	}

	/**
	 * Test create upload requires Upload-Length header.
	 */
	public function test_create_upload_requires_length() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		// Without Upload-Length, the rest_pre_dispatch filter does not
		// intercept, so call the controller directly.
		$controller = new Uploads_Unleashed_TUS_Controller();
		$response   = $controller->create_item( $request );

		$this->assertWPError( $response );
		$this->assertSame( 'rest_upload_length_required', $response->get_error_code() );
	}

	/**
	 * Test HEAD request returns correct offset.
	 */
	public function test_head_returns_offset() {
		$upload_id = $this->create_upload_session();

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/' . $upload_id );
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
		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/00000000-0000-4000-8000-000000000000' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_upload_not_found', $response, 404 );
	}

	/**
	 * Test PATCH requires correct Content-Type.
	 */
	public function test_patch_requires_content_type() {
		$upload_id = $this->create_upload_session();

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $chunk_data );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$headers = $response->get_headers();
		$this->assertArrayHasKey( 'Upload-Offset', $headers );
		$this->assertSame( '512', (string) $headers['Upload-Offset'] );

		// Verify session was updated.
		$upload = ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id );
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

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_cannot_view_upload', $response, 403 );
	}

	/**
	 * Test complete upload creates attachment.
	 */
	public function test_complete_upload_creates_attachment() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data 123' );

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
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data 123' );

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
		$controller = new Uploads_Unleashed_TUS_Controller();
		$schema     = $controller->get_item_schema();

		$this->assertSame( 'tus-upload', $schema['title'] );
		$this->assertArrayHasKey( 'id', $schema['properties'] );
		$this->assertArrayHasKey( 'offset', $schema['properties'] );
		$this->assertArrayHasKey( 'length', $schema['properties'] );
		$this->assertArrayHasKey( 'filename', $schema['properties'] );
	}

	/**
	 * Test creating item.
	 */
	public function test_create_item() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) . ',filetype ' . base64_encode( 'text/plain' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );
		$this->assertMatchesRegularExpression(
			'|/wp/v2/media/[a-f0-9-]{36}|',
			$response->get_headers()['Location']
		);
		$this->assertSame( '1.0.0', $response->get_headers()['Tus-Resumable'] );
		$this->assertArrayHasKey( 'Upload-Expires', $response->get_headers() );
	}

	/**
	 * Test deleting item.
	 */
	public function test_delete_item() {
		$upload_id = $this->create_upload_session();

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/media/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$this->assertNull( ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id ) );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'DELETE' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 204, $response->get_status() );
		$this->assertNull( ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id ) );
	}

	/**
	 * Test POST without X-HTTP-Method-Override returns error.
	 */
	public function test_method_override_required() {
		$upload_id = $this->create_upload_session();

		$request  = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
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
		$request  = new WP_REST_Request( 'OPTIONS', '/wp/v2/media' );
		$response = rest_get_server()->dispatch( $request );

		// Apply the filter manually since rest_post_dispatch isn't called in tests.
		$response = uploads_unleashed_add_options_headers( $response, rest_get_server(), $request );
		$headers  = $response->get_headers();

		$this->assertStringContainsString( 'checksum', $headers['Tus-Extension'] );
	}

	/**
	 * Test PATCH with valid SHA256 checksum succeeds.
	 */
	public function test_patch_with_valid_sha256_checksum() {
		$upload_id  = $this->create_upload_session();
		$chunk_data = str_repeat( 'a', 512 );
		$checksum   = 'sha256 ' . base64_encode( hash( 'sha256', $chunk_data, true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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
		$wrong_checksum = 'sha256 ' . base64_encode( hash( 'sha256', 'different data', true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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
		$checksum   = 'unsupported_algo ' . base64_encode( 'somehash' );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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
		$checksum   = 'sha1 ' . base64_encode( hash( 'sha1', $chunk_data, true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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
		$checksum   = 'md5 ' . base64_encode( hash( 'md5', $chunk_data, true ) );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
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
		add_filter( 'uploads_unleashed_pre_finalize', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_pre_finalize', $filter_callback );

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
		add_filter( 'uploads_unleashed_finalize_upload', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_finalize_upload', $filter_callback );

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
		add_filter( 'uploads_unleashed_finalize_upload', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_finalize_upload', $filter_callback );

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

		$action_callback = function ( $upload_id, $upload ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'upload_id' => $upload_id,
				'upload'    => $upload,
			);
		};
		add_action( 'uploads_unleashed_upload_created', $action_callback, 10, 2 );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'action-test.txt' ) );

		rest_get_server()->dispatch( $request );

		remove_action( 'uploads_unleashed_upload_created', $action_callback );

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

		$action_callback = function ( $received_upload_id, $new_offset ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'upload_id'  => $received_upload_id,
				'new_offset' => $new_offset,
			);
		};
		add_action( 'uploads_unleashed_chunk_received', $action_callback, 10, 2 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( str_repeat( 'a', 512 ) );

		rest_get_server()->dispatch( $request );

		remove_action( 'uploads_unleashed_chunk_received', $action_callback );

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
		add_action( 'uploads_unleashed_upload_deleted', $action_callback, 10, 2 );

		$request  = new WP_REST_Request( 'DELETE', '/wp/v2/media/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		remove_action( 'uploads_unleashed_upload_deleted', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertSame( $upload_id, $action_args['upload_id'] );
		$this->assertNotNull( $action_args['upload_data'] );
	}

	/**
	 * Test upload_complete action is fired.
	 */
	public function test_upload_complete_action_fires() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$action_fired = false;
		$action_args  = array();

		$action_callback = function ( $attachment_id, $completed_upload_id ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'attachment_id' => $attachment_id,
				'upload_id'     => $completed_upload_id,
			);
		};
		add_action( 'uploads_unleashed_upload_complete', $action_callback, 10, 2 );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data 123' );

		$response = rest_get_server()->dispatch( $request );

		remove_action( 'uploads_unleashed_upload_complete', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertSame( $upload_id, $action_args['upload_id'] );
		$this->assertGreaterThan( 0, $action_args['attachment_id'] );

		// Cleanup.
		wp_delete_attachment( $action_args['attachment_id'], true );
	}

	/**
	 * Test creation without Upload-Metadata is rejected, because there is no filename.
	 */
	public function test_create_rejects_missing_metadata() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		// No Upload-Metadata header.

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_upload_filename_required', $response, 400 );
	}

	/**
	 * Test creation with metadata but no filename is rejected.
	 */
	public function test_create_rejects_missing_filename() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filetype ' . base64_encode( 'text/plain' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_upload_filename_required', $response, 400 );
	}

	/**
	 * Test creation rejects a file type that isn't allowed, before any bytes are uploaded.
	 */
	public function test_create_rejects_disallowed_file_type() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'setup.exe' ) . ',filetype ' . base64_encode( 'application/x-msdownload' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_invalid_file_type', $response, 400 );
	}

	/**
	 * Test creation rejects a filename without an extension.
	 */
	public function test_create_rejects_filename_without_extension() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'README' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_invalid_file_type', $response, 400 );
	}

	/**
	 * Test creation allows any file type for users with the unfiltered_upload capability.
	 */
	public function test_create_allows_disallowed_file_type_with_unfiltered_upload() {
		$cap_callback = function ( $caps, $cap ) {
			return 'unfiltered_upload' === $cap ? array( 'upload_files' ) : $caps;
		};
		add_filter( 'map_meta_cap', $cap_callback, 10, 2 );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'setup.exe' ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'map_meta_cap', $cap_callback, 10 );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * Test metadata parsing handles multiple values.
	 */
	public function test_create_parses_multiple_metadata_values() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
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

		$session = new Uploads_Unleashed_TUS_Upload_Session();
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
		add_filter( 'uploads_unleashed_max_upload_size', $filter_callback );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_max_upload_size', $filter_callback );

		$this->assertSame( 413, $response->get_status() );
	}

	/**
	 * Test attachment data filter is applied.
	 */
	public function test_attachment_data_filter_applied() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$filter_callback = function ( $data ) {
			$data['filtered'] = true;
			return $data;
		};
		add_filter( 'uploads_unleashed_attachment_data', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data 123' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_attachment_data', $filter_callback );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['filtered'] );

		// Cleanup.
		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test wp_handle_sideload_prefilter integration.
	 */
	public function test_sideload_prefilter_can_reject_upload() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$filter_callback = function ( $file ) {
			$file['error'] = 'File rejected by security scan';
			return $file;
		};
		add_filter( 'wp_handle_sideload_prefilter', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'wp_handle_sideload_prefilter', $filter_callback );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_error', $data['code'] );
		$this->assertStringContainsString( 'security scan', $data['message'] );
	}

	/**
	 * Test multi-chunk upload creates attachment.
	 */
	public function test_multi_chunk_upload_creates_attachment() {
		$chunk1 = str_repeat( 'a', 100 );
		$chunk2 = str_repeat( 'b', 100 );
		$chunk3 = str_repeat( 'c', 100 );

		$upload_id = $this->create_upload_session( array( 'length' => 300 ) );

		// First chunk.
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $chunk1 );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 204, $response->get_status() );
		$this->assertSame( '100', (string) $response->get_headers()['Upload-Offset'] );

		// Second chunk.
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '100' );
		$request->set_body( $chunk2 );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 204, $response->get_status() );
		$this->assertSame( '200', (string) $response->get_headers()['Upload-Offset'] );

		// Third chunk (completes upload).
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '200' );
		$request->set_body( $chunk3 );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );

		$data       = $response->get_data();
		$attachment = get_post( $data['id'] );
		$this->assertSame( 'attachment', $attachment->post_type );

		// Verify file content.
		$file_path = get_attached_file( $data['id'] );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading file in test.
		$content = file_get_contents( $file_path );
		$this->assertSame( $chunk1 . $chunk2 . $chunk3, $content );

		// Cleanup.
		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test PATCH replayed at full offset after completion returns the same attachment.
	 */
	public function test_patch_replayed_after_completion_returns_same_attachment() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$response = $this->send_chunk( $upload_id, 0, 'test data 123' );
		$this->assertSame( 200, $response->get_status() );
		$attachment_id = $response->get_data()['id'];

		// A stale offset is still rejected.
		$response = $this->send_chunk( $upload_id, 0, 'test data 123' );
		$this->assertErrorResponse( 'rest_offset_mismatch', $response, 409 );

		$response = $this->send_chunk( $upload_id, 13, 'test data 123' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $attachment_id, $response->get_data()['id'] );
		$this->assertSame( 1, $this->count_attachments() );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test the completing PATCH sends the attachment ID header.
	 */
	public function test_complete_upload_sends_attachment_id_header() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$response      = $this->send_chunk( $upload_id, 0, 'test data 123' );
		$attachment_id = $response->get_data()['id'];

		$this->assertSame( (string) $attachment_id, (string) $response->get_headers()['X-WP-Upload-Attachment-ID'] );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test HEAD after completion returns the attachment instead of a 404.
	 *
	 * Without it, a client that missed the final response (e.g. a gateway
	 * timeout) starts a new upload and creates a duplicate attachment.
	 */
	public function test_head_after_completion_returns_attachment() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$response      = $this->send_chunk( $upload_id, 0, 'test data 123' );
		$attachment_id = $response->get_data()['id'];

		$response = $this->send_head( $upload_id );
		$headers  = $response->get_headers();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '13', (string) $headers['Upload-Offset'] );
		$this->assertSame( '13', (string) $headers['Upload-Length'] );
		$this->assertSame( (string) $attachment_id, (string) $headers['X-WP-Upload-Attachment-ID'] );

		$response = $this->send_head( $upload_id, 'GET' );
		$this->assertSame( $attachment_id, $response->get_data()['id'] );
		$this->assertSame( 1, $this->count_attachments() );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test HEAD finalizes an upload whose bytes all arrived but that was never finalized.
	 *
	 * Without it, HEAD reports offset == length, the client considers the
	 * upload done, and no attachment is ever created.
	 */
	public function test_head_finalizes_upload_with_all_bytes_received() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( $upload_id, 'test data 123', 0 );

		$response = $this->send_head( $upload_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '13', (string) $response->get_headers()['Upload-Offset'] );
		$this->assertArrayHasKey( 'X-WP-Upload-Attachment-ID', $response->get_headers() );
		$attachment_id = (int) $response->get_headers()['X-WP-Upload-Attachment-ID'];
		$this->assertSame( 'attachment', get_post_type( $attachment_id ) );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test finalization resumes when PHP died before the file was moved.
	 */
	public function test_finalize_resumes_after_crash_before_move() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$crash = static function () {
			throw new RuntimeException( 'Simulated timeout' );
		};
		add_filter( 'wp_handle_sideload_prefilter', $crash );

		try {
			$this->send_chunk( $upload_id, 0, 'test data 123' );
			$this->fail( 'Expected the simulated timeout.' );
		} catch ( RuntimeException $e ) {
			$this->assertSame( 'Simulated timeout', $e->getMessage() );
		} finally {
			remove_filter( 'wp_handle_sideload_prefilter', $crash );
		}

		$response = $this->send_head( $upload_id, 'GET' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayHasKey( 'id', (array) $response->get_data() );
		$attachment_id = $response->get_data()['id'];
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading file in test.
		$this->assertSame( 'test data 123', file_get_contents( get_attached_file( $attachment_id ) ) );
		$this->assertSame( 1, $this->count_attachments() );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test finalization resumes when PHP died while generating attachment metadata.
	 */
	public function test_finalize_resumes_after_crash_during_metadata_generation() {
		$fixture   = DIR_TESTDATA . '/images/canola.jpg';
		$upload_id = $this->create_upload_session(
			array(
				'filename' => 'canola.jpg',
				'filetype' => 'image/jpeg',
				'length'   => filesize( $fixture ),
			)
		);

		$session_during_metadata = null;
		$crash                   = static function () use ( $upload_id, &$session_during_metadata ) {
			$session_during_metadata = ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id );
			throw new RuntimeException( 'Simulated timeout' );
		};
		add_filter( 'intermediate_image_sizes_advanced', $crash );

		try {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading fixture in test.
			$this->send_chunk( $upload_id, 0, file_get_contents( $fixture ) );
			$this->fail( 'Expected the simulated timeout.' );
		} catch ( RuntimeException $e ) {
			$this->assertSame( 'Simulated timeout', $e->getMessage() );
		} finally {
			remove_filter( 'intermediate_image_sizes_advanced', $crash );
		}

		// The attachment ID is known before metadata generation starts.
		$this->assertNotEmpty( $session_during_metadata['attachment_id'] );
		$attachment_id = (int) $session_during_metadata['attachment_id'];

		$response = $this->send_head( $upload_id, 'GET' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $attachment_id, $response->get_data()['id'] );
		$this->assertSame( 1, $this->count_attachments() );
		$this->assertNotEmpty( wp_get_attachment_metadata( $attachment_id )['sizes'] );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test a request returns 423 while another request is finalizing the upload.
	 */
	public function test_finalize_returns_423_while_locked() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );
		$storage   = new Uploads_Unleashed_TUS_Chunk_Storage();
		$storage->append( $upload_id, 'test data 123', 0 );

		$lock = $storage->lock( $upload_id );
		$this->assertNotFalse( $lock );

		$response = $this->send_head( $upload_id );

		$storage->unlock( $lock );

		$this->assertErrorResponse( 'rest_upload_locked', $response, 423 );
		$this->assertSame( 0, $this->count_attachments() );

		$response = $this->send_head( $upload_id );
		$this->assertSame( 200, $response->get_status() );

		wp_delete_attachment( (int) $response->get_headers()['X-WP-Upload-Attachment-ID'], true );
	}

	/**
	 * Test the chunk file is moved into place rather than copied.
	 */
	public function test_complete_upload_moves_chunk_file() {
		$upload_id  = $this->create_upload_session( array( 'length' => 13 ) );
		$chunk_path = ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_path( $upload_id );

		$this->send_chunk( $upload_id, 0, 'test' );
		$inode = fileinode( $chunk_path );

		$response      = $this->send_chunk( $upload_id, 4, ' data 123' );
		$attachment_id = $response->get_data()['id'];

		$this->assertSame( $inode, fileinode( get_attached_file( $attachment_id ) ) );
		$this->assertFileDoesNotExist( $chunk_path );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test a failed attachment creation removes the already-moved file.
	 */
	public function test_failed_attachment_creation_removes_moved_file() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$controller = new class() extends Uploads_Unleashed_TUS_Controller {
			/**
			 * Fails like a database error would.
			 *
			 * @param array  $upload_result The upload result.
			 * @param string $upload_id     The upload ID.
			 * @param array  $params        The upload params.
			 * @return WP_Error Always.
			 */
			protected function create_attachment( array $upload_result, string $upload_id = '', array $params = array() ) {
				return new WP_Error( 'db_insert_error', 'Could not insert post into the database.', array( 'status' => 500 ) );
			}
		};

		$moved_file = '';
		$capture    = static function ( array $upload ) use ( &$moved_file ): array {
			$moved_file = $upload['file'];
			return $upload;
		};
		add_filter( 'wp_handle_upload', $capture );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_url_params( array( 'id' => $upload_id ) );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data 123' );

		$this->assertTrue( $controller->get_item_permissions_check( $request ) );
		$response = $controller->upload_chunk( $request );

		remove_filter( 'wp_handle_upload', $capture );

		$this->assertWPError( $response );
		$this->assertNotEmpty( $moved_file );
		$this->assertFileDoesNotExist( $moved_file );
	}

	/**
	 * Test DELETE after completion removes the tombstone but keeps the attachment.
	 */
	public function test_delete_after_completion_keeps_attachment() {
		$upload_id = $this->create_upload_session( array( 'length' => 13 ) );

		$attachment_id = $this->send_chunk( $upload_id, 0, 'test data 123' )->get_data()['id'];

		$response = rest_get_server()->dispatch( new WP_REST_Request( 'DELETE', '/wp/v2/media/' . $upload_id ) );
		$this->assertSame( 204, $response->get_status() );

		$this->assertErrorResponse( 'rest_upload_not_found', $this->send_head( $upload_id ), 404 );
		$this->assertSame( 'attachment', get_post_type( $attachment_id ) );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test concurrent PATCH at same offset returns 409 for second request.
	 */
	public function test_concurrent_patch_returns_offset_mismatch() {
		$upload_id = $this->create_upload_session( array( 'length' => 200 ) );

		// First PATCH at offset 0 succeeds.
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( str_repeat( 'a', 100 ) );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 204, $response->get_status() );
		$this->assertSame( '100', (string) $response->get_headers()['Upload-Offset'] );

		// Second PATCH at offset 0 fails (offset is now 100).
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( str_repeat( 'b', 100 ) );

		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'rest_offset_mismatch', $response->get_data()['code'] );
	}

	/**
	 * Test HEAD reports the bytes on disk when the session offset lags behind.
	 *
	 * Simulates PHP being killed after a chunk was written but before the
	 * session offset was updated.
	 */
	public function test_head_reports_bytes_on_disk_when_session_offset_lags() {
		$upload_id = $this->create_upload_session( array( 'length' => 10 ) );

		$response = $this->send_chunk( $upload_id, 0, 'aaaaa' );
		$this->assertSame( 204, $response->get_status() );

		// Bytes that reached the disk without the session being updated.
		( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( $upload_id, 'bb', 5 );

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '7', (string) $response->get_headers()['Upload-Offset'] );

		// The session is reconciled from the file.
		$upload = ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id );
		$this->assertSame( 7, (int) $upload['offset'] );
	}

	/**
	 * Test PATCH resumes at the bytes on disk when the session offset lags behind.
	 */
	public function test_patch_resumes_at_bytes_on_disk_when_session_offset_lags() {
		$upload_id = $this->create_upload_session( array( 'length' => 16 ) );

		$this->send_chunk( $upload_id, 0, 'aaaaa' );
		( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( $upload_id, 'bb', 5 );

		// The stale session offset is rejected without touching the file.
		$response = $this->send_chunk( $upload_id, 5, 'bbccc' );
		$this->assertErrorResponse( 'rest_offset_mismatch', $response, 409 );

		$response = $this->send_chunk( $upload_id, 7, 'ccccccccc' );
		$this->assertSame( 200, $response->get_status() );

		$attachment_id = $response->get_data()['id'];
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading file in test.
		$this->assertSame( 'aaaaabbccccccccc', file_get_contents( get_attached_file( $attachment_id ) ) );

		wp_delete_attachment( $attachment_id, true );
	}

	/**
	 * Test an upload stays resumable when the session offset fails to save.
	 */
	public function test_upload_resumes_when_session_offset_update_fails() {
		$upload_id = $this->create_upload_session( array( 'length' => 16 ) );

		// Keep the stored value unchanged, so set_transient() returns false.
		$block_update = static function ( $value, $old_value ) {
			return $old_value;
		};
		add_filter( 'pre_update_option__transient_tus_upload_' . $upload_id, $block_update, 10, 2 );

		$response = $this->send_chunk( $upload_id, 0, 'aaaaa' );

		remove_filter( 'pre_update_option__transient_tus_upload_' . $upload_id, $block_update );

		$this->assertSame( 204, $response->get_status() );
		$this->assertSame( '5', (string) $response->get_headers()['Upload-Offset'] );

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( '5', (string) $response->get_headers()['Upload-Offset'] );

		$response = $this->send_chunk( $upload_id, 5, 'bbbbbbbbbbb' );
		$this->assertSame( 200, $response->get_status() );

		wp_delete_attachment( $response->get_data()['id'], true );
	}

	/**
	 * Test create upload rejects zero Upload-Length.
	 */
	public function test_create_upload_rejects_zero_length() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '0' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_length_invalid', $data['code'] );
	}

	/**
	 * Test create upload rejects negative Upload-Length.
	 */
	public function test_create_upload_rejects_negative_length() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '-1' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_length_invalid', $data['code'] );
	}

	/**
	 * Test create upload rejects non-numeric Upload-Length.
	 */
	public function test_create_upload_rejects_non_numeric_length() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '10foo' );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_length_invalid', $data['code'] );
	}

	/**
	 * Test PATCH truncates chunk data exceeding declared Upload-Length.
	 */
	public function test_patch_truncates_oversized_chunk() {
		$upload_id = $this->create_upload_session( array( 'length' => 16 ) );

		// Send 20 bytes when only 16 are expected.
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( str_repeat( 'a', 20 ) );

		$response = rest_get_server()->dispatch( $request );

		// Upload should complete at exactly 16 bytes.
		$this->assertSame( 200, $response->get_status() );
		$headers = $response->get_headers();
		$this->assertSame( '16', (string) $headers['Upload-Offset'] );

		// Cleanup.
		$data = $response->get_data();
		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test PATCH rejects chunks exceeding server chunk size limit.
	 */
	public function test_patch_rejects_chunk_exceeding_size_limit() {
		$upload_id = $this->create_upload_session( array( 'length' => 5 * MB_IN_BYTES ) );

		// The filter floor is 1 MB, so use that as the limit.
		$filter_callback = function () {
			return MB_IN_BYTES;
		};
		add_filter( 'uploads_unleashed_max_chunk_size', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( str_repeat( 'a', MB_IN_BYTES + 1 ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_max_chunk_size', $filter_callback );

		$this->assertSame( 413, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_chunk_too_large', $data['code'] );
	}

	/**
	 * Test PATCH at full offset finalizes an upload that received all bytes but was never finalized.
	 */
	public function test_patch_at_full_offset_finalizes_complete_upload() {
		$upload_id = $this->create_upload_session( array( 'length' => 100 ) );

		// All bytes stored, but PHP died before finalizing.
		( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( $upload_id, str_repeat( 'a', 100 ), 0 );
		( new Uploads_Unleashed_TUS_Upload_Session() )->update_offset( $upload_id, 100 );

		$response = $this->send_chunk( $upload_id, 100, 'extra data' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $this->count_attachments() );

		wp_delete_attachment( $response->get_data()['id'], true );
	}

	/**
	 * Test finalize_upload with custom result fires upload_complete action.
	 */
	public function test_custom_finalize_fires_upload_complete_with_zero_attachment_id() {
		$upload_id = $this->create_upload_session( array( 'length' => 9 ) );

		$action_fired = false;
		$action_args  = array();

		$action_callback = function ( $attachment_id, $completed_upload_id ) use ( &$action_fired, &$action_args ) {
			$action_fired = true;
			$action_args  = array(
				'attachment_id' => $attachment_id,
				'upload_id'     => $completed_upload_id,
			);
		};
		add_action( 'uploads_unleashed_upload_complete', $action_callback, 10, 2 );

		// Custom finalization without an 'id' key.
		$filter_callback = function () {
			return array( 'custom_key' => 'custom_value' );
		};
		add_filter( 'uploads_unleashed_finalize_upload', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_finalize_upload', $filter_callback );
		remove_action( 'uploads_unleashed_upload_complete', $action_callback );

		$this->assertTrue( $action_fired );
		$this->assertSame( 0, $action_args['attachment_id'] );
	}

	/**
	 * Test image MIME validation rejects non-image content with image extension.
	 */
	public function test_validate_file_rejects_invalid_image_content() {
		if ( ! extension_loaded( 'fileinfo' ) ) {
			$this->markTestSkipped( 'wp_check_filetype_and_ext() needs fileinfo to check non-image content.' );
		}

		$fake_jpeg_content = 'This is not a JPEG image at all';
		$upload_id         = $this->create_upload_session(
			array(
				'filename' => 'fake.jpg',
				'filetype' => 'image/jpeg',
				'length'   => strlen( $fake_jpeg_content ),
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $fake_jpeg_content );

		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_invalid_file_type', $response, 400 );
	}

	/**
	 * Test image MIME validation rejects non-image content that a filter labelled as an image.
	 */
	public function test_validate_file_rejects_filtered_non_image_content() {
		$fake_jpeg_content = '<?php echo "not an image"; ?>';
		$upload_id         = $this->create_upload_session(
			array(
				'filename' => 'fake.jpg',
				'filetype' => 'image/jpeg',
				'length'   => strlen( $fake_jpeg_content ),
			)
		);

		$filter_callback = function ( $data ) {
			$data['ext']  = 'jpg';
			$data['type'] = 'image/jpeg';
			return $data;
		};
		add_filter( 'wp_check_filetype_and_ext', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $fake_jpeg_content );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'wp_check_filetype_and_ext', $filter_callback );

		$this->assertErrorResponse( 'rest_invalid_image', $response, 400 );
	}

	/**
	 * Test image MIME validation rejects image content that doesn't match the validated type.
	 */
	public function test_validate_file_rejects_mismatched_image_content() {
		// A 1x1 PNG.
		$png_content = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNk/P8PAAUAAQFrH4qPAAAAAElFTkSuQmCC' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Test fixture.
		$upload_id   = $this->create_upload_session(
			array(
				'filename' => 'photo.jpg',
				'filetype' => 'image/jpeg',
				'length'   => strlen( $png_content ),
			)
		);

		// Force wp_check_filetype_and_ext to return image/jpeg so we reach the wp_get_image_mime() check.
		$filter_callback = function ( $data ) {
			$data['ext']  = 'jpg';
			$data['type'] = 'image/jpeg';
			return $data;
		};
		add_filter( 'wp_check_filetype_and_ext', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $png_content );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'wp_check_filetype_and_ext', $filter_callback );

		$this->assertErrorResponse( 'rest_invalid_image', $response, 400 );
	}

	/**
	 * Test an image type that wp_get_image_mime() can't read (SVG) is accepted when allowed.
	 */
	public function test_validate_file_accepts_allowed_svg() {
		$mimes_callback = function ( $mimes ) {
			$mimes['svg'] = 'image/svg+xml';
			return $mimes;
		};
		add_filter( 'upload_mimes', $mimes_callback );

		// Older fileinfo versions don't detect SVG; SVG plugins correct the result like this.
		$filetype_callback = function ( $data, $file, $filename ) {
			if ( 'svg' === pathinfo( $filename, PATHINFO_EXTENSION ) ) {
				$data['ext']  = 'svg';
				$data['type'] = 'image/svg+xml';
			}
			return $data;
		};
		add_filter( 'wp_check_filetype_and_ext', $filetype_callback, 10, 3 );

		// SVG plugins provide dimensions, which core's REST response expects for image/* types.
		$metadata_callback = function ( $metadata ) {
			return array_merge(
				$metadata,
				array(
					'width'  => 1,
					'height' => 1,
				)
			);
		};
		add_filter( 'wp_generate_attachment_metadata', $metadata_callback );

		// No width/height, so getimagesize() can't read it on PHP 8.5+ either.
		$svg_content = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';
		$upload_id   = $this->create_upload_session(
			array(
				'filename' => 'icon.svg',
				'filetype' => 'image/svg+xml',
				'length'   => strlen( $svg_content ),
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $svg_content );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'upload_mimes', $mimes_callback );
		remove_filter( 'wp_check_filetype_and_ext', $filetype_callback, 10 );
		remove_filter( 'wp_generate_attachment_metadata', $metadata_callback );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'image/svg+xml', get_post_mime_type( $data['id'] ) );

		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test users with unfiltered_upload can finalize a file type that isn't allowed.
	 */
	public function test_validate_file_allows_unknown_type_with_unfiltered_upload() {
		$cap_callback = function ( $caps, $cap ) {
			return 'unfiltered_upload' === $cap ? array( 'upload_files' ) : $caps;
		};
		add_filter( 'map_meta_cap', $cap_callback, 10, 2 );

		$content   = 'custom data file';
		$upload_id = $this->create_upload_session(
			array(
				'filename' => 'data.custom',
				'filetype' => 'application/x-custom',
				'length'   => strlen( $content ),
			)
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $content );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'map_meta_cap', $cap_callback, 10 );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'application/x-custom', get_post_mime_type( $data['id'] ) );

		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test validate_file uses proper_filename when returned by wp_check_filetype_and_ext.
	 */
	public function test_validate_file_uses_proper_filename() {
		$upload_id = $this->create_upload_session(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 13,
			)
		);

		// Force wp_check_filetype_and_ext to return a proper_filename.
		$filter_callback = function ( $data ) {
			$data['ext']             = 'txt';
			$data['type']            = 'text/plain';
			$data['proper_filename'] = 'corrected.txt';
			return $data;
		};
		add_filter( 'wp_check_filetype_and_ext', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data 123' );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'wp_check_filetype_and_ext', $filter_callback );

		$this->assertSame( 200, $response->get_status() );

		$data       = $response->get_data();
		$attachment = get_post( $data['id'] );

		// The title should be based on the corrected filename (without extension).
		$this->assertSame( 'corrected', $attachment->post_title );

		// Cleanup.
		wp_delete_attachment( $data['id'], true );
	}

	/**
	 * Test metadata parsing handles key with no value.
	 */
	public function test_create_handles_metadata_key_with_no_value() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		// Key without a space-separated value.
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) . ',keyonly' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * Test metadata parsing handles invalid base64 value.
	 */
	public function test_create_handles_invalid_base64_metadata() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		// Invalid base64 value (with strict mode, this should be skipped).
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'test.txt' ) . ',badkey not-valid-base64!!!' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * Test metadata parsing handles extra whitespace and empty pairs.
	 */
	public function test_create_handles_extra_whitespace_in_metadata() {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '1024' );
		// Extra whitespace and empty pair between commas.
		$request->set_header( 'Upload-Metadata', '  filename ' . base64_encode( 'test.txt' ) . ', , filetype ' . base64_encode( 'text/plain' ) . ' ' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 201, $response->get_status() );

		// Extract upload ID from Location header.
		$location  = $response->get_headers()['Location'];
		$upload_id = basename( $location );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$upload  = $session->get( $upload_id );

		$this->assertSame( 'test.txt', $upload['filename'] );
	}

	/**
	 * Test get_item_schema cache hit on second call.
	 *
	 * The first call populates $this->schema; the second call
	 * returns early from the cache (line 926).
	 */
	public function test_get_item_schema_returns_cached_on_second_call() {
		$controller = new Uploads_Unleashed_TUS_Controller();

		$schema1 = $controller->get_item_schema();
		$schema2 = $controller->get_item_schema();

		$this->assertSame( $schema1, $schema2 );
		$this->assertSame( 'tus-upload', $schema2['title'] );
	}

	/**
	 * Test can_access_upload denies subscriber without upload_files capability.
	 *
	 * Sends a HEAD request as subscriber to trigger the first check in
	 * can_access_upload() (line 974).
	 */
	public function test_head_as_subscriber_returns_forbidden() {
		wp_set_current_user( self::$subscriber_id );

		$upload_id = wp_generate_uuid4();

		$request  = new WP_REST_Request( 'HEAD', '/wp/v2/media/' . $upload_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertErrorResponse( 'rest_cannot_view_upload', $response, 403 );
	}

	/**
	 * Test invalid X-HTTP-Method-Override returns 400.
	 *
	 * Covers the default case in handle_method_override() (lines 262-266).
	 */
	public function test_invalid_method_override_returns_error() {
		$upload_id = $this->create_upload_session();

		$request = new WP_REST_Request( 'POST', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'X-HTTP-Method-Override', 'PUT' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_invalid_method_override', $data['code'] );
	}

	/**
	 * Test PATCH rejects chunk via Content-Length header before reading body.
	 */
	public function test_patch_rejects_chunk_via_content_length_header() {
		$upload_id = $this->create_upload_session( array( 'length' => 5 * MB_IN_BYTES ) );

		$filter_callback = function () {
			return MB_IN_BYTES;
		};
		add_filter( 'uploads_unleashed_max_chunk_size', $filter_callback );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_header( 'Content-Length', (string) ( MB_IN_BYTES + 1 ) );
		$request->set_body( str_repeat( 'a', 50 ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_max_chunk_size', $filter_callback );

		$this->assertSame( 413, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_chunk_too_large', $data['code'] );
	}

	/**
	 * Test create upload rejects when multisite quota is exceeded.
	 *
	 * @group ms-required
	 */
	public function test_create_upload_rejects_when_quota_exceeded() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}

		// The test network is installed from a single site, which disables the quota.
		update_site_option( 'upload_space_check_disabled', 0 );

		// Lift the size limit so the quota pre-flight check is what rejects the upload.
		$max_size_callback = function () {
			return PHP_INT_MAX;
		};
		add_filter( 'uploads_unleashed_max_upload_size', $max_size_callback );

		// Mock quota: 10 MB allowed, 9.5 MB used.
		$space_used_callback = function () {
			return 9.5;
		};
		add_filter( 'pre_get_space_used', $space_used_callback );

		$space_allowed_callback = function () {
			return 10;
		};
		add_filter( 'get_space_allowed', $space_allowed_callback );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) MB_IN_BYTES ); // 1 MB, would exceed quota.
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'large.zip' ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'uploads_unleashed_max_upload_size', $max_size_callback );
		remove_filter( 'pre_get_space_used', $space_used_callback );
		remove_filter( 'get_space_allowed', $space_allowed_callback );

		$this->assertSame( 400, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_quota_exceeded', $data['code'] );
	}

	/**
	 * Test create upload succeeds when within multisite quota.
	 *
	 * @group ms-required
	 */
	public function test_create_upload_succeeds_within_quota() {
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}

		// Mock quota: 100 MB allowed, 1 MB used.
		$space_used_callback = function () {
			return 1;
		};
		add_filter( 'pre_get_space_used', $space_used_callback );

		$space_allowed_callback = function () {
			return 100;
		};
		add_filter( 'get_space_allowed', $space_allowed_callback );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) MB_IN_BYTES ); // 1 MB, well within quota.
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'small.zip' ) );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'pre_get_space_used', $space_used_callback );
		remove_filter( 'get_space_allowed', $space_allowed_callback );

		$this->assertSame( 201, $response->get_status() );
	}
}

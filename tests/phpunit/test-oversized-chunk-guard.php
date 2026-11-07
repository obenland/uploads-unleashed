<?php
/**
 * Tests for skipping the body of oversized chunk requests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

/**
 * Tests for uploads_unleashed_skip_oversized_chunk_body().
 */
class Test_Oversized_Chunk_Guard extends WP_UnitTestCase {

	/**
	 * $_SERVER keys the tests change.
	 *
	 * @var string[]
	 */
	const SERVER_KEYS = array( 'REQUEST_METHOD', 'CONTENT_LENGTH', 'HTTP_X_HTTP_METHOD_OVERRIDE' );

	/**
	 * Original $_SERVER values, restored after each test.
	 *
	 * @var array
	 */
	private array $original_server = array();

	/**
	 * Saves the request globals the tests change.
	 */
	public function set_up(): void {
		parent::set_up();

		foreach ( self::SERVER_KEYS as $key ) {
			$this->original_server[ $key ] = $_SERVER[ $key ] ?? null; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- Saved verbatim to restore it.
		}

		unset( $GLOBALS['HTTP_RAW_POST_DATA'], $_GET['_method'] );
	}

	/**
	 * Restores the request globals.
	 */
	public function tear_down(): void {
		foreach ( $this->original_server as $key => $value ) {
			if ( null === $value ) {
				unset( $_SERVER[ $key ] );
			} else {
				$_SERVER[ $key ] = $value;
			}
		}

		unset( $GLOBALS['HTTP_RAW_POST_DATA'], $_GET['_method'] );

		parent::tear_down();
	}

	/**
	 * Builds a WP instance for a REST request to the given route.
	 *
	 * @param string $method         HTTP method.
	 * @param int    $content_length Value of the Content-Length header.
	 * @param string $route          REST route.
	 * @return WP The WP instance.
	 */
	private function make_request( string $method, int $content_length, string $route = '' ): WP {
		$_SERVER['REQUEST_METHOD'] = $method;
		$_SERVER['CONTENT_LENGTH'] = (string) $content_length;

		$wp                           = new WP();
		$wp->query_vars['rest_route'] = '' !== $route ? $route : '/wp/v2/media/' . wp_generate_uuid4();

		return $wp;
	}

	/**
	 * Tests the guard runs before rest_api_loaded() reads the body.
	 */
	public function test_runs_before_rest_api_loaded(): void {
		$priority = has_action( 'parse_request', 'uploads_unleashed_skip_oversized_chunk_body' );

		$this->assertIsInt( $priority );
		$this->assertLessThan( has_action( 'parse_request', 'rest_api_loaded' ), $priority );
	}

	/**
	 * Tests an oversized PATCH body is never read.
	 */
	public function test_skips_body_of_oversized_patch(): void {
		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'PATCH', 200 * MB_IN_BYTES ) );

		$this->assertTrue( isset( $GLOBALS['HTTP_RAW_POST_DATA'] ), 'The body should be replaced before the REST server reads it.' );
		$this->assertSame( '', WP_REST_Server::get_raw_data() );
	}

	/**
	 * Tests an oversized PATCH sent as POST with X-HTTP-Method-Override is never read.
	 */
	public function test_skips_body_of_oversized_method_override_patch(): void {
		$_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] = 'patch';

		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'POST', 200 * MB_IN_BYTES ) );

		$this->assertSame( '', $GLOBALS['HTTP_RAW_POST_DATA'] ?? null );
	}

	/**
	 * Tests an oversized PATCH sent as POST with ?_method=PATCH is never read.
	 */
	public function test_skips_body_of_oversized_method_param_patch(): void {
		$_GET['_method'] = 'PATCH';

		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'POST', 200 * MB_IN_BYTES ) );

		$this->assertSame( '', $GLOBALS['HTTP_RAW_POST_DATA'] ?? null );
	}

	/**
	 * Tests a PATCH within the chunk size limit is left alone.
	 */
	public function test_keeps_body_within_limit(): void {
		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'PATCH', Uploads_Unleashed_TUS_Controller::DEFAULT_MAX_CHUNK_SIZE ) );

		$this->assertFalse( isset( $GLOBALS['HTTP_RAW_POST_DATA'] ) );
	}

	/**
	 * Tests the uploads_unleashed_max_chunk_size filter raises the limit.
	 */
	public function test_respects_max_chunk_size_filter(): void {
		$filter_callback = static function (): int {
			return 50 * MB_IN_BYTES;
		};
		add_filter( 'uploads_unleashed_max_chunk_size', $filter_callback );

		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'PATCH', 20 * MB_IN_BYTES ) );

		remove_filter( 'uploads_unleashed_max_chunk_size', $filter_callback );

		$this->assertFalse( isset( $GLOBALS['HTTP_RAW_POST_DATA'] ) );
	}

	/**
	 * Tests requests to other routes are left alone.
	 */
	public function test_ignores_other_routes(): void {
		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'PATCH', 200 * MB_IN_BYTES, '/wp/v2/posts/1' ) );

		$this->assertFalse( isset( $GLOBALS['HTTP_RAW_POST_DATA'] ) );
	}

	/**
	 * Tests requests that aren't PATCH are left alone.
	 */
	public function test_ignores_other_methods(): void {
		uploads_unleashed_skip_oversized_chunk_body( $this->make_request( 'POST', 200 * MB_IN_BYTES ) );

		$this->assertFalse( isset( $GLOBALS['HTTP_RAW_POST_DATA'] ) );
	}

	/**
	 * Tests the controller still rejects the emptied request with 413.
	 */
	public function test_controller_rejects_emptied_request_with_413(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$id      = $session->create(
			array(
				'filename' => 'big.txt',
				'length'   => 300 * MB_IN_BYTES,
			),
			$request
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Content-Length', (string) ( 200 * MB_IN_BYTES ) );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( '' );

		$response = rest_get_server()->dispatch( $request );

		$session->delete( $id );

		$this->assertSame( 413, $response->get_status() );
		$this->assertSame( 'rest_chunk_too_large', $response->get_data()['code'] );
	}
}

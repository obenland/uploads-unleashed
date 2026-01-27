<?php
/**
 * TUS Upload Session tests.
 *
 * @package uploads-unleashed
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tests for the TUS_Upload_Session class.
 */
class Test_TUS_Upload_Session extends WP_UnitTestCase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Editor user ID.
	 *
	 * @var int
	 */
	protected static int $editor_id;

	/**
	 * Session instance for tests.
	 *
	 * @var TUS_Upload_Session
	 */
	protected TUS_Upload_Session $session;

	/**
	 * Set up class fixtures.
	 */
	public static function set_up_before_class() {
		parent::set_up_before_class();

		$factory         = self::factory();
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	/**
	 * Set up each test.
	 */
	public function set_up() {
		parent::set_up();
		$this->session = new TUS_Upload_Session();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * Tests that create returns a valid UUID.
	 */
	public function test_create_returns_valid_uuid() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$this->assertIsString( $upload_id );
		$this->assertMatchesRegularExpression(
			'/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
			$upload_id
		);
	}

	/**
	 * Tests that create stores correct session data.
	 */
	public function test_create_stores_correct_session_data() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'document.pdf',
				'filetype' => 'application/pdf',
				'length'   => 5000,
			),
			$request
		);

		$data = $this->session->get( $upload_id );

		$this->assertIsArray( $data );
		$this->assertSame( $upload_id, $data['upload_id'] );
		$this->assertSame( self::$admin_id, $data['user_id'] );
		$this->assertSame( 'document.pdf', $data['filename'] );
		$this->assertSame( 'application/pdf', $data['filetype'] );
		$this->assertSame( 5000, $data['length'] );
		$this->assertSame( 0, $data['offset'] );
		$this->assertArrayHasKey( 'created_at', $data );
		$this->assertArrayHasKey( 'expires_at', $data );
	}

	/**
	 * Tests that create sanitizes the filename.
	 */
	public function test_create_sanitizes_filename() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => '../../../etc/passwd',
				'filetype' => 'text/plain',
				'length'   => 100,
			),
			$request
		);

		$data = $this->session->get( $upload_id );

		$this->assertStringNotContainsString( '..', $data['filename'] );
		$this->assertStringNotContainsString( '/', $data['filename'] );
	}

	/**
	 * Tests that get returns null for non-existent session.
	 */
	public function test_get_returns_null_for_nonexistent_session() {
		$data = $this->session->get( 'nonexistent-uuid' );

		$this->assertNull( $data );
	}

	/**
	 * Tests that update_offset updates the offset correctly.
	 */
	public function test_update_offset_updates_correctly() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$result = $this->session->update_offset( $upload_id, 512 );

		$this->assertTrue( $result );

		$data = $this->session->get( $upload_id );
		$this->assertSame( 512, $data['offset'] );
	}

	/**
	 * Tests that update_offset preserves other session data.
	 */
	public function test_update_offset_preserves_other_data() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$original_data = $this->session->get( $upload_id );
		$this->session->update_offset( $upload_id, 512 );
		$updated_data = $this->session->get( $upload_id );

		$this->assertSame( $original_data['filename'], $updated_data['filename'] );
		$this->assertSame( $original_data['filetype'], $updated_data['filetype'] );
		$this->assertSame( $original_data['length'], $updated_data['length'] );
		$this->assertSame( $original_data['user_id'], $updated_data['user_id'] );
		$this->assertSame( $original_data['created_at'], $updated_data['created_at'] );
	}

	/**
	 * Tests that update_offset returns false for non-existent session.
	 */
	public function test_update_offset_returns_false_for_nonexistent() {
		$result = $this->session->update_offset( 'nonexistent-uuid', 100 );

		$this->assertFalse( $result );
	}

	/**
	 * Tests that delete removes the session.
	 */
	public function test_delete_removes_session() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$this->assertNotNull( $this->session->get( $upload_id ) );

		$result = $this->session->delete( $upload_id );

		$this->assertTrue( $result );
		$this->assertNull( $this->session->get( $upload_id ) );
	}


	/**
	 * Tests that session expiration is set correctly.
	 */
	public function test_session_expiration_is_set_correctly() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$data             = $this->session->get( $upload_id );
		$expected_expires = $data['created_at'] + DAY_IN_SECONDS;

		$this->assertSame( $expected_expires, $data['expires_at'] );
	}

	/**
	 * Tests that the session_data filter can modify session data.
	 */
	public function test_session_data_filter_can_modify_data() {
		$filter_callback = function ( $session_data ) {
			$session_data['custom_field'] = 'custom_value';
			return $session_data;
		};
		add_filter( 'uploads_unleashed_session_data', $filter_callback );

		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.txt',
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$data = $this->session->get( $upload_id );

		remove_filter( 'uploads_unleashed_session_data', $filter_callback );

		$this->assertArrayHasKey( 'custom_field', $data );
		$this->assertSame( 'custom_value', $data['custom_field'] );
	}

	/**
	 * Tests that create handles missing filename gracefully.
	 */
	public function test_create_handles_missing_filename() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filetype' => 'text/plain',
				'length'   => 1024,
			),
			$request
		);

		$data = $this->session->get( $upload_id );

		$this->assertSame( 'unnamed', $data['filename'] );
	}

	/**
	 * Tests that create handles missing filetype gracefully.
	 */
	public function test_create_handles_missing_filetype() {
		$request   = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$upload_id = $this->session->create(
			array(
				'filename' => 'test.bin',
				'length'   => 1024,
			),
			$request
		);

		$data = $this->session->get( $upload_id );

		$this->assertSame( 'application/octet-stream', $data['filetype'] );
	}
}

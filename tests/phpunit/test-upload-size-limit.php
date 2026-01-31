<?php
/**
 * Upload Size Limit Filter tests.
 *
 * @package uploads-unleashed
 */

/**
 * Tests for the uploads_unleashed_filter_upload_size_limit function.
 */
class Test_Upload_Size_Limit extends WP_UnitTestCase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Set up class fixtures.
	 */
	public static function set_up_before_class() {
		parent::set_up_before_class();

		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		WP_Filesystem();

		self::$admin_id = self::factory()->user->create(
			array(
				'role' => 'administrator',
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
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( $data['filename'] ) );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		return $session->create( $data, $request );
	}

	/**
	 * Test that the filter is registered at priority 20.
	 */
	public function test_filter_is_registered() {
		$this->assertSame( 20, has_filter( 'upload_size_limit', 'uploads_unleashed_filter_upload_size_limit' ) );
	}

	/**
	 * Test that the filter uses disk space on single-site.
	 */
	public function test_single_site_uses_disk_space() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'This test is for single-site only.' );
		}

		$upload_dir     = wp_upload_dir();
		$expected_space = disk_free_space( $upload_dir['basedir'] );

		if ( false === $expected_space ) {
			$this->markTestSkipped( 'disk_free_space() not available on this system.' );
		}

		// With no pending uploads, should return disk free space.
		$result = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		// Allow 1 MB tolerance for disk space fluctuation during test.
		$this->assertEqualsWithDelta( $expected_space, $result, MB_IN_BYTES );
	}

	/**
	 * Test that pending uploads are subtracted from available space.
	 */
	public function test_pending_uploads_subtracted() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'This test is for single-site only.' );
		}

		$upload_dir     = wp_upload_dir();
		$expected_space = disk_free_space( $upload_dir['basedir'] );

		if ( false === $expected_space ) {
			$this->markTestSkipped( 'disk_free_space() not available on this system.' );
		}

		// Create a pending upload session.
		$upload_id = $this->create_upload_session(
			array(
				'length' => 10 * MB_IN_BYTES, // 10 MB.
			)
		);

		// Create a .part file so get_total_pending_size() finds it.
		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();
		$path    = $storage->get_path( $upload_id );

		global $wp_filesystem;
		$wp_filesystem->touch( $path );

		$result = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		// Should be disk space minus the pending upload size (10 MB).
		// Allow 1 MB tolerance for disk space fluctuation.
		$this->assertEqualsWithDelta( $expected_space - ( 10 * MB_IN_BYTES ), $result, MB_IN_BYTES );
	}

	/**
	 * Test that multiple pending uploads are all subtracted.
	 */
	public function test_multiple_pending_uploads_subtracted() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'This test is for single-site only.' );
		}

		$upload_dir     = wp_upload_dir();
		$expected_space = disk_free_space( $upload_dir['basedir'] );

		if ( false === $expected_space ) {
			$this->markTestSkipped( 'disk_free_space() not available on this system.' );
		}

		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();

		// Create multiple pending uploads.
		$upload_id_1 = $this->create_upload_session(
			array(
				'filename' => 'test1.txt',
				'length'   => 10 * MB_IN_BYTES, // 10 MB.
			)
		);

		global $wp_filesystem;
		$wp_filesystem->touch( $storage->get_path( $upload_id_1 ) );

		$upload_id_2 = $this->create_upload_session(
			array(
				'filename' => 'test2.txt',
				'length'   => 20 * MB_IN_BYTES, // 20 MB.
			)
		);
		$wp_filesystem->touch( $storage->get_path( $upload_id_2 ) );

		$result = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		// Should be disk space minus both pending upload sizes (30 MB total).
		// Allow 1 MB tolerance for disk space fluctuation.
		$this->assertEqualsWithDelta( $expected_space - ( 30 * MB_IN_BYTES ), $result, MB_IN_BYTES );
	}

	/**
	 * Test that the filter never returns a negative value.
	 */
	public function test_never_returns_negative() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'This test is for single-site only.' );
		}

		$upload_dir = wp_upload_dir();
		if ( false === disk_free_space( $upload_dir['basedir'] ) ) {
			$this->markTestSkipped( 'disk_free_space() not available on this system.' );
		}

		// Create a pending upload larger than available disk space.
		$upload_id = $this->create_upload_session(
			array(
				'filename' => 'huge.txt',
				'length'   => PHP_INT_MAX,
			)
		);

		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();

		global $wp_filesystem;
		$wp_filesystem->touch( $storage->get_path( $upload_id ) );

		$result = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		$this->assertSame( 0, $result );
	}

	/**
	 * Test that expired uploads are not counted.
	 */
	public function test_expired_uploads_not_counted() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'This test is for single-site only.' );
		}

		$upload_dir     = wp_upload_dir();
		$expected_space = disk_free_space( $upload_dir['basedir'] );

		if ( false === $expected_space ) {
			$this->markTestSkipped( 'disk_free_space() not available on this system.' );
		}

		// Create an expired upload by directly setting the transient with past expiry.
		$upload_id    = wp_generate_uuid4();
		$session_data = array(
			'upload_id'  => $upload_id,
			'user_id'    => self::$admin_id,
			'filename'   => 'expired.txt',
			'filetype'   => 'text/plain',
			'length'     => 10 * MB_IN_BYTES, // 10 MB.
			'offset'     => 0,
			'created_at' => time() - DAY_IN_SECONDS * 2,
			'expires_at' => time() - DAY_IN_SECONDS, // Expired yesterday.
		);
		set_transient( 'tus_upload_' . $upload_id, $session_data, DAY_IN_SECONDS );

		// Create the .part file.
		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();

		global $wp_filesystem;
		$wp_filesystem->touch( $storage->get_path( $upload_id ) );

		$result = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		// Expired upload should not be counted.
		// Allow 1 MB tolerance for disk space fluctuation.
		$this->assertEqualsWithDelta( $expected_space, $result, MB_IN_BYTES );
	}

	/**
	 * Test REST API rejects uploads exceeding available space.
	 */
	public function test_rest_api_rejects_oversized_upload() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'This test is for single-site only.' );
		}

		$upload_dir     = wp_upload_dir();
		$expected_space = disk_free_space( $upload_dir['basedir'] );

		if ( false === $expected_space ) {
			$this->markTestSkipped( 'disk_free_space() not available on this system.' );
		}

		// Try to create an upload larger than available space.
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) ( $expected_space + 1024 ) );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'huge.txt' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 413, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_upload_too_large', $data['code'] );
	}
}

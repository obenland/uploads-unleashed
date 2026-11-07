<?php
/**
 * Multisite upload limit tests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

/**
 * Tests that uploads respect the network's upload settings.
 *
 * @group ms-required
 */
class Test_Uploads_Unleashed_Multisite_Upload_Limits extends WP_UnitTestCase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Attachment IDs created during a test.
	 *
	 * @var int[]
	 */
	protected array $attachment_ids = array();

	/**
	 * Creates shared fixtures.
	 *
	 * @param WP_UnitTest_Factory $factory Test factory.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ): void {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	/**
	 * Sets up each test.
	 */
	public function set_up(): void {
		parent::set_up();

		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}

		wp_set_current_user( self::$admin_id );

		/*
		 * The test network is installed from a single site, so core sets
		 * upload_space_check_disabled. Test the default quota mode instead.
		 */
		update_site_option( 'upload_space_check_disabled', 0 );
	}

	/**
	 * Cleans up chunk files and attachments after each test.
	 */
	public function tear_down(): void {
		foreach ( $this->attachment_ids as $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}
		$this->attachment_ids = array();

		$files = glob( trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/*.part' );
		if ( $files ) {
			array_map( 'wp_delete_file', $files );
		}

		parent::tear_down();
	}

	/**
	 * The upload size limit never exceeds the network's "Max upload file size".
	 */
	public function test_upload_size_limit_respects_network_max_file_size(): void {
		update_site_option( 'fileupload_maxk', 2048 );
		$space_allowed = static function (): int {
			return 1000;
		};
		add_filter( 'get_space_allowed', $space_allowed );

		$limit = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		remove_filter( 'get_space_allowed', $space_allowed );

		$this->assertSame( 2048 * KB_IN_BYTES, $limit );
	}

	/**
	 * Creating an upload larger than the network's per-file maximum is rejected.
	 */
	public function test_create_rejects_file_over_network_max_file_size(): void {
		update_site_option( 'fileupload_maxk', 1024 );

		$response = $this->create_upload( 2 * MB_IN_BYTES );

		$this->assertSame( 413, $response->get_status() );
		$this->assertSame( 'rest_upload_file_too_big', $response->get_data()['code'] );
	}

	/**
	 * Creating an upload within the network's per-file maximum succeeds.
	 */
	public function test_create_accepts_file_within_network_max_file_size(): void {
		update_site_option( 'fileupload_maxk', 1024 );

		$response = $this->create_upload( MB_IN_BYTES );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * Finalizing an upload larger than the network's per-file maximum is rejected.
	 *
	 * The maximum can be lowered while an upload is in progress, and
	 * wp_handle_sideload() skips core's check_upload_size().
	 */
	public function test_finalize_rejects_file_over_network_max_file_size(): void {
		$upload_id = $this->get_upload_id( $this->create_upload( 2 * KB_IN_BYTES ) );

		update_site_option( 'fileupload_maxk', 1 );

		$response = $this->patch_upload( $upload_id, str_repeat( 'a', 2 * KB_IN_BYTES ) );
		$this->track_attachment( $response );

		$this->assertSame( 413, $response->get_status() );
		$this->assertSame( 'rest_upload_file_too_big', $response->get_data()['code'] );
	}

	/**
	 * With the space check disabled, the size limit is the per-file maximum alone.
	 *
	 * Neither the site quota nor pending uploads cap it, as in core's
	 * upload_size_limit_filter().
	 */
	public function test_upload_size_limit_ignores_quota_when_space_check_disabled(): void {
		update_site_option( 'upload_space_check_disabled', 1 );
		update_site_option( 'fileupload_maxk', 1024 * 1024 );
		$space_allowed = static function (): int {
			return 10;
		};
		add_filter( 'get_space_allowed', $space_allowed );

		$upload_id = $this->get_upload_id( $this->create_upload( 5 * MB_IN_BYTES ) );
		( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( $upload_id, '', 0 );

		$limit = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		remove_filter( 'get_space_allowed', $space_allowed );

		$this->assertSame( GB_IN_BYTES, $limit );
	}

	/**
	 * With the space check disabled, uploads larger than the site quota can be created.
	 */
	public function test_create_ignores_quota_when_space_check_disabled(): void {
		update_site_option( 'upload_space_check_disabled', 1 );
		update_site_option( 'fileupload_maxk', 1024 * 1024 );
		$space_allowed = static function (): int {
			return 10;
		};
		add_filter( 'get_space_allowed', $space_allowed );

		$response = $this->create_upload( 50 * MB_IN_BYTES );

		remove_filter( 'get_space_allowed', $space_allowed );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * With the space check disabled, finalizing ignores space already used.
	 */
	public function test_finalize_ignores_quota_when_space_check_disabled(): void {
		update_site_option( 'upload_space_check_disabled', 1 );
		$space_allowed = static function (): int {
			return 10;
		};
		$space_used    = static function (): int {
			return 100;
		};
		add_filter( 'get_space_allowed', $space_allowed );
		add_filter( 'pre_get_space_used', $space_used );

		$upload_id = $this->get_upload_id( $this->create_upload( 14 ) );
		$response  = $this->patch_upload( $upload_id, 'test data file' );
		$this->track_attachment( $response );

		remove_filter( 'get_space_allowed', $space_allowed );
		remove_filter( 'pre_get_space_used', $space_used );

		$this->assertSame( 200, $response->get_status() );
	}

	/**
	 * Chunk files don't count toward the site's space used.
	 *
	 * Pending uploads already reserve their full length, so counting the
	 * chunks as well would make an upload need twice its size.
	 */
	public function test_chunk_files_do_not_count_toward_space_used(): void {
		update_site_option( 'fileupload_maxk', 1024 * 1024 );

		delete_transient( 'dirsize_cache' );
		$space_used = get_space_used();

		$upload_id = $this->get_upload_id( $this->create_upload( 2 * MB_IN_BYTES ) );
		$this->patch_upload( $upload_id, str_repeat( 'a', MB_IN_BYTES ) );

		delete_transient( 'dirsize_cache' );

		$this->assertEqualsWithDelta( $space_used, get_space_used(), 0.0001 );
	}

	/**
	 * A chunk directory size cached before it was excluded is ignored.
	 *
	 * Core never invalidates the cached size of the chunk directory, and
	 * with a persistent object cache the cache never expires.
	 */
	public function test_stale_cached_chunk_directory_size_is_ignored(): void {
		$basedir    = untrailingslashit( wp_upload_dir()['basedir'] );
		$chunks_dir = dirname( ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_path( 'id' ) );

		delete_transient( 'dirsize_cache' );
		$size = get_dirsize( $basedir );

		set_transient(
			'dirsize_cache',
			array(
				$chunks_dir => 50 * MB_IN_BYTES,
				$basedir    => $size + 50 * MB_IN_BYTES,
			)
		);

		$this->assertSame( $size, get_dirsize( $basedir ) );
	}

	/**
	 * The size limit subtracts each pending upload once.
	 */
	public function test_upload_size_limit_counts_pending_upload_once(): void {
		update_site_option( 'fileupload_maxk', 1024 * 1024 );
		$space_allowed = static function (): int {
			return 1000;
		};
		add_filter( 'get_space_allowed', $space_allowed );

		delete_transient( 'dirsize_cache' );
		$available = (int) get_upload_space_available();

		$upload_id = $this->get_upload_id( $this->create_upload( 4 * MB_IN_BYTES ) );
		$this->patch_upload( $upload_id, str_repeat( 'a', 2 * MB_IN_BYTES ) );

		delete_transient( 'dirsize_cache' );
		$limit = uploads_unleashed_filter_upload_size_limit( PHP_INT_MAX );

		remove_filter( 'get_space_allowed', $space_allowed );

		$this->assertSame( $available - 4 * MB_IN_BYTES, $limit );
	}

	/**
	 * Finalizing counts the upload once against the quota.
	 */
	public function test_finalize_counts_upload_once_against_quota(): void {
		update_site_option( 'fileupload_maxk', 1024 * 1024 );

		delete_transient( 'dirsize_cache' );
		$space_used    = get_space_used();
		$space_allowed = static function () use ( $space_used ): float {
			return $space_used + 1.5;
		};
		add_filter( 'get_space_allowed', $space_allowed );

		$upload_id = $this->get_upload_id( $this->create_upload( MB_IN_BYTES ) );

		delete_transient( 'dirsize_cache' );
		$response = $this->patch_upload( $upload_id, str_repeat( 'a', MB_IN_BYTES ) );
		$this->track_attachment( $response );

		remove_filter( 'get_space_allowed', $space_allowed );

		$this->assertSame( 200, $response->get_status() );
	}

	/**
	 * Dispatches a TUS creation request.
	 *
	 * @param int    $length   Upload-Length in bytes.
	 * @param string $filename File name sent in the metadata.
	 * @return WP_REST_Response The response.
	 */
	private function create_upload( int $length, string $filename = 'test.txt' ): WP_REST_Response {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) $length );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS protocol requires base64.
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( $filename ) );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Extracts the upload ID from a creation response.
	 *
	 * @param WP_REST_Response $response A 201 creation response.
	 * @return string The upload ID.
	 */
	private function get_upload_id( WP_REST_Response $response ): string {
		$this->assertSame( 201, $response->get_status() );

		return basename( $response->get_headers()['Location'] );
	}

	/**
	 * Dispatches a TUS PATCH request.
	 *
	 * @param string $upload_id The upload ID.
	 * @param string $body      Chunk data.
	 * @param int    $offset    Upload-Offset.
	 * @return WP_REST_Response The response.
	 */
	private function patch_upload( string $upload_id, string $body, int $offset = 0 ): WP_REST_Response {
		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', (string) $offset );
		$request->set_body( $body );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Records an attachment created by a finalizing PATCH for cleanup.
	 *
	 * @param WP_REST_Response $response The PATCH response.
	 */
	private function track_attachment( WP_REST_Response $response ): void {
		$data = $response->get_data();

		if ( 200 === $response->get_status() && isset( $data['id'] ) ) {
			$this->attachment_ids[] = (int) $data['id'];
		}
	}
}

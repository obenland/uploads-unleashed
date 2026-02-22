<?php
/**
 * TUS Chunk Storage tests.
 *
 * @package uploads-unleashed
 */

/**
 * Tests for the Uploads_Unleashed_TUS_Chunk_Storage class.
 */
class Test_Uploads_Unleashed_TUS_Chunk_Storage extends WP_UnitTestCase {

	/**
	 * Storage instance for tests.
	 *
	 * @var Uploads_Unleashed_TUS_Chunk_Storage
	 */
	protected Uploads_Unleashed_TUS_Chunk_Storage $storage;

	/**
	 * Set up each test.
	 */
	public function set_up() {
		parent::set_up();
		$this->storage = new Uploads_Unleashed_TUS_Chunk_Storage();
	}

	/**
	 * Clean up after each test.
	 */
	public function tear_down() {
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';
		$files      = glob( trailingslashit( $chunks_dir ) . '*.part' );

		if ( $files ) {
			array_map( 'wp_delete_file', $files );
		}

		parent::tear_down();
	}


	/**
	 * Tests that get_path returns correct path for valid upload ID.
	 */
	public function test_get_path_returns_correct_path() {
		$upload_id = 'abc123-def456';
		$path      = $this->storage->get_path( $upload_id );

		$this->assertStringContainsString( '.tus-chunks', $path );
		$this->assertStringEndsWith( 'abc123-def456.part', $path );
	}

	/**
	 * Tests that get_path sanitizes directory traversal attempts.
	 */
	public function test_get_path_sanitizes_directory_traversal() {
		$malicious_id = '../../../etc/passwd';
		$path         = $this->storage->get_path( $malicious_id );

		// Directory traversal characters must be removed.
		$this->assertStringNotContainsString( '..', $path );
		// Path must stay within .tus-chunks directory.
		$this->assertStringContainsString( '.tus-chunks', $path );
		// Sanitized ID becomes "etcpasswd" (all special chars removed).
		$this->assertStringEndsWith( 'etcpasswd.part', $path );
		// Verify that the path doesn't escape the base directory.
		$base_dir = wp_upload_dir()['basedir'] . '/.tus-chunks/';
		$this->assertStringStartsWith( $base_dir, $path );
	}

	/**
	 * Tests that get_path removes special characters.
	 */
	public function test_get_path_removes_special_characters() {
		$unsafe_id = 'test<script>alert(1)</script>';
		$path      = $this->storage->get_path( $unsafe_id );

		$this->assertStringNotContainsString( '<', $path );
		$this->assertStringNotContainsString( '>', $path );
		$this->assertStringContainsString( 'testscriptalert1script', $path );
	}

	/**
	 * Tests that append creates file and writes data.
	 */
	public function test_append_creates_file_and_writes_data() {
		$upload_id = wp_generate_uuid4();
		$data      = 'Hello, World!';

		$result = $this->storage->append( $upload_id, $data, 0 );

		$this->assertSame( strlen( $data ), $result );
		$this->assertTrue( $this->storage->exists( $upload_id ) );
		$this->assertSame( strlen( $data ), $this->storage->get_size( $upload_id ) );
	}

	/**
	 * Tests that append returns error on offset mismatch.
	 */
	public function test_append_returns_error_on_offset_mismatch() {
		$upload_id = wp_generate_uuid4();
		$data      = 'Hello';

		// First write some data.
		$this->storage->append( $upload_id, $data, 0 );

		// Try to append with wrong offset.
		$result = $this->storage->append( $upload_id, ' World', 100 );

		$this->assertWPError( $result );
		$this->assertSame( 'tus_chunk_offset_mismatch', $result->get_error_code() );
	}

	/**
	 * Tests that append with correct offset succeeds.
	 */
	public function test_append_with_correct_offset_succeeds() {
		$upload_id = wp_generate_uuid4();

		// First chunk.
		$result1 = $this->storage->append( $upload_id, 'Hello', 0 );
		$this->assertSame( 5, $result1 );

		// Second chunk at correct offset.
		$result2 = $this->storage->append( $upload_id, ' World', 5 );
		$this->assertSame( 11, $result2 );

		$this->assertSame( 11, $this->storage->get_size( $upload_id ) );
	}

	/**
	 * Tests that delete removes the chunk file.
	 */
	public function test_delete_removes_chunk_file() {
		$upload_id = wp_generate_uuid4();

		$this->storage->append( $upload_id, 'test data', 0 );
		$this->assertTrue( $this->storage->exists( $upload_id ) );

		$result = $this->storage->delete( $upload_id );

		$this->assertTrue( $result );
		$this->assertFalse( $this->storage->exists( $upload_id ) );
	}

	/**
	 * Tests that delete returns true for non-existent file.
	 */
	public function test_delete_returns_true_for_nonexistent_file() {
		$upload_id = wp_generate_uuid4();

		$result = $this->storage->delete( $upload_id );

		$this->assertTrue( $result );
	}

	/**
	 * Tests that get_size returns 0 for non-existent file.
	 */
	public function test_get_size_returns_zero_for_nonexistent_file() {
		$upload_id = wp_generate_uuid4();

		$size = $this->storage->get_size( $upload_id );

		$this->assertSame( 0, $size );
	}

	/**
	 * Tests that get_size returns correct size for existing file.
	 */
	public function test_get_size_returns_correct_size() {
		$upload_id = wp_generate_uuid4();
		$data      = str_repeat( 'x', 1024 );

		$this->storage->append( $upload_id, $data, 0 );

		$this->assertSame( 1024, $this->storage->get_size( $upload_id ) );
	}

	/**
	 * Tests that exists returns false for non-existent file.
	 */
	public function test_exists_returns_false_for_nonexistent_file() {
		$upload_id = wp_generate_uuid4();

		$this->assertFalse( $this->storage->exists( $upload_id ) );
	}

	/**
	 * Tests that exists returns true for existing file.
	 */
	public function test_exists_returns_true_for_existing_file() {
		$upload_id = wp_generate_uuid4();

		$this->storage->append( $upload_id, 'test', 0 );

		$this->assertTrue( $this->storage->exists( $upload_id ) );
	}

	/**
	 * Tests that storage directory is created with protection files.
	 */
	public function test_creates_protected_storage_directory() {
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';

		$this->assertDirectoryExists( $chunks_dir );
		$this->assertFileExists( trailingslashit( $chunks_dir ) . '.htaccess' );
		$this->assertFileExists( trailingslashit( $chunks_dir ) . 'index.php' );
	}

	/**
	 * Tests that get_total_pending_size returns 0 when no chunks exist.
	 */
	public function test_get_total_pending_size_returns_zero_when_empty() {
		$size = $this->storage->get_total_pending_size();

		$this->assertSame( 0, $size );
	}

	/**
	 * Tests that get_total_pending_size returns correct sum of session lengths.
	 */
	public function test_get_total_pending_size_returns_correct_sum() {
		$admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin_id );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );

		// Create sessions with specific upload IDs and lengths.
		$upload_id1 = $session->create(
			array(
				'filename' => 'a.txt',
				'length'   => 1000,
			),
			$request
		);
		$upload_id2 = $session->create(
			array(
				'filename' => 'b.txt',
				'length'   => 2000,
			),
			$request
		);
		$upload_id3 = $session->create(
			array(
				'filename' => 'c.txt',
				'length'   => 3000,
			),
			$request
		);

		// Create chunk files (required for glob to find them).
		$this->storage->append( $upload_id1, 'a', 0 );
		$this->storage->append( $upload_id2, 'b', 0 );
		$this->storage->append( $upload_id3, 'c', 0 );

		$total_size = $this->storage->get_total_pending_size();

		// Total is sum of session lengths (1000 + 2000 + 3000).
		$this->assertSame( 6000, $total_size );
	}

	/**
	 * Tests that get_total_pending_size excludes expired sessions.
	 */
	public function test_get_total_pending_size_excludes_expired_sessions() {
		$admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin_id );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );

		// Create a valid session.
		$valid_id = $session->create(
			array(
				'filename' => 'valid.txt',
				'length'   => 1000,
			),
			$request
		);

		// Create an expired session directly via transient.
		$expired_id   = wp_generate_uuid4();
		$session_data = array(
			'upload_id'  => $expired_id,
			'user_id'    => $admin_id,
			'filename'   => 'expired.txt',
			'filetype'   => 'text/plain',
			'length'     => 5000,
			'offset'     => 0,
			'created_at' => time() - DAY_IN_SECONDS * 2,
			'expires_at' => time() - DAY_IN_SECONDS, // Expired.
		);
		set_transient( 'tus_upload_' . $expired_id, $session_data, DAY_IN_SECONDS );

		// Create chunk files for both.
		$this->storage->append( $valid_id, 'a', 0 );
		$this->storage->append( $expired_id, 'b', 0 );

		$total_size = $this->storage->get_total_pending_size();

		// Only the valid session's length should be counted.
		$this->assertSame( 1000, $total_size );
	}

	/**
	 * Tests that cleanup_expired returns early when no .part files exist.
	 *
	 * Covers line 248 (no files early return).
	 */
	public function test_cleanup_expired_no_files_returns_early() {
		// Ensure no .part files exist.
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';
		$files      = glob( trailingslashit( $chunks_dir ) . '*.part' );
		if ( $files ) {
			array_map( 'wp_delete_file', $files );
		}

		// This should return without error and without iterating any files.
		Uploads_Unleashed_TUS_Chunk_Storage::cleanup_expired();

		// If we get here without error, the early return worked.
		$this->assertTrue( true );
	}

	/**
	 * Tests that delete_all handles the is_array check for glob results.
	 *
	 * Covers line 283 (is_array check continue in delete_all).
	 */
	public function test_delete_all_cleans_up_files_and_directory() {
		$upload_id = wp_generate_uuid4();

		// Create a chunk file.
		$this->storage->append( $upload_id, 'test data', 0 );
		$this->assertTrue( $this->storage->exists( $upload_id ) );

		// delete_all should remove everything.
		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';
		$this->assertDirectoryDoesNotExist( $chunks_dir );

		// Re-create the storage directory for subsequent tests.
		$this->storage = new Uploads_Unleashed_TUS_Chunk_Storage();
	}

	/**
	 * Tests that append returns WP_Error when fopen fails.
	 *
	 * Covers line 106 (fopen failure path).
	 */
	public function test_append_returns_error_when_fopen_fails() {
		// Use reflection to temporarily set base_dir to a non-existent path.
		$reflection = new ReflectionClass( 'Uploads_Unleashed_TUS_Chunk_Storage' );
		$prop       = $reflection->getProperty( 'base_dir' );
		$prop->setAccessible( true );
		$original_base_dir = $prop->getValue();
		$prop->setValue( null, '/non/existent/path/' );

		try {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Suppressing fopen warning to test error return path.
			$result = @$this->storage->append( 'test-id', 'data', 0 );
		} finally {
			$prop->setValue( null, $original_base_dir );
		}

		$this->assertWPError( $result );
		$this->assertSame( 'tus_chunk_open_failed', $result->get_error_code() );
	}

	/**
	 * Tests that get_total_pending_size excludes chunks without valid sessions.
	 */
	public function test_get_total_pending_size_excludes_orphaned_chunks() {
		$admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin_id );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );

		// Create one with session, one without.
		$upload_id_with_session = $session->create(
			array(
				'filename' => 'valid.txt',
				'length'   => 1000,
			),
			$request
		);
		$orphan_upload_id       = wp_generate_uuid4();

		$this->storage->append( $upload_id_with_session, str_repeat( 'a', 500 ), 0 );
		$this->storage->append( $orphan_upload_id, str_repeat( 'b', 2000 ), 0 );

		$total_size = $this->storage->get_total_pending_size();

		// Only the session length counts, not file size. Orphan is excluded.
		$this->assertSame( 1000, $total_size );
	}
}

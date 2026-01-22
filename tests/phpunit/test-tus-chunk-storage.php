<?php
/**
 * TUS Chunk Storage tests.
 *
 * @package resumable-uploads
 */

/**
 * Tests for the TUS_Chunk_Storage class.
 */
class Test_TUS_Chunk_Storage extends WP_UnitTestCase {

	/**
	 * Storage instance for tests.
	 *
	 * @var TUS_Chunk_Storage
	 */
	protected TUS_Chunk_Storage $storage;

	/**
	 * Set up each test.
	 */
	public function set_up() {
		parent::set_up();
		$this->storage = new TUS_Chunk_Storage();
	}

	/**
	 * Clean up after each test.
	 */
	public function tear_down() {
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
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks';

		if ( is_dir( $chunks_dir ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation in tests.
			@unlink( trailingslashit( $chunks_dir ) . '.htaccess' );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation in tests.
			@unlink( trailingslashit( $chunks_dir ) . 'index.php' );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation in tests.
			@rmdir( $chunks_dir );
		}

		parent::tear_down_after_class();
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
	 * Tests that cleanup is an alias for delete.
	 */
	public function test_cleanup_is_alias_for_delete() {
		$upload_id = wp_generate_uuid4();

		$this->storage->append( $upload_id, 'test data', 0 );
		$this->assertTrue( $this->storage->exists( $upload_id ) );

		$result = $this->storage->cleanup( $upload_id );

		$this->assertTrue( $result );
		$this->assertFalse( $this->storage->exists( $upload_id ) );
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
}

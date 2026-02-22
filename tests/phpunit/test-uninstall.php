<?php
/**
 * Uninstall cleanup tests.
 *
 * @package uploads-unleashed
 */

/**
 * Tests for the plugin uninstall cleanup methods.
 */
class Test_Uninstall extends WP_UnitTestCase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Set up class fixtures.
	 *
	 * @param WP_UnitTest_Factory $factory Test factory.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	/**
	 * Tests that delete_all removes .part files.
	 */
	public function test_chunk_storage_delete_all_removes_part_files() {
		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();

		$storage->append( wp_generate_uuid4(), 'data1', 0 );
		$storage->append( wp_generate_uuid4(), 'data2', 0 );

		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';
		$this->assertCount( 2, glob( $chunks_dir . '*.part' ) );

		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$this->assertEmpty( glob( $chunks_dir . '*.part' ) );
	}

	/**
	 * Tests that delete_all removes protection files.
	 */
	public function test_chunk_storage_delete_all_removes_protection_files() {
		new Uploads_Unleashed_TUS_Chunk_Storage();

		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';
		$this->assertFileExists( $chunks_dir . '.htaccess' );
		$this->assertFileExists( $chunks_dir . 'index.php' );

		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$this->assertFileDoesNotExist( $chunks_dir . '.htaccess' );
		$this->assertFileDoesNotExist( $chunks_dir . 'index.php' );
	}

	/**
	 * Tests that delete_all removes the directory.
	 */
	public function test_chunk_storage_delete_all_removes_directory() {
		new Uploads_Unleashed_TUS_Chunk_Storage();

		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';
		$this->assertDirectoryExists( $chunks_dir );

		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$this->assertDirectoryDoesNotExist( $chunks_dir );
	}

	/**
	 * Tests that delete_all succeeds when directory does not exist.
	 */
	public function test_chunk_storage_delete_all_succeeds_when_no_directory() {
		// Ensure a clean state by deleting any existing directory.
		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';
		$this->assertDirectoryDoesNotExist( $chunks_dir );

		// Calling delete_all again should not error.
		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();
	}

	/**
	 * Tests that delete_all does not recreate the directory.
	 */
	public function test_chunk_storage_delete_all_does_not_recreate_directory() {
		new Uploads_Unleashed_TUS_Chunk_Storage();

		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';
		$this->assertDirectoryDoesNotExist( $chunks_dir );
	}

	/**
	 * Tests that delete_all removes all session transients.
	 */
	public function test_upload_session_delete_all_removes_transients() {
		wp_set_current_user( self::$admin_id );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );

		$id1 = $session->create(
			array(
				'filename' => 'a.txt',
				'length'   => 100,
			),
			$request
		);
		$id2 = $session->create(
			array(
				'filename' => 'b.txt',
				'length'   => 200,
			),
			$request
		);

		$this->assertNotNull( $session->get( $id1 ) );
		$this->assertNotNull( $session->get( $id2 ) );

		Uploads_Unleashed_TUS_Upload_Session::delete_all();

		// Verify rows are gone from the database.
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$remaining = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s",
				$wpdb->esc_like( '_transient_tus_upload_' ) . '%'
			)
		);
		$this->assertSame( '0', $remaining );
	}

	/**
	 * Tests that delete_all succeeds when no transients exist.
	 */
	public function test_upload_session_delete_all_succeeds_when_empty() {
		Uploads_Unleashed_TUS_Upload_Session::delete_all();

		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$remaining = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s",
				$wpdb->esc_like( '_transient_tus_upload_' ) . '%'
			)
		);
		$this->assertSame( '0', $remaining );
	}

	/**
	 * Tests that uninstall.php runs cleanup on single site.
	 *
	 * Covers the single-site branch in uninstall.php (lines 44-47).
	 */
	public function test_uninstall_script_runs_single_site_cleanup() {
		if ( is_multisite() ) {
			$this->markTestSkipped( 'Single-site only test.' );
		}

		wp_set_current_user( self::$admin_id );

		// Create data that uninstall should clean up.
		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();
		$storage->append( wp_generate_uuid4(), 'data', 0 );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$session->create(
			array(
				'filename' => 'test.txt',
				'length'   => 100,
			),
			$request
		);

		wp_schedule_event( time(), 'twicedaily', 'uploads_unleashed_cleanup' );
		$this->assertNotFalse( wp_next_scheduled( 'uploads_unleashed_cleanup' ) );

		// Define WP_UNINSTALL_PLUGIN if not already defined.
		if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
			define( 'WP_UNINSTALL_PLUGIN', 'uploads-unleashed/uploads-unleashed.php' );
		}

		// Run uninstall script.
		include dirname( __DIR__, 2 ) . '/uninstall.php';

		// Verify cleanup happened.
		$chunks_dir = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';
		$this->assertDirectoryDoesNotExist( $chunks_dir );
		$this->assertFalse( wp_next_scheduled( 'uploads_unleashed_cleanup' ) );

		// Re-create the directory for subsequent tests.
		new Uploads_Unleashed_TUS_Chunk_Storage();
	}

	/**
	 * Tests that delete_all does not affect other transients.
	 */
	public function test_upload_session_delete_all_preserves_other_transients() {
		set_transient( 'unrelated_transient', 'value', HOUR_IN_SECONDS );

		wp_set_current_user( self::$admin_id );

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$session->create(
			array(
				'filename' => 'test.txt',
				'length'   => 100,
			),
			$request
		);

		Uploads_Unleashed_TUS_Upload_Session::delete_all();

		$this->assertSame( 'value', get_transient( 'unrelated_transient' ) );

		delete_transient( 'unrelated_transient' );
	}
}

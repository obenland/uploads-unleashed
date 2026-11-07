<?php
/**
 * WP-CLI command tests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

require_once dirname( __DIR__ ) . '/stubs/class-wp-cli.php';
require_once dirname( __DIR__ ) . '/stubs/wp-cli-utils.php';
require_once dirname( __DIR__, 2 ) . '/includes/class-uploads-unleashed-cli-command.php';

/**
 * Tests for the `wp tus` command.
 *
 * @covers Uploads_Unleashed_CLI_Command
 */
class Test_CLI_Command extends WP_UnitTestCase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * The command under test.
	 *
	 * @var Uploads_Unleashed_CLI_Command
	 */
	protected Uploads_Unleashed_CLI_Command $command;

	/**
	 * Chunk storage.
	 *
	 * @var Uploads_Unleashed_TUS_Chunk_Storage
	 */
	protected Uploads_Unleashed_TUS_Chunk_Storage $storage;

	/**
	 * Upload sessions.
	 *
	 * @var Uploads_Unleashed_TUS_Upload_Session
	 */
	protected Uploads_Unleashed_TUS_Upload_Session $session;

	/**
	 * Creates the administrator who owns the uploads.
	 *
	 * @param WP_UnitTest_Factory $factory Test factory.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ): void {
		self::$admin_id = $factory->user->create(
			array(
				'role'       => 'administrator',
				'user_login' => 'tus_cli_admin',
			)
		);
	}

	/**
	 * Starts every test with no upload sessions and no recorded output.
	 */
	public function set_up(): void {
		parent::set_up();

		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();
		WP_CLI::reset();
		wp_set_current_user( self::$admin_id );

		$this->command = new Uploads_Unleashed_CLI_Command();
		$this->storage = new Uploads_Unleashed_TUS_Chunk_Storage();
		$this->session = new Uploads_Unleashed_TUS_Upload_Session();
	}

	/**
	 * Removes the chunk files the test left behind.
	 */
	public function tear_down(): void {
		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		parent::tear_down();
	}

	/**
	 * Creates an upload session with a chunk file holding its first bytes.
	 *
	 * @param string $filename Filename.
	 * @param int    $length   Upload length in bytes.
	 * @param int    $offset   Bytes received so far.
	 * @return string Upload ID.
	 */
	protected function create_upload( string $filename, int $length, int $offset ): string {
		$upload_id = $this->session->create(
			array(
				'filename' => $filename,
				'length'   => $length,
			),
			new WP_REST_Request( 'POST', '/wp/v2/media' )
		);

		$this->storage->append( $upload_id, str_repeat( 'a', $offset ), 0 );
		$this->session->update_offset( $upload_id, $offset );

		return $upload_id;
	}

	/**
	 * Creates an upload session that expired an hour ago, with a chunk file.
	 *
	 * @return string Upload ID.
	 */
	protected function create_expired_upload(): string {
		$upload_id = wp_generate_uuid4();

		set_transient(
			Uploads_Unleashed_TUS_Upload_Session::TRANSIENT_PREFIX . $upload_id,
			array(
				'upload_id'  => $upload_id,
				'user_id'    => self::$admin_id,
				'filename'   => 'expired.txt',
				'filetype'   => 'text/plain',
				'length'     => 100,
				'offset'     => 10,
				'created_at' => time() - DAY_IN_SECONDS - HOUR_IN_SECONDS,
				'expires_at' => time() - HOUR_IN_SECONDS,
			),
			DAY_IN_SECONDS
		);
		$this->storage->append( $upload_id, str_repeat( 'a', 10 ), 0 );

		return $upload_id;
	}

	/**
	 * Tests that list reports when there are no uploads.
	 */
	public function test_list_without_sessions(): void {
		$this->command->list_( array(), array() );

		$this->assertSame( array( array( 'success', 'No active upload sessions.' ) ), WP_CLI::$output );
	}

	/**
	 * Tests that list formats active sessions in the requested format.
	 */
	public function test_list_formats_active_sessions(): void {
		// Away from an hour boundary, so a second passing can't change the rounded time.
		$expires_at       = time() + 3 * HOUR_IN_SECONDS + 10 * MINUTE_IN_SECONDS;
		$expires_callback = function ( array $session_data ) use ( $expires_at ): array {
			$session_data['expires_at'] = $expires_at;
			return $session_data;
		};
		add_filter( 'uploads_unleashed_session_data', $expires_callback );

		$upload_id = $this->create_upload( 'movie.mp4', 4 * KB_IN_BYTES, KB_IN_BYTES );

		remove_filter( 'uploads_unleashed_session_data', $expires_callback );

		$this->command->list_( array(), array( 'format' => 'json' ) );

		$this->assertCount( 1, WP_CLI::$output );
		list( $type, $data ) = WP_CLI::$output[0];

		$this->assertSame( 'items', $type );
		$this->assertSame( 'json', $data['format'] );
		$this->assertSame( array( 'upload_id', 'filename', 'size', 'progress', 'user', 'expires' ), $data['fields'] );
		$this->assertSame(
			array(
				array(
					'upload_id' => $upload_id,
					'filename'  => 'movie.mp4',
					'size'      => size_format( 4 * KB_IN_BYTES ),
					'progress'  => '25%',
					'user'      => 'tus_cli_admin',
					'expires'   => human_time_diff( time(), $expires_at ),
				),
			),
			$data['items']
		);
	}

	/**
	 * Tests that list defaults to a table.
	 */
	public function test_list_defaults_to_table(): void {
		$this->create_upload( 'photo.jpg', 100, 50 );

		$this->command->list_( array(), array() );

		$this->assertSame( 'table', WP_CLI::$output[0][1]['format'] );
	}

	/**
	 * Tests that list shows the user ID when the user no longer exists.
	 */
	public function test_list_shows_id_of_deleted_user(): void {
		$user_id = self::factory()->user->create();
		wp_set_current_user( $user_id );
		$this->create_upload( 'orphan.txt', 100, 0 );

		self::delete_user( $user_id );

		$this->command->list_( array(), array() );

		$item = WP_CLI::$output[0][1]['items'][0];
		$this->assertSame( '#' . $user_id, $item['user'] );
		$this->assertSame( '0%', $item['progress'] );
	}

	/**
	 * Tests that list leaves out expired sessions.
	 */
	public function test_list_skips_expired_sessions(): void {
		$this->create_expired_upload();
		$active_id = $this->create_upload( 'active.txt', 100, 0 );

		$this->command->list_( array(), array() );

		$items = WP_CLI::$output[0][1]['items'];
		$this->assertSame( array( $active_id ), wp_list_pluck( $items, 'upload_id' ) );
	}

	/**
	 * Tests that cancel deletes the session and its chunk file.
	 */
	public function test_cancel_deletes_session_and_chunks(): void {
		$upload_id = $this->create_upload( 'cancel-me.txt', 100, 10 );
		$other_id  = $this->create_upload( 'keep-me.txt', 100, 10 );

		$this->command->cancel( array( $upload_id ), array() );

		$this->assertNull( $this->session->get( $upload_id ) );
		$this->assertFalse( $this->storage->exists( $upload_id ) );
		$this->assertNotNull( $this->session->get( $other_id ) );
		$this->assertTrue( $this->storage->exists( $other_id ) );
		$this->assertSame(
			array( array( 'success', sprintf( 'Canceled upload session %s (cancel-me.txt).', $upload_id ) ) ),
			WP_CLI::$output
		);
	}

	/**
	 * Tests that cancel errors on an unknown upload ID.
	 */
	public function test_cancel_unknown_session_errors(): void {
		$upload_id = wp_generate_uuid4();

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( sprintf( 'Upload session %s not found.', $upload_id ) );

		$this->command->cancel( array( $upload_id ), array() );
	}

	/**
	 * Tests that cancel leaves the chunk file alone when the session is unknown.
	 */
	public function test_cancel_unknown_session_keeps_chunk_file(): void {
		$upload_id = wp_generate_uuid4();
		$this->storage->append( $upload_id, 'data', 0 );

		try {
			$this->command->cancel( array( $upload_id ), array() );
			$this->fail( 'Expected WP_CLI::error().' );
		} catch ( RuntimeException $e ) {
			$this->assertTrue( $this->storage->exists( $upload_id ) );
			$this->assertSame( array(), WP_CLI::$output );
		}
	}

	/**
	 * Tests that cleanup deletes expired and orphaned uploads only.
	 */
	public function test_cleanup_removes_expired_uploads(): void {
		$expired_id = $this->create_expired_upload();
		$orphan_id  = wp_generate_uuid4();
		$this->storage->append( $orphan_id, 'data', 0 );
		$active_id = $this->create_upload( 'active.txt', 100, 10 );

		$this->command->cleanup( array(), array() );

		$this->assertFalse( $this->storage->exists( $expired_id ) );
		$this->assertNull( $this->session->get( $expired_id ) );
		$this->assertFalse( $this->storage->exists( $orphan_id ) );
		$this->assertTrue( $this->storage->exists( $active_id ) );
		$this->assertNotNull( $this->session->get( $active_id ) );
		$this->assertSame( array( array( 'success', 'Expired uploads cleaned up.' ) ), WP_CLI::$output );
	}

	/**
	 * Tests that cleanup succeeds when there is nothing to clean up.
	 */
	public function test_cleanup_without_uploads(): void {
		$this->command->cleanup( array(), array() );

		$this->assertSame( array( array( 'success', 'Expired uploads cleaned up.' ) ), WP_CLI::$output );
	}
}

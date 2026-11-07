<?php
/**
 * Chunk directory resolution tests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

require_once __DIR__ . '/includes/class-uploads-unleashed-test-stream-wrapper.php';

/**
 * Tests where chunks are stored, and that uploads work when the uploads
 * directory is a stream wrapper.
 *
 * @since 1.2.0
 */
class Test_Uploads_Unleashed_Chunk_Dir extends WP_UnitTestCase {

	/**
	 * Administrator user ID.
	 *
	 * @since 1.2.0
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Local directory the test stream wrapper maps onto.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	private string $wrapper_root = '';

	/**
	 * Custom chunk directory used by the filter tests.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	private string $custom_dir = '';

	/**
	 * Filter callback that points the uploads directory at the stream wrapper.
	 *
	 * @since 1.2.0
	 * @var callable
	 */
	private $upload_dir_filter;

	/**
	 * Filter callback that points the chunk directory at $custom_dir.
	 *
	 * @since 1.2.0
	 * @var callable
	 */
	private $chunk_dir_filter;

	/**
	 * Set up class fixtures.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_UnitTest_Factory $factory Test factory.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ): void {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	/**
	 * Set up each test.
	 *
	 * @since 1.2.0
	 */
	public function set_up(): void {
		parent::set_up();

		$this->wrapper_root = trailingslashit( get_temp_dir() ) . 'uu-wrapper-' . wp_generate_password( 8, false );
		$this->custom_dir   = trailingslashit( get_temp_dir() ) . 'uu-custom-' . wp_generate_password( 8, false );
		wp_mkdir_p( $this->wrapper_root );
		Uploads_Unleashed_Test_Stream_Wrapper::register( $this->wrapper_root );

		$this->upload_dir_filter = static function ( array $uploads ): array {
			$uploads['path']    = 'uutest://uploads' . $uploads['subdir'];
			$uploads['basedir'] = 'uutest://uploads';
			$uploads['url']     = 'https://cdn.example.com/uploads' . $uploads['subdir'];
			$uploads['baseurl'] = 'https://cdn.example.com/uploads';

			return $uploads;
		};

		$custom_dir             = $this->custom_dir;
		$this->chunk_dir_filter = static function () use ( $custom_dir ): string {
			return $custom_dir;
		};

		$this->reset_cached_chunk_dir();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * Clean up after each test.
	 *
	 * @since 1.2.0
	 */
	public function tear_down(): void {
		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		remove_filter( 'upload_dir', $this->upload_dir_filter );
		remove_filter( 'uploads_unleashed_chunk_dir', $this->chunk_dir_filter );

		$this->delete_tree( $this->wrapper_root );
		$this->delete_tree( $this->custom_dir );

		Uploads_Unleashed_Test_Stream_Wrapper::unregister();
		$this->reset_cached_chunk_dir();

		parent::tear_down();
	}

	/**
	 * Tests that chunks stay in the uploads directory when it's local.
	 *
	 * @since 1.2.0
	 */
	public function test_chunk_dir_defaults_to_local_uploads_dir(): void {
		$expected = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';

		$this->assertSame( $expected, Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() );
		$this->assertStringStartsWith( $expected, ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_path( 'abc' ) );
	}

	/**
	 * Tests that chunks go to a local directory when the uploads directory is a stream wrapper.
	 *
	 * @since 1.2.0
	 */
	public function test_chunk_dir_is_local_when_uploads_dir_is_stream_wrapper(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );

		$path = ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_path( 'abc' );

		$this->assertFalse( wp_is_stream( $path ), 'Chunk path must not use a stream wrapper.' );
		$this->assertStringStartsWith( trailingslashit( get_temp_dir() ), $path );
	}

	/**
	 * Tests that the temp chunk directory differs per uploads directory, so sites don't share it.
	 *
	 * @since 1.2.0
	 */
	public function test_temp_chunk_dir_is_unique_per_uploads_dir(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );
		$first = Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir();

		$other_site = static function ( array $uploads ): array {
			$uploads['basedir'] .= '/sites/2';

			return $uploads;
		};
		add_filter( 'upload_dir', $other_site, 11 );
		$second = Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir();
		remove_filter( 'upload_dir', $other_site, 11 );

		$this->assertNotSame( $first, $second );
	}

	/**
	 * Tests that the temp chunk directory isn't readable by other users.
	 *
	 * @since 1.2.0
	 */
	public function test_temp_chunk_dir_is_private(): void {
		if ( 'WIN' === strtoupper( substr( PHP_OS, 0, 3 ) ) ) {
			$this->markTestSkipped( 'POSIX permissions are not available on Windows.' );
		}

		add_filter( 'upload_dir', $this->upload_dir_filter );
		new Uploads_Unleashed_TUS_Chunk_Storage();

		clearstatcache();
		$this->assertSame( '0700', substr( sprintf( '%o', fileperms( Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() ) ), -4 ) );
	}

	/**
	 * Tests that chunks can be appended when the uploads directory is a stream wrapper.
	 *
	 * @since 1.2.0
	 */
	public function test_append_works_when_uploads_dir_is_stream_wrapper(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );

		$storage   = new Uploads_Unleashed_TUS_Chunk_Storage();
		$upload_id = wp_generate_uuid4();

		$this->assertSame( 5, $storage->append( $upload_id, 'Hello', 0 ) );
		$this->assertSame( 11, $storage->append( $upload_id, ' World', 5 ) );
		$this->assertSame( 11, $storage->get_size( $upload_id ) );
	}

	/**
	 * Tests that cleanup finds orphaned chunks when the uploads directory is a stream wrapper.
	 *
	 * @since 1.2.0
	 */
	public function test_cleanup_removes_orphans_when_uploads_dir_is_stream_wrapper(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );

		$storage   = new Uploads_Unleashed_TUS_Chunk_Storage();
		$upload_id = wp_generate_uuid4();
		$path      = $storage->get_path( $upload_id );

		// No session exists for this chunk, so it's an orphan.
		file_put_contents( $path, 'orphan' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		$this->assertFileExists( $path );

		Uploads_Unleashed_TUS_Chunk_Storage::cleanup_expired();

		$this->assertFileDoesNotExist( $path );
	}

	/**
	 * Tests that a completed upload is moved into a stream-wrapper uploads directory.
	 *
	 * @since 1.2.0
	 */
	public function test_complete_upload_moves_file_into_stream_wrapper_uploads_dir(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', '9' );

		$upload_id = ( new Uploads_Unleashed_TUS_Upload_Session() )->create(
			array(
				'filename' => 'wrapped.txt',
				'filetype' => 'text/plain',
				'length'   => 9,
			),
			$request
		);

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . $upload_id );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( 'test data' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status(), wp_json_encode( $response->get_data() ) );

		$file = get_attached_file( $response->get_data()['id'] );
		$this->assertStringStartsWith( 'uutest://uploads/', $file );
		$this->assertSame( 'test data', file_get_contents( Uploads_Unleashed_Test_Stream_Wrapper::local_path( $file ) ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$this->assertFalse( ( new Uploads_Unleashed_TUS_Chunk_Storage() )->exists( $upload_id ) );
	}

	/**
	 * Tests that the uploads_unleashed_chunk_dir filter moves chunk storage.
	 *
	 * @since 1.2.0
	 */
	public function test_chunk_dir_filter_changes_storage_location(): void {
		add_filter( 'uploads_unleashed_chunk_dir', $this->chunk_dir_filter );

		$storage   = new Uploads_Unleashed_TUS_Chunk_Storage();
		$upload_id = wp_generate_uuid4();
		$storage->append( $upload_id, 'data', 0 );

		$this->assertSame( trailingslashit( $this->custom_dir ), Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() );
		$this->assertFileExists( trailingslashit( $this->custom_dir ) . $upload_id . '.part' );
	}

	/**
	 * Tests that the filter takes precedence over the stream wrapper fallback.
	 *
	 * @since 1.2.0
	 */
	public function test_chunk_dir_filter_overrides_stream_wrapper_default(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );
		add_filter( 'uploads_unleashed_chunk_dir', $this->chunk_dir_filter );

		$this->assertSame( trailingslashit( $this->custom_dir ), Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() );
	}

	/**
	 * Tests that cleanup looks in the filtered chunk directory.
	 *
	 * @since 1.2.0
	 */
	public function test_cleanup_uses_filtered_chunk_dir(): void {
		add_filter( 'uploads_unleashed_chunk_dir', $this->chunk_dir_filter );

		$storage   = new Uploads_Unleashed_TUS_Chunk_Storage();
		$upload_id = wp_generate_uuid4();
		$storage->append( $upload_id, 'orphan', 0 );

		Uploads_Unleashed_TUS_Chunk_Storage::cleanup_expired();

		$this->assertFileDoesNotExist( trailingslashit( $this->custom_dir ) . $upload_id . '.part' );
	}

	/**
	 * Tests that uninstall removes the filtered chunk directory.
	 *
	 * @since 1.2.0
	 */
	public function test_delete_all_removes_filtered_chunk_dir(): void {
		add_filter( 'uploads_unleashed_chunk_dir', $this->chunk_dir_filter );

		( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( wp_generate_uuid4(), 'data', 0 );
		$this->assertDirectoryExists( $this->custom_dir );

		Uploads_Unleashed_TUS_Chunk_Storage::delete_all();

		$this->assertDirectoryDoesNotExist( $this->custom_dir );
	}

	/**
	 * Tests that .htaccess denies access on both Apache 2.2 and 2.4.
	 *
	 * @since 1.2.0
	 */
	public function test_htaccess_denies_access_on_apache_22_and_24(): void {
		new Uploads_Unleashed_TUS_Chunk_Storage();

		$htaccess = file_get_contents( Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() . '.htaccess' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents

		$this->assertStringContainsString( "<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>", $htaccess );
		$this->assertStringContainsString( "<IfModule !mod_authz_core.c>\n\tOrder deny,allow\n\tDeny from all\n</IfModule>", $htaccess );
	}

	/**
	 * Tests that an .htaccess from an older version is replaced with the Apache 2.4 rules.
	 *
	 * @since 1.2.0
	 */
	public function test_outdated_htaccess_is_updated(): void {
		new Uploads_Unleashed_TUS_Chunk_Storage();

		$htaccess_file = Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() . '.htaccess';
		file_put_contents( $htaccess_file, "Deny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents

		$this->reset_cached_chunk_dir();
		new Uploads_Unleashed_TUS_Chunk_Storage();

		$this->assertStringContainsString( 'Require all denied', file_get_contents( $htaccess_file ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	}

	/**
	 * Clears the chunk directory cached by Uploads_Unleashed_TUS_Chunk_Storage.
	 *
	 * @since 1.2.0
	 */
	private function reset_cached_chunk_dir(): void {
		$property = new ReflectionProperty( Uploads_Unleashed_TUS_Chunk_Storage::class, 'base_dir' );
		$property->setAccessible( true );
		$property->setValue( null, null );
	}

	/**
	 * Recursively deletes a local directory.
	 *
	 * @since 1.2.0
	 *
	 * @param string $dir The directory.
	 */
	private function delete_tree( string $dir ): void {
		if ( ! is_dir( $dir ) ) {
			return;
		}

		$items = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::CHILD_FIRST
		);

		foreach ( $items as $item ) {
			if ( $item->isDir() ) {
				rmdir( $item->getPathname() ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
			} else {
				wp_delete_file( $item->getPathname() );
			}
		}

		rmdir( $dir ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	}
}

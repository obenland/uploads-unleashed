<?php
/**
 * Chunk directory resolution tests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

require_once __DIR__ . '/includes/class-uploads-unleashed-test-stream-wrapper.php';

/**
 * Tests where chunks are stored, including when the uploads directory is a stream wrapper.
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
		// wp_upload_dir() only creates each path once per request, so create this test's month directory itself.
		wp_mkdir_p( $this->wrapper_root . '/uploads' . wp_upload_dir( null, false )['subdir'] );
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
		if ( is_file( $this->custom_dir ) ) {
			wp_delete_file( $this->custom_dir );
		}

		Uploads_Unleashed_Test_Stream_Wrapper::unregister();
		$this->reset_cached_chunk_dir();

		parent::tear_down();
	}

	/**
	 * Tests that chunks are stored in the uploads directory by default.
	 *
	 * @since 1.2.0
	 */
	public function test_chunk_dir_defaults_to_uploads_dir(): void {
		$expected = trailingslashit( wp_upload_dir()['basedir'] ) . '.tus-chunks/';

		$this->assertSame( $expected, Uploads_Unleashed_TUS_Chunk_Storage::get_chunk_dir() );
		$this->assertStringStartsWith( $expected, ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_path( 'abc' ) );
	}

	/**
	 * Tests that creating an upload fails clearly when chunks would go to a stream wrapper.
	 *
	 * Stream wrappers like S3-Uploads (`s3://`) or VIP (`vip://`) don't support
	 * flock() or glob(), so every chunk would fail mid-upload.
	 *
	 * @since 1.2.0
	 */
	public function test_create_upload_fails_when_chunk_dir_is_stream_wrapper(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );

		$response = rest_get_server()->dispatch( $this->create_request( 9 ) );

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame( 'tus_chunk_dir_not_local', $response->get_data()['code'] );
		$this->assertStringContainsString( 'uploads_unleashed_chunk_dir', $response->get_data()['message'] );

		// Nothing was written to the remote uploads directory.
		$this->assertDirectoryDoesNotExist( $this->wrapper_root . '/uploads/.tus-chunks' );
	}

	/**
	 * Tests that creating an upload fails clearly when the chunk directory can't be created.
	 *
	 * @since 1.2.0
	 */
	public function test_create_upload_fails_when_chunk_dir_is_not_writable(): void {
		// A file where the directory's parent should be, so the directory can't be created.
		file_put_contents( $this->custom_dir, '' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		$custom_dir       = $this->custom_dir;
		$chunk_dir_filter = static function () use ( $custom_dir ): string {
			return $custom_dir . '/chunks';
		};
		add_filter( 'uploads_unleashed_chunk_dir', $chunk_dir_filter );

		$response = rest_get_server()->dispatch( $this->create_request( 9 ) );
		remove_filter( 'uploads_unleashed_chunk_dir', $chunk_dir_filter );

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame( 'tus_chunk_dir_not_writable', $response->get_data()['code'] );
	}

	/**
	 * Tests that a local chunk directory makes uploads work with a stream-wrapper uploads dir.
	 *
	 * Finalization has to copy the file from the local chunk directory into the wrapper.
	 *
	 * @since 1.2.0
	 */
	public function test_upload_completes_into_stream_wrapper_uploads_dir_with_local_chunk_dir(): void {
		add_filter( 'upload_dir', $this->upload_dir_filter );
		add_filter( 'uploads_unleashed_chunk_dir', $this->chunk_dir_filter );

		$response = rest_get_server()->dispatch( $this->create_request( 9 ) );
		$this->assertSame( 201, $response->get_status(), wp_json_encode( $response->get_data() ) );

		$upload_id = basename( $response->get_headers()['Location'] );

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
	 * Builds a TUS creation request.
	 *
	 * @since 1.2.0
	 *
	 * @param int $length The upload length.
	 * @return WP_REST_Request The request.
	 */
	private function create_request( int $length ): WP_REST_Request {
		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) $length );
		$request->set_header( 'Upload-Metadata', 'filename ' . base64_encode( 'wrapped.txt' ) . ',filetype ' . base64_encode( 'text/plain' ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- TUS metadata is base64-encoded.

		return $request;
	}

	/**
	 * Clears the chunk directory cached by Uploads_Unleashed_TUS_Chunk_Storage.
	 *
	 * @since 1.2.0
	 */
	private function reset_cached_chunk_dir(): void {
		$property = new ReflectionProperty( Uploads_Unleashed_TUS_Chunk_Storage::class, 'base_dir' );
		if ( PHP_VERSION_ID < 80100 ) {
			$property->setAccessible( true );
		}
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

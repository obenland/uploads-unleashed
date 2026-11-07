<?php
/**
 * Uploads Unleashed TUS Chunk Storage class.
 *
 * @package uploads-unleashed
 */

/**
 * Manages TUS upload chunk storage.
 *
 * @since 0.1.0
 */
class Uploads_Unleashed_TUS_Chunk_Storage {

	/**
	 * Rules that deny web access to the chunk directory on Apache 2.4 and 2.2.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	const HTACCESS_RULES = "# Apache 2.4\n<IfModule mod_authz_core.c>\n\tRequire all denied\n</IfModule>\n\n# Apache 2.2\n<IfModule !mod_authz_core.c>\n\tOrder deny,allow\n\tDeny from all\n</IfModule>\n";

	/**
	 * Base directory for chunk storage.
	 *
	 * @since 0.1.0
	 * @var ?string
	 */
	protected static ?string $base_dir = null;

	/**
	 * Why the chunk directory can't be used, or null if it can.
	 *
	 * @since 1.2.0
	 * @var ?WP_Error
	 */
	protected static ?WP_Error $base_dir_error = null;

	/**
	 * Constructor.
	 *
	 * @since 0.1.0
	 */
	public function __construct() {
		if ( null === self::$base_dir ) {
			self::$base_dir = self::get_chunk_dir();

			$this->maybe_create_directory();
		}
	}

	/**
	 * Returns the directory that holds chunk files for the current site.
	 *
	 * Chunks are written with flock() and listed with glob(), which don't work
	 * on stream wrappers such as S3-Uploads (`s3://`) or VIP (`vip://`). When
	 * the uploads directory is a stream wrapper, chunks go to a directory in
	 * the temp directory instead, and finalization copies the finished file
	 * into the uploads directory.
	 *
	 * Doesn't create the directory, so it's safe to call anywhere, e.g. to
	 * exclude chunks from disk usage. Not cached, so it follows switch_to_blog().
	 *
	 * @since 1.2.0
	 *
	 * @return string Absolute path to the chunk directory, with a trailing slash.
	 */
	public static function get_chunk_dir(): string {
		$basedir = wp_upload_dir( null, false )['basedir'];

		if ( wp_is_stream( $basedir ) ) {
			/*
			 * One directory per uploads dir, so sites sharing the temp dir don't clean up
			 * each other's chunks. Keyed with the install's salts, so other users on the
			 * server can't predict the name and create the directory first.
			 */
			$chunk_dir = trailingslashit( get_temp_dir() ) . 'uploads-unleashed-' . wp_hash( $basedir );
		} else {
			$chunk_dir = trailingslashit( $basedir ) . '.tus-chunks';
		}

		/**
		 * Filters the directory that holds in-progress upload chunks.
		 *
		 * The directory must be on a filesystem that supports flock() and
		 * glob(), so not a stream wrapper. On load-balanced hosts without
		 * sticky sessions, every web server must share it.
		 *
		 * @since 1.2.0
		 *
		 * @param string $chunk_dir Absolute path to the chunk directory. Default `.tus-chunks`
		 *                          in the uploads directory, or a per-site directory in the
		 *                          temp directory when the uploads directory is a stream wrapper.
		 */
		$chunk_dir = (string) apply_filters( 'uploads_unleashed_chunk_dir', $chunk_dir );

		return trailingslashit( $chunk_dir );
	}

	/**
	 * Creates the chunk storage directory and its protection files if they don't exist.
	 *
	 * @since 0.1.0
	 * @since 1.2.0 Writes Apache 2.4 rules, replaces an .htaccess that lacks them, and
	 *              refuses a chunk directory in the temp dir that isn't private.
	 */
	protected function maybe_create_directory(): void {
		self::$base_dir_error = null;

		if ( self::is_in_shared_temp_dir( self::$base_dir ) ) {
			$dir = untrailingslashit( self::$base_dir );

			/*
			 * Every user on the server can write to the temp dir. Create the directory
			 * atomically with private permissions, and if it already exists, make sure
			 * nobody else planted or can access it.
			 */
			if ( ! file_exists( $dir ) && ! is_link( $dir ) ) {
				// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_mkdir, WordPress.PHP.NoSilencedErrors.Discouraged -- wp_mkdir_p() can't create the directory atomically with private permissions. Silenced because another process may have created it first; the check below handles that.
				@mkdir( $dir, 0700 );
			}

			if ( ! self::is_private_dir( $dir ) ) {
				self::$base_dir_error = new WP_Error(
					'tus_chunk_dir_unsafe',
					__( 'The upload storage directory is not private to WordPress. Use the uploads_unleashed_chunk_dir filter to choose another directory.', 'uploads-unleashed' ),
					array( 'status' => 500 )
				);

				return;
			}
		} elseif ( ! file_exists( self::$base_dir ) ) {
			wp_mkdir_p( self::$base_dir );
		}

		/*
		 * Protect the directory from direct access. Older versions wrote only the
		 * Apache 2.2 rule, which Apache 2.4 rejects without mod_access_compat.
		 * Never write through a symlink someone else planted.
		 */
		$htaccess_file = self::$base_dir . '.htaccess';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local file.
		if ( ! is_link( $htaccess_file ) && ( ! file_exists( $htaccess_file ) || false === strpos( (string) file_get_contents( $htaccess_file ), 'Require all denied' ) ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Matches core pattern in privacy-tools.php. WP_Filesystem requires credentials, impractical for runtime.
			file_put_contents( $htaccess_file, self::HTACCESS_RULES );
		}

		$index_file = self::$base_dir . 'index.php';
		if ( ! is_link( $index_file ) && ! file_exists( $index_file ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Matches core pattern in privacy-tools.php. WP_Filesystem requires credentials, impractical for runtime.
			file_put_contents( $index_file, "<?php\n// Silence is golden.\n" );
		}
	}

	/**
	 * Whether a path is inside the temp directory, which other users on the server can write to.
	 *
	 * @since 1.2.0
	 *
	 * @param string $path The path.
	 * @return bool True if the path is in the temp directory.
	 */
	private static function is_in_shared_temp_dir( string $path ): bool {
		return 0 === strpos( $path, trailingslashit( get_temp_dir() ) );
	}

	/**
	 * Whether a directory is a real directory that only the PHP user owns and can access.
	 *
	 * @since 1.2.0
	 *
	 * @param string $dir The directory, without a trailing slash.
	 * @return bool True if the directory is private.
	 */
	private static function is_private_dir( string $dir ): bool {
		clearstatcache( true, $dir );

		if ( is_link( $dir ) || ! is_dir( $dir ) ) {
			return false;
		}

		if ( function_exists( 'posix_geteuid' ) && fileowner( $dir ) !== posix_geteuid() ) {
			return false;
		}

		// Windows doesn't have POSIX permissions.
		if ( '\\' === DIRECTORY_SEPARATOR ) {
			return true;
		}

		// No group or world permissions.
		return 0 === ( fileperms( $dir ) & 0077 );
	}

	/**
	 * Lists the chunk files in the chunk directory.
	 *
	 * @since 1.2.0
	 *
	 * @return string[] Chunk file paths, or an empty array if the directory can't be used.
	 */
	private static function list_chunk_files(): array {
		if ( self::$base_dir_error ) {
			return array();
		}

		$files = glob( self::$base_dir . '*.part' );

		return is_array( $files ) ? $files : array();
	}

	/**
	 * Returns the path to a chunk file.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return string The full path to the chunk file.
	 */
	public function get_path( string $upload_id ): string {
		// Sanitize upload ID to prevent directory traversal.
		$safe_id = preg_replace( '/[^a-zA-Z0-9-]/', '', $upload_id );

		return self::$base_dir . $safe_id . '.part';
	}

	/**
	 * Appends data to a chunk file.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @param string $data      The binary data to append.
	 * @param int    $offset    The expected offset (for verification).
	 * @return int|WP_Error New offset on success, WP_Error on failure.
	 */
	public function append( string $upload_id, string $data, int $offset ) {
		if ( self::$base_dir_error ) {
			return self::$base_dir_error;
		}

		$path = $this->get_path( $upload_id );

		// Never write through a symlink someone else planted.
		if ( is_link( $path ) ) {
			return new WP_Error( 'tus_chunk_unsafe_path', __( 'The chunk file is a symbolic link.', 'uploads-unleashed' ), array( 'status' => 500 ) );
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- WP_Filesystem lacks append mode and flock support needed for TUS concurrency.
		$handle = fopen( $path, 'ab' );
		if ( ! $handle ) {
			return new WP_Error( 'tus_chunk_open_failed', __( 'Could not open chunk file for writing.', 'uploads-unleashed' ), array( 'status' => 500 ) );
		}

		// Lock for concurrent access protection.
		if ( ! flock( $handle, LOCK_EX ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Paired with fopen/flock above.
			fclose( $handle );

			return new WP_Error( 'tus_chunk_lock_failed', __( 'Could not acquire lock on chunk file.', 'uploads-unleashed' ), array( 'status' => 500 ) );
		}

		// Verify current file size matches expected offset.
		$current_size = filesize( $path );
		if ( false === $current_size ) {
			$current_size = 0;
		}

		if ( $current_size !== $offset ) {
			flock( $handle, LOCK_UN );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Paired with fopen/flock above.
			fclose( $handle );

			return new WP_Error( 'tus_chunk_offset_mismatch', __( 'File offset does not match expected value.', 'uploads-unleashed' ), array( 'status' => 409 ) );
		}

		// Seek to offset and write data.
		fseek( $handle, $offset );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- Paired with fopen/flock above.
		$written = fwrite( $handle, $data );

		flock( $handle, LOCK_UN );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Paired with fopen/flock above.
		fclose( $handle );

		// Clear stat cache so filesize() returns accurate values after writing.
		clearstatcache( true, $path );

		if ( false === $written ) {
			return new WP_Error( 'tus_chunk_write_failed', __( 'Could not write to chunk file.', 'uploads-unleashed' ), array( 'status' => 500 ) );
		}

		return $offset + $written;
	}

	/**
	 * Deletes a chunk file.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True on success, false on failure.
	 */
	public function delete( string $upload_id ): bool {
		$path = $this->get_path( $upload_id );

		if ( file_exists( $path ) ) {
			return wp_delete_file( $path );
		}

		return true;
	}

	/**
	 * Returns the current size of a chunk file.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return int File size in bytes, or 0 if file doesn't exist.
	 */
	public function get_size( string $upload_id ): int {
		$path = $this->get_path( $upload_id );

		if ( ! file_exists( $path ) ) {
			return 0;
		}

		clearstatcache( true, $path );
		$size = filesize( $path );

		return false === $size ? 0 : $size;
	}

	/**
	 * Checks if a chunk file exists.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True if the file exists, false otherwise.
	 */
	public function exists( string $upload_id ): bool {
		return file_exists( $this->get_path( $upload_id ) );
	}

	/**
	 * Returns the total size of all pending uploads.
	 *
	 * This sums the expected final size (not current progress) of all
	 * in-progress uploads, useful for quota calculations.
	 *
	 * @since 0.1.0
	 *
	 * @return int Total pending upload size in bytes.
	 */
	public function get_total_pending_size(): int {
		$files = self::list_chunk_files();

		if ( ! $files ) {
			return 0;
		}

		$session    = new Uploads_Unleashed_TUS_Upload_Session();
		$total_size = 0;

		foreach ( $files as $file ) {
			$upload_id = basename( $file, '.part' );
			$data      = $session->get( $upload_id );

			// Only count if session exists and hasn't expired.
			if ( $data && time() <= $data['expires_at'] ) {
				$total_size += (int) $data['length'];
			}
		}

		return $total_size;
	}

	/**
	 * Lists all active upload sessions by scanning chunk files on disk.
	 *
	 * Uses get_transient() for each session lookup so it works regardless
	 * of whether an external object cache is active.
	 *
	 * @since 1.0.0
	 *
	 * @return array[] Array of session data arrays.
	 */
	public static function list_active_sessions(): array {
		$storage = new self();
		$session = new Uploads_Unleashed_TUS_Upload_Session();

		$files = self::list_chunk_files();

		if ( ! $files ) {
			return array();
		}

		$sessions = array();
		foreach ( $files as $file ) {
			$upload_id = basename( $file, '.part' );
			$data      = $session->get( $upload_id );

			if ( ! $data || time() > $data['expires_at'] ) {
				continue;
			}

			$sessions[] = $data;
		}

		return $sessions;
	}

	/**
	 * Cleans up expired chunk files.
	 *
	 * This method is intended to be called via WP-Cron.
	 *
	 * @since 0.1.0
	 */
	public static function cleanup_expired(): void {
		$storage = new self();
		$session = new Uploads_Unleashed_TUS_Upload_Session();

		$files = self::list_chunk_files();

		if ( ! $files ) {
			return;
		}

		foreach ( $files as $file ) {
			$upload_id = basename( $file, '.part' );
			$data      = $session->get( $upload_id );

			// Delete if session doesn't exist or has expired.
			if ( ! $data || time() > $data['expires_at'] ) {
				$storage->delete( $upload_id );
				$session->delete( $upload_id );
			}
		}
	}

	/**
	 * Deletes all chunk files, protection files, and the storage directory for the current site.
	 *
	 * Computes the storage path via get_chunk_dir() to avoid
	 * recreating the directory during uninstall.
	 *
	 * @since 1.0.0
	 */
	public static function delete_all(): void {
		$chunks_dir = self::get_chunk_dir();

		if ( ! is_dir( $chunks_dir ) ) {
			return;
		}

		// Leave a temp directory alone that someone else planted or can access.
		if ( self::is_in_shared_temp_dir( $chunks_dir ) && ! self::is_private_dir( untrailingslashit( $chunks_dir ) ) ) {
			return;
		}

		// Delete all files, including hidden files like .htaccess.
		$patterns = array( $chunks_dir . '*', $chunks_dir . '.*' );
		foreach ( $patterns as $pattern ) {
			$files = glob( $pattern, GLOB_NOSORT );
			if ( ! is_array( $files ) ) {
				continue;
			}

			foreach ( $files as $file ) {
				// Symlinks are deleted, not followed.
				if ( is_file( $file ) || is_link( $file ) ) {
					wp_delete_file( $file );
				}
			}
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- WP_Filesystem requires credentials, impractical for uninstall. Silenced because rmdir fails on non-empty directories (e.g., unexpected subdirectories).
		@rmdir( $chunks_dir );

		// Reset cached path so the class does not reference a removed directory.
		self::$base_dir       = null;
		self::$base_dir_error = null;
	}
}

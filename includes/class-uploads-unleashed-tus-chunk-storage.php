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
	 * Doesn't create the directory, so it's safe to call anywhere, e.g. to
	 * exclude chunks from disk usage. Not cached, so it follows switch_to_blog().
	 *
	 * @since 1.2.0
	 *
	 * @return string Absolute path to the chunk directory, with a trailing slash.
	 */
	public static function get_chunk_dir(): string {
		$chunk_dir = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . '.tus-chunks';

		/**
		 * Filters the directory that holds in-progress upload chunks.
		 *
		 * The directory must be on a local or mounted filesystem that supports
		 * flock() and glob(), so not a stream wrapper. Sites whose uploads
		 * directory is a stream wrapper, like S3-Uploads or VIP, must use this
		 * filter. On load-balanced hosts without sticky sessions, every web
		 * server must share the directory.
		 *
		 * @since 1.2.0
		 *
		 * @param string $chunk_dir Absolute path to the chunk directory. Default `.tus-chunks`
		 *                          in the uploads directory.
		 */
		$chunk_dir = (string) apply_filters( 'uploads_unleashed_chunk_dir', $chunk_dir );

		return trailingslashit( $chunk_dir );
	}

	/**
	 * Checks that chunks can be stored in the chunk directory.
	 *
	 * @since 1.2.0
	 *
	 * @return true|WP_Error True if chunks can be stored, WP_Error otherwise.
	 */
	public function check_directory() {
		if ( wp_is_stream( self::$base_dir ) ) {
			return new WP_Error(
				'tus_chunk_dir_not_local',
				__( 'Uploads cannot start because the upload storage directory is not on the local filesystem, for example because media is stored on S3 or VIP. Use the uploads_unleashed_chunk_dir filter to choose a local directory.', 'uploads-unleashed' ),
				array( 'status' => 500 )
			);
		}

		if ( ! is_dir( self::$base_dir ) || ! wp_is_writable( self::$base_dir ) ) {
			return new WP_Error(
				'tus_chunk_dir_not_writable',
				__( 'Uploads cannot start because the upload storage directory is not writable.', 'uploads-unleashed' ),
				array( 'status' => 500 )
			);
		}

		return true;
	}

	/**
	 * Creates the chunk storage directory and its protection files if they don't exist.
	 *
	 * @since 0.1.0
	 * @since 1.2.0 Writes Apache 2.4 rules, replaces an .htaccess that lacks them,
	 *              and leaves stream wrappers alone.
	 */
	protected function maybe_create_directory(): void {
		// check_directory() rejects stream wrappers; don't create anything remote.
		if ( wp_is_stream( self::$base_dir ) ) {
			return;
		}

		if ( ! file_exists( self::$base_dir ) ) {
			wp_mkdir_p( self::$base_dir );
		}

		if ( ! is_dir( self::$base_dir ) ) {
			return;
		}

		/*
		 * Protect the directory from direct access. Older versions wrote only the
		 * Apache 2.2 rule, which Apache 2.4 rejects without mod_access_compat.
		 */
		$htaccess_file = self::$base_dir . '.htaccess';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local file.
		if ( ! file_exists( $htaccess_file ) || false === strpos( (string) file_get_contents( $htaccess_file ), 'Require all denied' ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Matches core pattern in privacy-tools.php. WP_Filesystem requires credentials, impractical for runtime.
			file_put_contents( $htaccess_file, self::HTACCESS_RULES );
		}

		$index_file = self::$base_dir . 'index.php';
		if ( ! file_exists( $index_file ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Matches core pattern in privacy-tools.php. WP_Filesystem requires credentials, impractical for runtime.
			file_put_contents( $index_file, "<?php\n// Silence is golden.\n" );
		}
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
		$path = $this->get_path( $upload_id );

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

			/*
			 * The file only grows, and the session offset is updated after each
			 * write, so on a single server the file is never behind the session.
			 * When it is, earlier chunks were stored elsewhere: on another server
			 * behind a load balancer, or in a chunk directory that was emptied.
			 * Retrying can't recover the bytes, so don't answer with a 409, which
			 * TUS clients retry.
			 */
			if ( $current_size < $offset ) {
				return new WP_Error(
					'tus_chunk_data_missing',
					__( 'Part of this upload is missing on the server, so it cannot continue. On hosts with several web servers, every server needs to share the upload storage directory, or the load balancer needs sticky sessions. Please upload the file again.', 'uploads-unleashed' ),
					array( 'status' => 410 )
				);
			}

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
		$files = glob( self::$base_dir . '*.part' );

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

		$files = glob( self::$base_dir . '*.part' );

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

		$files = glob( self::$base_dir . '*.part' );

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

		// Delete all files, including hidden files like .htaccess.
		$patterns = array( $chunks_dir . '*', $chunks_dir . '.*' );
		foreach ( $patterns as $pattern ) {
			$files = glob( $pattern, GLOB_NOSORT );
			if ( ! is_array( $files ) ) {
				continue;
			}

			foreach ( $files as $file ) {
				if ( is_file( $file ) ) {
					wp_delete_file( $file );
				}
			}
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- WP_Filesystem requires credentials, impractical for uninstall. Silenced because rmdir fails on non-empty directories (e.g., unexpected subdirectories).
		@rmdir( $chunks_dir );

		// Reset cached path so the class does not reference a removed directory.
		self::$base_dir = null;
	}
}

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
			self::$base_dir = self::get_base_dir_path();

			$this->maybe_create_directory();
		}
	}

	/**
	 * Returns the base directory path for chunk storage.
	 *
	 * @since 1.0.0
	 *
	 * @return string The base directory path.
	 */
	private static function get_base_dir_path(): string {
		$upload_dir = wp_upload_dir();

		return trailingslashit( $upload_dir['basedir'] ) . '.tus-chunks/';
	}

	/**
	 * Creates the chunk storage directory if it doesn't exist.
	 *
	 * @since 0.1.0
	 */
	protected function maybe_create_directory(): void {
		if ( file_exists( self::$base_dir ) ) {
			return;
		}

		wp_mkdir_p( self::$base_dir );

		// Protect directory from direct access.
		$htaccess_file = self::$base_dir . '.htaccess';
		if ( ! file_exists( $htaccess_file ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Matches core pattern in privacy-tools.php. WP_Filesystem requires credentials, impractical for runtime.
			file_put_contents( $htaccess_file, "Deny from all\n" );
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
	 * Returns the number of bytes pending uploads have yet to receive.
	 *
	 * Unlike get_total_pending_size(), this leaves out bytes already
	 * written to chunk files, for limits based on space that already
	 * accounts for them, like free disk space.
	 *
	 * @since 1.2.0
	 *
	 * @return int Total bytes still to be received, in bytes.
	 */
	public function get_total_remaining_size(): int {
		$total_size = 0;

		foreach ( self::list_active_sessions() as $data ) {
			$total_size += max( 0, (int) $data['length'] - (int) $data['offset'] );
		}

		return $total_size;
	}

	/**
	 * Excludes the chunk directory from directory size calculations on multisite.
	 *
	 * Hooked to `pre_recurse_dirsize`. Pending uploads reserve their full
	 * length against the site quota, so counting their chunk files in
	 * get_space_used() as well would count every upload twice.
	 *
	 * @since 1.2.0
	 *
	 * @param int|false $size      The directory size, or false to calculate it.
	 * @param string    $directory Full path of the directory.
	 * @return int|false 0 for the chunk directory, the unchanged size otherwise.
	 */
	public static function exclude_from_dirsize( $size, $directory ) {
		if ( ! is_multisite() || ! is_string( $directory ) || self::get_dirsize_key() !== wp_normalize_path( $directory ) ) {
			return $size;
		}

		return 0;
	}

	/**
	 * Drops a stale cached size of the chunk directory on multisite.
	 *
	 * Hooked to `transient_dirsize_cache`. Core never invalidates the cached
	 * size of the chunk directory, which may have been cached before it was
	 * excluded, or while the plugin was inactive. With a persistent object
	 * cache that size never expires. Removing it and the sizes of its parent
	 * directories makes core recalculate them, which excludes the chunks.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $directory_cache Cached directory sizes, keyed by path.
	 * @return mixed The cache without a non-zero size for the chunk directory.
	 */
	public static function drop_stale_dirsize( $directory_cache ) {
		if ( ! is_multisite() || ! is_array( $directory_cache ) ) {
			return $directory_cache;
		}

		$chunks_dir = self::get_dirsize_key();

		foreach ( $directory_cache as $path => $size ) {
			if ( 0 === $size || wp_normalize_path( (string) $path ) !== $chunks_dir ) {
				continue;
			}

			// Same traversal as core's clean_dirsize_cache().
			$last_path = null;
			unset( $directory_cache[ $path ] );

			while ( $last_path !== $path && DIRECTORY_SEPARATOR !== $path && '.' !== $path && '..' !== $path ) {
				$last_path = $path;
				$path      = dirname( $path );
				unset( $directory_cache[ $path ] );
			}
		}

		return $directory_cache;
	}

	/**
	 * Returns the chunk directory in the form used to compare directory size paths.
	 *
	 * Resolved on every call, so it follows the configured chunk directory
	 * and the current site.
	 *
	 * @since 1.2.0
	 *
	 * @return string Normalized chunk directory path without a trailing slash.
	 */
	private static function get_dirsize_key(): string {
		return wp_normalize_path( untrailingslashit( self::get_base_dir_path() ) );
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
	 * Computes the storage path via get_base_dir_path() to avoid
	 * recreating the directory during uninstall.
	 *
	 * @since 1.0.0
	 */
	public static function delete_all(): void {
		$chunks_dir = self::get_base_dir_path();

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

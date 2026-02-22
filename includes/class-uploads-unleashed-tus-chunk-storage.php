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

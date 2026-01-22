<?php
/**
 * TUS Chunk Storage class.
 *
 * @package resumable-uploads
 */

/**
 * Manages TUS upload chunk storage.
 *
 * @since 0.1.0
 */
class TUS_Chunk_Storage {

	/**
	 * Base directory for chunk storage.
	 *
	 * @since 0.1.0
	 * @var string
	 */
	protected string $base_dir;

	/**
	 * Constructor.
	 *
	 * @since 0.1.0
	 */
	public function __construct() {
		$upload_dir     = wp_upload_dir();
		$this->base_dir = trailingslashit( $upload_dir['basedir'] ) . '.tus-chunks';

		$this->maybe_create_directory();
	}

	/**
	 * Creates the chunk storage directory if it doesn't exist.
	 *
	 * @since 0.1.0
	 */
	protected function maybe_create_directory(): void {
		if ( file_exists( $this->base_dir ) ) {
			return;
		}

		wp_mkdir_p( $this->base_dir );

		// Protect directory from direct access.
		$htaccess_file = trailingslashit( $this->base_dir ) . '.htaccess';
		if ( ! file_exists( $htaccess_file ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Simple file write.
			file_put_contents( $htaccess_file, "Deny from all\n" );
		}

		$index_file = trailingslashit( $this->base_dir ) . 'index.php';
		if ( ! file_exists( $index_file ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Simple file write.
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

		return trailingslashit( $this->base_dir ) . $safe_id . '.part';
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

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- Direct file operation needed.
		$handle = fopen( $path, 'ab' );
		if ( ! $handle ) {
			return new WP_Error( 'tus_chunk_open_failed', __( 'Could not open chunk file for writing.', 'resumable-uploads' ), array( 'status' => 500 ) );
		}

		// Lock for concurrent access protection.
		if ( ! flock( $handle, LOCK_EX ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Direct file operation needed.
			fclose( $handle );

			return new WP_Error( 'tus_chunk_lock_failed', __( 'Could not acquire lock on chunk file.', 'resumable-uploads' ), array( 'status' => 500 ) );
		}

		// Verify current file size matches expected offset.
		$current_size = filesize( $path );
		if ( false === $current_size ) {
			$current_size = 0;
		}

		if ( $current_size !== $offset ) {
			flock( $handle, LOCK_UN );
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Direct file operation needed.
			fclose( $handle );

			return new WP_Error( 'tus_chunk_offset_mismatch', __( 'File offset does not match expected value.', 'resumable-uploads' ), array( 'status' => 409 ) );
		}

		// Seek to offset and write data.
		fseek( $handle, $offset );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- Binary chunk data requires direct fwrite.
		$written = fwrite( $handle, $data );

		flock( $handle, LOCK_UN );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Direct file operation needed.
		fclose( $handle );

		if ( false === $written ) {
			return new WP_Error( 'tus_chunk_write_failed', __( 'Could not write to chunk file.', 'resumable-uploads' ), array( 'status' => 500 ) );
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
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation needed.
			return @unlink( $path );
		}

		return true;
	}

	/**
	 * Cleans up storage for an upload (alias for delete).
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True on success, false on failure.
	 */
	public function cleanup( string $upload_id ): bool {
		return $this->delete( $upload_id );
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

		return filesize( $path );
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
		$files = glob( trailingslashit( $this->base_dir ) . '*.part' );

		if ( ! $files ) {
			return 0;
		}

		$session    = new TUS_Upload_Session();
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
		$session = new TUS_Upload_Session();

		$files = glob( trailingslashit( $storage->base_dir ) . '*.part' );

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
}

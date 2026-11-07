<?php
/**
 * Uploads Unleashed TUS Upload Session class.
 *
 * @package uploads-unleashed
 */

/**
 * Manages TUS upload sessions using transients.
 *
 * @since 0.1.0
 */
class Uploads_Unleashed_TUS_Upload_Session {

	/**
	 * Transient prefix for upload sessions.
	 *
	 * @since 0.1.0
	 * @var string
	 */
	const TRANSIENT_PREFIX = 'tus_upload_';

	/**
	 * Default session expiration in seconds (24 hours).
	 *
	 * @since 0.1.0
	 * @var int
	 */
	const EXPIRATION = DAY_IN_SECONDS;

	/**
	 * Returns how long an upload session lives after its last activity.
	 *
	 * @since 1.2.0
	 *
	 * @return int Lifetime in seconds.
	 */
	public static function get_expiration(): int {
		/**
		 * Filters how long an upload session lives, in seconds.
		 *
		 * The session expires this long after it was created or last received
		 * a chunk. Values below 1 fall back to the default.
		 *
		 * @since 1.2.0
		 *
		 * @param int $expiration Lifetime in seconds. Default DAY_IN_SECONDS.
		 */
		$expiration = (int) apply_filters( 'uploads_unleashed_upload_expiration', self::EXPIRATION );

		return $expiration > 0 ? $expiration : self::EXPIRATION;
	}

	/**
	 * Status of a session that is receiving chunks.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	const STATUS_UPLOADING = 'uploading';

	/**
	 * Status of a session whose upload is being turned into an attachment.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	const STATUS_FINALIZING = 'finalizing';

	/**
	 * Status of a finished upload. The session stays behind as a tombstone
	 * that maps the upload to its attachment, so replayed requests get the
	 * same result instead of a new upload.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	const STATUS_FINALIZED = 'finalized';

	/**
	 * Creates a new upload session.
	 *
	 * @since 0.1.0
	 *
	 * @param array           $data {
	 *     Upload data.
	 *
	 *     @type string $filename The filename.
	 *     @type string $filetype The MIME type.
	 *     @type int    $length   The total file size in bytes.
	 * }
	 * @param WP_REST_Request $request The REST request object.
	 * @return string|WP_Error The upload ID on success, WP_Error on failure.
	 */
	public function create( array $data, WP_REST_Request $request ) {
		$expiration   = self::get_expiration();
		$now          = time();
		$session_data = array(
			'upload_id'  => wp_generate_uuid4(),
			'user_id'    => get_current_user_id(),
			'filename'   => sanitize_file_name( $data['filename'] ?? 'unnamed' ),
			'filetype'   => sanitize_mime_type( $data['filetype'] ?? 'application/octet-stream' ),
			'length'     => (int) ( $data['length'] ?? 0 ),
			'offset'     => 0,
			'status'     => self::STATUS_UPLOADING,
			'created_at' => $now,
			'expires_at' => $now + $expiration,
		);

		/**
		 * Filters the session data before storage.
		 *
		 * Allows plugins to store additional data with the upload session.
		 *
		 * @since 0.1.0
		 *
		 * @param array           $session_data The session data to be stored.
		 * @param WP_REST_Request $request      The request object.
		 */
		$session_data = apply_filters( 'uploads_unleashed_session_data', $session_data, $request );

		$result = set_transient( self::TRANSIENT_PREFIX . $session_data['upload_id'], $session_data, $expiration );

		if ( ! $result ) {
			return new WP_Error( 'tus_session_create_failed', __( 'Could not create upload session.', 'uploads-unleashed' ), array( 'status' => 500 ) );
		}

		return $session_data['upload_id'];
	}

	/**
	 * Retrieves an upload session.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return array|null Session data on success, null if not found.
	 */
	public function get( string $upload_id ): ?array {
		$data = get_transient( self::TRANSIENT_PREFIX . $upload_id );

		if ( false === $data ) {
			return null;
		}

		return $data;
	}

	/**
	 * Updates the offset for an upload session.
	 *
	 * Also moves the expiration forward, so an upload that's still receiving
	 * chunks doesn't expire.
	 *
	 * @since 0.1.0
	 * @since 1.2.0 Moves the expiration forward instead of keeping it.
	 *
	 * @param string $upload_id The upload ID.
	 * @param int    $offset    The new offset.
	 * @return bool True on success, false on failure.
	 */
	public function update_offset( string $upload_id, int $offset ): bool {
		return $this->update(
			$upload_id,
			array(
				'offset'     => $offset,
				'expires_at' => time() + self::get_expiration(),
			)
		);
	}

	/**
	 * Merges data into an upload session.
	 *
	 * @since 1.2.0
	 *
	 * @param string $upload_id The upload ID.
	 * @param array  $changes   Session fields to set.
	 * @return bool True on success, false on failure or if the session doesn't exist.
	 */
	public function update( string $upload_id, array $changes ): bool {
		$data = $this->get( $upload_id );

		if ( ! $data ) {
			return false;
		}

		$data = array_merge( $data, $changes );

		// Recalculate remaining expiration time.
		$remaining = $data['expires_at'] - time();
		if ( $remaining <= 0 ) {
			$remaining = self::get_expiration();
		}

		return set_transient( self::TRANSIENT_PREFIX . $upload_id, $data, $remaining );
	}

	/**
	 * Deletes an upload session.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True on success, false on failure.
	 */
	public function delete( string $upload_id ): bool {
		return delete_transient( self::TRANSIENT_PREFIX . $upload_id );
	}

	/**
	 * Deletes all upload session transients.
	 *
	 * Must run before Uploads_Unleashed_TUS_Chunk_Storage::delete_all(), which
	 * removes the chunk files that sessions are found through.
	 *
	 * @since 1.0.0
	 * @since 1.2.0 Also deletes sessions kept in a persistent object cache.
	 */
	public static function delete_all(): void {
		global $wpdb;

		// A persistent object cache keeps transients out of the options table, so delete them by ID.
		foreach ( Uploads_Unleashed_TUS_Chunk_Storage::get_upload_ids() as $upload_id ) {
			delete_transient( self::TRANSIENT_PREFIX . $upload_id );
		}

		// Catches sessions in the options table whose chunk file is already gone.

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
				$wpdb->esc_like( '_transient_' . self::TRANSIENT_PREFIX ) . '%',
				$wpdb->esc_like( '_transient_timeout_' . self::TRANSIENT_PREFIX ) . '%'
			)
		);
	}
}

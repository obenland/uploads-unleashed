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
		$session_data = array(
			'upload_id'  => wp_generate_uuid4(),
			'user_id'    => get_current_user_id(),
			'filename'   => sanitize_file_name( $data['filename'] ?? 'unnamed' ),
			'filetype'   => sanitize_mime_type( $data['filetype'] ?? 'application/octet-stream' ),
			'length'     => (int) ( $data['length'] ?? 0 ),
			'offset'     => 0,
			'created_at' => time(),
			'expires_at' => time() + self::EXPIRATION,
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

		$result = set_transient( self::TRANSIENT_PREFIX . $session_data['upload_id'], $session_data, self::EXPIRATION );

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
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID.
	 * @param int    $offset    The new offset.
	 * @return bool True on success, false on failure.
	 */
	public function update_offset( string $upload_id, int $offset ): bool {
		$data = $this->get( $upload_id );

		if ( ! $data ) {
			return false;
		}

		$data['offset'] = $offset;

		// Recalculate remaining expiration time.
		$remaining = $data['expires_at'] - time();
		if ( $remaining <= 0 ) {
			$remaining = self::EXPIRATION;
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
	 * @since 1.0.0
	 */
	public static function delete_all(): void {
		global $wpdb;

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

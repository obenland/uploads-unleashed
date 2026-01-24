<?php
/**
 * TUS Upload Session class.
 *
 * @package resumable-uploads
 */

/**
 * Manages TUS upload sessions using transients.
 *
 * @since 0.2.0
 */
class TUS_Upload_Session {

	/**
	 * Transient prefix for upload sessions.
	 *
	 * @since 0.2.0
	 * @var string
	 */
	const TRANSIENT_PREFIX = 'tus_upload_';

	/**
	 * Default session expiration in seconds (24 hours).
	 *
	 * @since 0.2.0
	 * @var int
	 */
	const EXPIRATION = DAY_IN_SECONDS;

	/**
	 * Creates a new upload session.
	 *
	 * @since 0.2.0
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
		 * @since 0.2.0
		 *
		 * @param array           $session_data The session data to be stored.
		 * @param WP_REST_Request $request      The request object.
		 */
		$session_data = apply_filters( 'resumable_uploads_session_data', $session_data, $request );

		$result = set_transient( self::TRANSIENT_PREFIX . $session_data['upload_id'], $session_data, self::EXPIRATION );

		if ( ! $result ) {
			return new WP_Error( 'tus_session_create_failed', __( 'Could not create upload session.', 'resumable-uploads' ), array( 'status' => 500 ) );
		}

		return $session_data['upload_id'];
	}

	/**
	 * Retrieves an upload session.
	 *
	 * @since 0.2.0
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
	 * @since 0.2.0
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
	 * @since 0.2.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True on success, false on failure.
	 */
	public function delete( string $upload_id ): bool {
		return delete_transient( self::TRANSIENT_PREFIX . $upload_id );
	}

	/**
	 * Verifies that the current user owns the upload.
	 *
	 * @since 0.2.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True if the current user owns the upload, false otherwise.
	 */
	public function verify_ownership( string $upload_id ): bool {
		$data = $this->get( $upload_id );

		if ( ! $data ) {
			return false;
		}

		return get_current_user_id() === $data['user_id'];
	}

	/**
	 * Checks if an upload has expired.
	 *
	 * @since 0.2.0
	 *
	 * @param string $upload_id The upload ID.
	 * @return bool True if expired, false otherwise.
	 */
	public function is_expired( string $upload_id ): bool {
		$data = $this->get( $upload_id );

		if ( ! $data ) {
			return true;
		}

		return time() > $data['expires_at'];
	}
}

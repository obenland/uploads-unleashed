<?php
/**
 * REST API: REST_TUS_Controller class
 *
 * @package resumable-uploads
 */

/**
 * Controller for TUS resumable upload endpoints.
 *
 * Implements the TUS 1.0.0 protocol for resumable file uploads.
 *
 * @since 0.1.0
 *
 * @see WP_REST_Controller
 * @see https://tus.io/protocols/resumable-upload
 */
class REST_TUS_Controller extends WP_REST_Controller {

	/**
	 * TUS protocol version.
	 *
	 * @since 0.1.0
	 * @var string
	 */
	const TUS_VERSION = '1.0.0';

	/**
	 * Supported TUS extensions.
	 *
	 * @since 0.1.0
	 * @var string
	 */
	const TUS_EXTENSIONS = 'creation,expiration,termination';

	/**
	 * The namespace for the REST route.
	 *
	 * @since 0.1.0
	 * @var string
	 */
	protected $namespace = 'wp/v2';

	/**
	 * The base of the REST route.
	 *
	 * @since 0.1.0
	 * @var string
	 */
	protected $rest_base = 'media/tus';

	/**
	 * Registers the routes for the TUS controller.
	 *
	 * @since 0.1.0
	 */
	public function register_routes(): void {
		// OPTIONS and POST for upload creation.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
				),
				'schema' => array( $this, 'get_public_item_schema' ),
			)
		);

		// HEAD, PATCH, DELETE for individual uploads.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[a-zA-Z0-9-]+)',
			array(
				array(
					'methods'             => 'HEAD',
					'callback'            => array( $this, 'get_item_offset' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the upload.', 'resumable-uploads' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
				array(
					'methods'             => 'PATCH',
					'callback'            => array( $this, 'upload_chunk' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the upload.', 'resumable-uploads' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the upload.', 'resumable-uploads' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Adds TUS headers to OPTIONS responses.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Response $response The response object.
	 * @return WP_REST_Response Modified response with TUS headers.
	 */
	public function add_options_headers( WP_REST_Response $response ): WP_REST_Response {
		$response->header( 'Tus-Resumable', self::TUS_VERSION );
		$response->header( 'Tus-Version', self::TUS_VERSION );
		$response->header( 'Tus-Extension', self::TUS_EXTENSIONS );
		$response->header( 'Tus-Max-Size', wp_max_upload_size() );

		return $response;
	}

	/**
	 * Checks if a given request has access to create uploads.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return true|WP_Error True if the request has access, WP_Error otherwise.
	 */
	public function create_item_permissions_check( $request ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new WP_Error( 'rest_cannot_create_upload', __( 'Sorry, you are not allowed to upload files.', 'resumable-uploads' ), array( 'status' => rest_authorization_required_code() ) );
		}

		return true;
	}

	/**
	 * Checks if a given request has access to read/update an upload.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return true|WP_Error True if the request has access, WP_Error otherwise.
	 */
	public function get_item_permissions_check( $request ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new WP_Error( 'rest_cannot_view_upload', __( 'Sorry, you are not allowed to view this upload.', 'resumable-uploads' ), array( 'status' => rest_authorization_required_code() ) );
		}

		$upload_id = $request->get_param( 'id' );
		$session   = new TUS_Upload_Session();
		$upload    = $session->get( $upload_id );

		if ( ! $upload ) {
			return new WP_Error( 'rest_upload_not_found', __( 'Upload not found.', 'resumable-uploads' ), array( 'status' => 404 ) );
		}

		if ( get_current_user_id() !== $upload['user_id'] ) {
			return new WP_Error( 'rest_cannot_view_upload', __( 'Sorry, you are not allowed to view this upload.', 'resumable-uploads' ), array( 'status' => 403 ) );
		}

		return true;
	}

	/**
	 * Checks if a given request has access to delete an upload.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return true|WP_Error True if the request has access, WP_Error otherwise.
	 */
	public function delete_item_permissions_check( $request ) {
		return $this->get_item_permissions_check( $request );
	}

	/**
	 * Creates a new upload resource.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$upload_length = $request->get_header( 'Upload-Length' );

		if ( null === $upload_length ) {
			return new WP_Error( 'rest_upload_length_required', __( 'Upload-Length header is required.', 'resumable-uploads' ), array( 'status' => 400 ) );
		}

		$upload_length = (int) $upload_length;

		// Validate upload size against available space.
		$max_size = wp_max_upload_size();
		if ( $upload_length > $max_size ) {
			return new WP_Error(
				'rest_upload_too_large',
				sprintf(
					/* translators: %s: Available space. */
					__( 'Not enough space. You have %s available.', 'resumable-uploads' ),
					size_format( $max_size )
				),
				array( 'status' => 413 )
			);
		}

		// Parse metadata.
		$metadata = $this->parse_upload_metadata( $request->get_header( 'Upload-Metadata' ) );
		$filename = $metadata['filename'] ?? 'unnamed';
		$filetype = $metadata['filetype'] ?? 'application/octet-stream';

		// Create upload session.
		$session   = new TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => $filename,
				'filetype' => $filetype,
				'length'   => $upload_length,
			)
		);

		if ( is_wp_error( $upload_id ) ) {
			return $upload_id;
		}

		$upload = $session->get( $upload_id );

		$response = new WP_REST_Response( null, 201 );
		$response->header( 'Location', rest_url( sprintf( '%s/%s/%s', $this->namespace, $this->rest_base, $upload_id ) ) );
		$response->header( 'Tus-Resumable', self::TUS_VERSION );
		$response->header( 'Upload-Expires', gmdate( 'D, d M Y H:i:s', $upload['expires_at'] ) . ' GMT' );

		return $response;
	}

	/**
	 * Returns the current offset of an upload.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item_offset( WP_REST_Request $request ) {
		$upload_id = $request->get_param( 'id' );
		$session   = new TUS_Upload_Session();
		$upload    = $session->get( $upload_id );

		// Check if expired.
		if ( time() > $upload['expires_at'] ) {
			$session->delete( $upload_id );
			$storage = new TUS_Chunk_Storage();
			$storage->delete( $upload_id );

			return new WP_Error( 'rest_upload_expired', __( 'Upload has expired.', 'resumable-uploads' ), array( 'status' => 410 ) );
		}

		$response = new WP_REST_Response( null, 200 );
		$response->header( 'Upload-Offset', $upload['offset'] );
		$response->header( 'Upload-Length', $upload['length'] );
		$response->header( 'Tus-Resumable', self::TUS_VERSION );
		// CRITICAL: Prevent proxy caching of offset.
		$response->header( 'Cache-Control', 'no-store' );

		return $response;
	}

	/**
	 * Uploads a chunk of data.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function upload_chunk( WP_REST_Request $request ) {
		// Validate Content-Type.
		$content_type = $request->get_content_type();
		if ( ! $content_type || 'application/offset+octet-stream' !== $content_type['value'] ) {
			return new WP_Error( 'rest_invalid_content_type', __( 'Content-Type must be application/offset+octet-stream.', 'resumable-uploads' ), array( 'status' => 415 ) );
		}

		$upload_id = $request->get_param( 'id' );
		$session   = new TUS_Upload_Session();
		$upload    = $session->get( $upload_id );

		// Check if expired.
		if ( time() > $upload['expires_at'] ) {
			$session->delete( $upload_id );
			$storage = new TUS_Chunk_Storage();
			$storage->delete( $upload_id );

			return new WP_Error( 'rest_upload_expired', __( 'Upload has expired.', 'resumable-uploads' ), array( 'status' => 410 ) );
		}

		// Validate offset.
		$client_offset = $request->get_header( 'Upload-Offset' );
		if ( null === $client_offset ) {
			return new WP_Error( 'rest_offset_required', __( 'Upload-Offset header is required.', 'resumable-uploads' ), array( 'status' => 400 ) );
		}

		$client_offset = (int) $client_offset;
		$server_offset = (int) $upload['offset'];

		// 409 Conflict: Do NOT store any data on offset mismatch.
		if ( $client_offset !== $server_offset ) {
			return new WP_Error( 'rest_offset_mismatch', __( 'Upload offset mismatch.', 'resumable-uploads' ), array( 'status' => 409 ) );
		}

		// Get chunk data.
		$chunk_data = $request->get_body();
		if ( empty( $chunk_data ) ) {
			return new WP_Error( 'rest_empty_chunk', __( 'No data received.', 'resumable-uploads' ), array( 'status' => 400 ) );
		}

		// Write chunk.
		$storage    = new TUS_Chunk_Storage();
		$new_offset = $storage->append( $upload_id, $chunk_data, $server_offset );

		if ( is_wp_error( $new_offset ) ) {
			return $new_offset;
		}

		// Update session.
		$session->update_offset( $upload_id, $new_offset );

		// Check if upload is complete.
		if ( $new_offset >= $upload['length'] ) {
			$attachment = $this->finalize_upload( $upload_id, $upload );

			if ( is_wp_error( $attachment ) ) {
				return $attachment;
			}

			$response = new WP_REST_Response( $attachment, 200 );
			$response->header( 'Upload-Offset', $new_offset );
			$response->header( 'Tus-Resumable', self::TUS_VERSION );

			return $response;
		}

		$response = new WP_REST_Response( null, 204 );
		$response->header( 'Upload-Offset', $new_offset );
		$response->header( 'Tus-Resumable', self::TUS_VERSION );

		return $response;
	}

	/**
	 * Deletes an upload.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response Response object on success.
	 */
	public function delete_item( $request ): WP_REST_Response {
		$upload_id = $request->get_param( 'id' );

		$session = new TUS_Upload_Session();
		$storage = new TUS_Chunk_Storage();

		$session->delete( $upload_id );
		$storage->delete( $upload_id );

		$response = new WP_REST_Response( null, 204 );
		$response->header( 'Tus-Resumable', self::TUS_VERSION );

		return $response;
	}

	/**
	 * Finalizes an upload and creates the attachment.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id   The upload ID.
	 * @param array  $upload_data The upload session data.
	 * @return array|WP_Error Attachment data from wp_prepare_attachment_for_js() on success, WP_Error on failure.
	 */
	protected function finalize_upload( string $upload_id, array $upload_data ) {
		$storage    = new TUS_Chunk_Storage();
		$chunk_path = $storage->get_path( $upload_id );
		$filename   = $upload_data['filename'];

		// Validate actual MIME type from file contents.
		$validated = wp_check_filetype_and_ext( $chunk_path, $filename );

		if ( ! $validated['type'] ) {
			$storage->delete( $upload_id );
			( new TUS_Upload_Session() )->delete( $upload_id );

			return new WP_Error( 'rest_invalid_file_type', __( 'Sorry, you are not allowed to upload this file type.', 'resumable-uploads' ), array( 'status' => 400 ) );
		}

		// For images, verify actual image data (prevents PHP-in-image attacks).
		if ( str_starts_with( $validated['type'], 'image/' ) ) {
			$actual_mime = wp_get_image_mime( $chunk_path );
			if ( ! $actual_mime || $actual_mime !== $validated['type'] ) {
				$storage->delete( $upload_id );
				( new TUS_Upload_Session() )->delete( $upload_id );

				return new WP_Error( 'rest_invalid_image', __( 'File is not a valid image.', 'resumable-uploads' ), array( 'status' => 400 ) );
			}
		}

		// Correct filename if extension doesn't match detected type.
		if ( ! empty( $validated['proper_filename'] ) ) {
			$filename = $validated['proper_filename'];
		}

		// Sanitize filename.
		$filename = sanitize_file_name( $filename );

		// Fire prefilter hook (virus scanners, etc.).
		$file_array = array(
			'name'     => $filename,
			'type'     => $validated['type'],
			'tmp_name' => $chunk_path,
			'size'     => filesize( $chunk_path ),
			'error'    => 0,
		);

		/** This filter is documented in wp-admin/includes/file.php */
		$file_array = apply_filters( 'wp_handle_upload_prefilter', $file_array );

		if ( ! empty( $file_array['error'] ) && is_string( $file_array['error'] ) ) {
			$storage->delete( $upload_id );
			( new TUS_Upload_Session() )->delete( $upload_id );

			return new WP_Error( 'rest_upload_error', $file_array['error'], array( 'status' => 400 ) );
		}

		// Check multisite quota.
		if ( is_multisite() ) {
			$space_used    = get_space_used();
			$space_allowed = get_space_allowed();
			$file_size_mb  = filesize( $chunk_path ) / MB_IN_BYTES;

			if ( $space_used + $file_size_mb > $space_allowed ) {
				$storage->delete( $upload_id );
				( new TUS_Upload_Session() )->delete( $upload_id );

				return new WP_Error( 'rest_quota_exceeded', __( 'You have used your space quota.', 'resumable-uploads' ), array( 'status' => 400 ) );
			}
		}

		// Move to uploads directory.
		$upload_dir      = wp_upload_dir();
		$unique_filename = wp_unique_filename( $upload_dir['path'], $filename );
		$new_path        = trailingslashit( $upload_dir['path'] ) . $unique_filename;

		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename -- Silencing rename errors to handle gracefully.
		if ( ! @rename( $chunk_path, $new_path ) ) {
			// Try copy + delete as fallback (cross-filesystem moves).
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_copy -- Fallback for cross-filesystem moves.
			if ( ! @copy( $chunk_path, $new_path ) ) {
				$storage->delete( $upload_id );
				( new TUS_Upload_Session() )->delete( $upload_id );

				return new WP_Error( 'rest_move_failed', __( 'Could not move uploaded file.', 'resumable-uploads' ), array( 'status' => 500 ) );
			}
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation needed.
			@unlink( $chunk_path );
		}

		// Fire post-upload hook.
		$upload_result = array(
			'file' => $new_path,
			'url'  => trailingslashit( $upload_dir['url'] ) . $unique_filename,
			'type' => $validated['type'],
		);

		/** This filter is documented in wp-admin/includes/file.php */
		$upload_result = apply_filters( 'wp_handle_upload', $upload_result, 'upload' );

		// Create attachment.
		$attachment = array(
			'post_mime_type' => $upload_result['type'],
			'post_title'     => preg_replace( '/\.[^.]+$/', '', $unique_filename ),
			'post_status'    => 'inherit',
			'guid'           => $upload_result['url'],
		);

		$attachment_id = wp_insert_attachment( $attachment, $upload_result['file'] );

		if ( is_wp_error( $attachment_id ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink, WordPress.PHP.NoSilencedErrors.Discouraged -- Direct file operation needed.
			@unlink( $new_path );
			( new TUS_Upload_Session() )->delete( $upload_id );

			return $attachment_id;
		}

		// Generate metadata (thumbnails, video metadata, etc.).
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		$metadata = wp_generate_attachment_metadata( $attachment_id, $upload_result['file'] );
		wp_update_attachment_metadata( $attachment_id, $metadata );

		// Cleanup session and storage directory.
		$storage->cleanup( $upload_id );
		( new TUS_Upload_Session() )->delete( $upload_id );

		// Return attachment data in the format WordPress media library expects.
		return wp_prepare_attachment_for_js( $attachment_id );
	}

	/**
	 * Parses the Upload-Metadata header.
	 *
	 * @since 0.1.0
	 *
	 * @param string|null $header The Upload-Metadata header value.
	 * @return array Parsed metadata as key-value pairs.
	 */
	protected function parse_upload_metadata( ?string $header ): array {
		if ( empty( $header ) ) {
			return array();
		}

		$metadata = array();
		$pairs    = explode( ',', $header );

		foreach ( $pairs as $pair ) {
			$pair = trim( $pair );
			if ( empty( $pair ) ) {
				continue;
			}

			$parts = explode( ' ', $pair, 2 );
			$key   = $parts[0];
			// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- TUS protocol requires base64.
			$value = isset( $parts[1] ) ? base64_decode( $parts[1], true ) : '';

			if ( false !== $value ) {
				$metadata[ $key ] = $value;
			}
		}

		return $metadata;
	}

	/**
	 * Retrieves the upload schema, conforming to JSON Schema.
	 *
	 * @since 0.1.0
	 *
	 * @return array Item schema data.
	 */
	public function get_item_schema(): array {
		if ( $this->schema ) {
			return $this->add_additional_fields_schema( $this->schema );
		}

		$this->schema = array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'tus-upload',
			'type'       => 'object',
			'properties' => array(
				'id'       => array(
					'description' => __( 'Unique identifier for the upload.', 'resumable-uploads' ),
					'type'        => 'string',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
				'offset'   => array(
					'description' => __( 'Current byte offset of the upload.', 'resumable-uploads' ),
					'type'        => 'integer',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
				'length'   => array(
					'description' => __( 'Total size of the upload in bytes.', 'resumable-uploads' ),
					'type'        => 'integer',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
				'filename' => array(
					'description' => __( 'Name of the file being uploaded.', 'resumable-uploads' ),
					'type'        => 'string',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
			),
		);

		return $this->add_additional_fields_schema( $this->schema );
	}
}

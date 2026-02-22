<?php
/**
 * REST API: Uploads_Unleashed_TUS_Controller class
 *
 * @package uploads-unleashed
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
class Uploads_Unleashed_TUS_Controller extends WP_REST_Controller {

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
	const TUS_EXTENSIONS = 'creation,expiration,termination,checksum';

	/**
	 * Default maximum chunk size in bytes (10 MB).
	 *
	 * @since 0.2.0
	 * @var int
	 */
	const DEFAULT_MAX_CHUNK_SIZE = 10 * MB_IN_BYTES;

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
	protected $rest_base = 'media';

	/**
	 * Cached upload session data for the current request.
	 *
	 * Set during permission check and reused by handlers to avoid
	 * redundant transient lookups.
	 *
	 * @since 0.1.0
	 * @var array|null
	 */
	private ?array $current_upload = null;

	/**
	 * Registers the routes for the TUS controller.
	 *
	 * @since 0.1.0
	 */
	public function register_routes(): void {
		// HEAD, PATCH, DELETE for individual uploads.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})',
			array(
				'args' => array(
					'id' => array(
						'description' => __( 'Unique identifier for the upload.', 'uploads-unleashed' ),
						'type'        => 'string',
						'required'    => true,
					),
				),
				array(
					'methods'             => 'HEAD',
					'callback'            => array( $this, 'get_item_offset' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => 'PATCH',
					'callback'            => array( $this, 'upload_chunk' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
				// POST with X-HTTP-Method-Override for restricted environments.
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'handle_method_override' ),
					'permission_callback' => array( $this, 'method_override_permissions_check' ),
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
	 * @param WP_REST_Request  $request  The request object.
	 * @return WP_REST_Response Modified response with TUS headers.
	 */
	public function add_options_headers( WP_REST_Response $response, WP_REST_Request $request ): WP_REST_Response {

		/**
		 * Filters the maximum upload size.
		 *
		 * Allows plugins to override the maximum allowed upload size.
		 *
		 * @since 0.1.0
		 *
		 * @param int             $max_size The maximum upload size in bytes.
		 * @param WP_REST_Request $request  The request object.
		 */
		$max_size = apply_filters( 'uploads_unleashed_max_upload_size', wp_max_upload_size(), $request );

		$response->header( 'Tus-Resumable', self::TUS_VERSION );
		$response->header( 'Tus-Version', self::TUS_VERSION );
		$response->header( 'Tus-Extension', self::TUS_EXTENSIONS );
		$response->header( 'Tus-Max-Size', $max_size );

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
			return new WP_Error( 'rest_cannot_create_upload', __( 'Sorry, you are not allowed to upload files.', 'uploads-unleashed' ), array( 'status' => rest_authorization_required_code() ) );
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
		$result = $this->can_access_upload( $request );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// Check expiration for HEAD/PATCH (not DELETE - expired uploads can still be deleted).
		if ( time() > $this->current_upload['expires_at'] ) {
			$upload_id = $request->get_param( 'id' );
			$this->delete_upload( $upload_id );

			return new WP_Error( 'rest_upload_expired', __( 'Upload has expired.', 'uploads-unleashed' ), array( 'status' => 410 ) );
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
		return $this->can_access_upload( $request );
	}

	/**
	 * Checks if a given request has access via method override.
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 *
	 * @return true|WP_Error True if the request has access, WP_Error otherwise.
	 * @since 0.1.0
	 */
	public function method_override_permissions_check( WP_REST_Request $request ) {
		$override_method = $request->get_header( 'X-HTTP-Method-Override' );

		if ( empty( $override_method ) ) {
			return new WP_Error(
				'rest_method_override_required',
				__( 'X-HTTP-Method-Override header is required for POST requests to this endpoint.', 'uploads-unleashed' ),
				array( 'status' => 400 )
			);
		}

		$override_method = strtoupper( $override_method );

		// Validate the override method.
		if ( ! in_array( $override_method, array( 'HEAD', 'PATCH', 'DELETE' ), true ) ) {
			return new WP_Error(
				'rest_invalid_method_override',
				__( 'Invalid X-HTTP-Method-Override value. Must be HEAD, PATCH, or DELETE.', 'uploads-unleashed' ),
				array( 'status' => 400 )
			);
		}

		// Delegate to the appropriate permission check.
		if ( 'DELETE' === $override_method ) {
			return $this->delete_item_permissions_check( $request );
		}

		return $this->get_item_permissions_check( $request );
	}

	/**
	 * Handles POST requests with X-HTTP-Method-Override header.
	 *
	 * This enables TUS protocol support in environments where PATCH, DELETE,
	 * or HEAD methods are blocked by firewalls or server configuration.
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function handle_method_override( WP_REST_Request $request ) {
		$override_method = strtoupper( $request->get_header( 'X-HTTP-Method-Override' ) );

		switch ( $override_method ) {
			case 'HEAD':
				return $this->get_item_offset( $request );

			case 'PATCH':
				return $this->upload_chunk( $request );

			case 'DELETE':
				return $this->delete_item( $request );

			default:
				return new WP_Error(
					'rest_invalid_method_override',
					__( 'Invalid X-HTTP-Method-Override value. Must be HEAD, PATCH, or DELETE.', 'uploads-unleashed' ),
					array( 'status' => 400 )
				);
		}
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
			return new WP_Error( 'rest_upload_length_required', __( 'Upload-Length header is required.', 'uploads-unleashed' ), array( 'status' => 400 ) );
		}

		if ( ! ctype_digit( $upload_length ) ) {
			return new WP_Error( 'rest_upload_length_invalid', __( 'Upload-Length must be a positive integer.', 'uploads-unleashed' ), array( 'status' => 400 ) );
		}

		$upload_length = (int) $upload_length;

		if ( $upload_length <= 0 ) {
			return new WP_Error( 'rest_upload_length_invalid', __( 'Upload-Length must be a positive integer.', 'uploads-unleashed' ), array( 'status' => 400 ) );
		}

		/** This filter is documented in includes/class-uploads-unleashed-tus-controller.php */
		$max_size = apply_filters( 'uploads_unleashed_max_upload_size', wp_max_upload_size(), $request );

		if ( $upload_length > $max_size ) {
			return new WP_Error(
				'rest_upload_too_large',
				sprintf(
					/* translators: %s: Available space. */
					__( 'Not enough space. You have %s available.', 'uploads-unleashed' ),
					size_format( $max_size )
				),
				array( 'status' => 413 )
			);
		}

		// Parse metadata and create upload session.
		$metadata  = $this->parse_upload_metadata( $request->get_header( 'Upload-Metadata' ) );
		$session   = new Uploads_Unleashed_TUS_Upload_Session();
		$upload_id = $session->create(
			array(
				'filename' => $metadata['filename'] ?? 'unnamed',
				'filetype' => $metadata['filetype'] ?? 'application/octet-stream',
				'length'   => $upload_length,
			),
			$request
		);

		if ( is_wp_error( $upload_id ) ) {
			return $upload_id;
		}

		$upload = $session->get( $upload_id );

		/**
		 * Fires after an upload session is created.
		 *
		 * @since 0.1.0
		 *
		 * @param string          $upload_id The upload ID.
		 * @param array           $upload    The upload session data.
		 * @param WP_REST_Request $request   The request object.
		 */
		do_action( 'uploads_unleashed_upload_created', $upload_id, $upload, $request );

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
	 * @return WP_REST_Response Response object.
	 */
	public function get_item_offset( WP_REST_Request $request ): WP_REST_Response {
		$response = new WP_REST_Response( null, 200 );
		$response->header( 'Upload-Offset', $this->current_upload['offset'] );
		$response->header( 'Upload-Length', $this->current_upload['length'] );
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
			return new WP_Error( 'rest_invalid_content_type', __( 'Content-Type must be application/offset+octet-stream.', 'uploads-unleashed' ), array( 'status' => 415 ) );
		}

		$upload_id = $request->get_param( 'id' );

		// Validate offset.
		$client_offset = $request->get_header( 'Upload-Offset' );
		if ( null === $client_offset ) {
			return new WP_Error( 'rest_offset_required', __( 'Upload-Offset header is required.', 'uploads-unleashed' ), array( 'status' => 400 ) );
		}

		$client_offset = (int) $client_offset;
		$server_offset = (int) $this->current_upload['offset'];

		// 409 Conflict: Do NOT store any data on offset mismatch.
		if ( $client_offset !== $server_offset ) {
			return new WP_Error( 'rest_offset_mismatch', __( 'Upload offset mismatch.', 'uploads-unleashed' ), array( 'status' => 409 ) );
		}

		// Validate chunk size against server limit.
		$content_length = $request->get_header( 'Content-Length' );

		/**
		 * Filters the maximum allowed chunk size.
		 *
		 * Controls how large each individual PATCH request body can be.
		 * The default is 10 MB (DEFAULT_MAX_CHUNK_SIZE). Return value
		 * is clamped to a minimum of 1 MB.
		 *
		 * @since 0.2.0
		 *
		 * @param int             $max_chunk_size Maximum chunk size in bytes. Default 10 MB.
		 * @param WP_REST_Request $request        The request object.
		 */
		$max_chunk_size = (int) apply_filters( 'uploads_unleashed_max_chunk_size', self::DEFAULT_MAX_CHUNK_SIZE, $request );
		$max_chunk_size = max( $max_chunk_size, MB_IN_BYTES );

		if ( null !== $content_length && (int) $content_length > $max_chunk_size ) {
			return $this->chunk_too_large_error( $max_chunk_size );
		}

		// Get chunk data.
		$chunk_data = $request->get_body();
		if ( '' === $chunk_data ) {
			return new WP_Error( 'rest_empty_chunk', __( 'No data received.', 'uploads-unleashed' ), array( 'status' => 400 ) );
		}

		// Enforce chunk size limit on actual body (defense-in-depth for missing Content-Length).
		if ( strlen( $chunk_data ) > $max_chunk_size ) {
			return $this->chunk_too_large_error( $max_chunk_size );
		}

		// Verify checksum if provided (before truncation, so checksum covers the original payload).
		$checksum_error = $this->verify_chunk_checksum( $request, $chunk_data );
		if ( is_wp_error( $checksum_error ) ) {
			return $checksum_error;
		}

		// Truncate chunk so total upload cannot exceed declared Upload-Length.
		$remaining = (int) $this->current_upload['length'] - $server_offset;
		if ( $remaining <= 0 ) {
			return new WP_Error( 'rest_upload_already_complete', __( 'Upload has already received all expected bytes.', 'uploads-unleashed' ), array( 'status' => 409 ) );
		}
		if ( strlen( $chunk_data ) > $remaining ) {
			$chunk_data = substr( $chunk_data, 0, $remaining );
		}

		// Write chunk.
		$new_offset = ( new Uploads_Unleashed_TUS_Chunk_Storage() )->append( $upload_id, $chunk_data, $server_offset );
		if ( is_wp_error( $new_offset ) ) {
			return $new_offset;
		}

		// Update session.
		( new Uploads_Unleashed_TUS_Upload_Session() )->update_offset( $upload_id, $new_offset );

		/**
		 * Fires after a chunk is received and stored.
		 *
		 * @since 0.1.0
		 *
		 * @param string          $upload_id  The upload ID.
		 * @param int             $new_offset The new byte offset after this chunk.
		 * @param array           $upload     The upload session data.
		 * @param WP_REST_Request $request    The request object.
		 */
		do_action( 'uploads_unleashed_chunk_received', $upload_id, $new_offset, $this->current_upload, $request );

		// Check if upload is complete.
		if ( $new_offset === (int) $this->current_upload['length'] ) {
			$attachment = $this->finalize_upload( $upload_id, $this->current_upload );

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
		$upload_id   = $request->get_param( 'id' );
		$upload_data = $this->current_upload ?? ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id );

		$this->delete_upload( $upload_id );

		/**
		 * Fires after an upload is deleted/canceled.
		 *
		 * @since 0.1.0
		 *
		 * @param string     $upload_id   The upload ID.
		 * @param array|null $upload_data The upload session data (null if already deleted).
		 */
		do_action( 'uploads_unleashed_upload_deleted', $upload_id, $upload_data );

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
		$chunk_path = ( new Uploads_Unleashed_TUS_Chunk_Storage() )->get_path( $upload_id );

		/**
		 * Filters whether to proceed with finalization.
		 *
		 * Allows plugins to validate or abort finalization. Return WP_Error to abort.
		 *
		 * @since 0.1.0
		 *
		 * @param true|WP_Error $proceed     Whether to proceed with finalization.
		 * @param string        $upload_id   The upload ID.
		 * @param array         $upload_data The upload session data.
		 * @param string        $chunk_path  Path to the uploaded file.
		 */
		$proceed = apply_filters( 'uploads_unleashed_pre_finalize', true, $upload_id, $upload_data, $chunk_path );

		if ( is_wp_error( $proceed ) ) {
			$this->delete_upload( $upload_id );

			return $proceed;
		}

		/**
		 * Filters the finalization result.
		 *
		 * Allows plugins to completely override finalization. Return an array
		 * to use as the response data, WP_Error to abort, or null to continue
		 * with default finalization.
		 *
		 * @since 0.1.0
		 *
		 * @param array|WP_Error|null $result      The result to return, or null to use default.
		 * @param string              $upload_id   The upload ID.
		 * @param array               $upload_data The upload session data.
		 * @param string              $chunk_path  Path to the uploaded file.
		 */
		$custom_result = apply_filters( 'uploads_unleashed_finalize_upload', null, $upload_id, $upload_data, $chunk_path );

		if ( is_wp_error( $custom_result ) ) {
			$this->delete_upload( $upload_id );

			return $custom_result;
		}

		if ( is_array( $custom_result ) ) {
			// Custom finalization provided - clean up and return.
			$this->delete_upload( $upload_id );

			$attachment_id = $custom_result['id'] ?? 0;

			/**
			 * Fires after an upload is finalized.
			 *
			 * @since 0.1.0
			 *
			 * @param int    $attachment_id The attachment ID (0 if custom finalization didn't create one).
			 * @param string $upload_id     The upload ID.
			 * @param array  $upload_data   The upload session data.
			 */
			do_action( 'uploads_unleashed_upload_complete', $attachment_id, $upload_id, $upload_data );

			return $custom_result;
		}

		// Default finalization pipeline.
		$validated = $this->validate_file( $chunk_path, $upload_data['filename'] );
		if ( is_wp_error( $validated ) ) {
			$this->delete_upload( $upload_id );

			return $validated;
		}

		$quota_check = $this->check_multisite_quota( $chunk_path );
		if ( is_wp_error( $quota_check ) ) {
			$this->delete_upload( $upload_id );

			return $quota_check;
		}

		$upload_result = $this->sideload_to_uploads( $chunk_path, $validated['filename'], $validated['type'] );
		if ( is_wp_error( $upload_result ) ) {
			$this->delete_upload( $upload_id );

			return $upload_result;
		}

		// Clean up upload data (chunk may already be moved by sideload).
		$this->delete_upload( $upload_id );

		$attachment_id = $this->create_attachment( $upload_result );

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		/** This action is documented in includes/class-uploads-unleashed-tus-controller.php */
		do_action( 'uploads_unleashed_upload_complete', $attachment_id, $upload_id, $upload_data );

		// Get attachment data in REST API format.
		$attachment_data = $this->prepare_attachment_for_response( $attachment_id );

		/**
		 * Filters the attachment data returned after finalization.
		 *
		 * Allows plugins to add custom fields to the response.
		 *
		 * @since 0.1.0
		 *
		 * @param array $attachment_data The attachment data in REST API format.
		 * @param int   $attachment_id   The attachment ID.
		 * @param array $upload_data     The upload session data.
		 */
		return apply_filters( 'uploads_unleashed_attachment_data', $attachment_data, $attachment_id, $upload_data );
	}

	/**
	 * Validates file type and content.
	 *
	 * Checks MIME type against allowed types and verifies image content
	 * to prevent PHP-in-image attacks.
	 *
	 * @since 0.1.0
	 *
	 * @param string $file_path The path to the uploaded file.
	 * @param string $filename  The original filename.
	 * @return array|WP_Error Array with 'type' and 'filename' on success, WP_Error on failure.
	 */
	protected function validate_file( string $file_path, string $filename ) {
		$validated = wp_check_filetype_and_ext( $file_path, $filename );

		if ( ! $validated['type'] ) {
			return new WP_Error(
				'rest_invalid_file_type',
				__( 'Sorry, you are not allowed to upload this file type.', 'uploads-unleashed' ),
				array( 'status' => 400 )
			);
		}

		// For images, verify actual image data (prevents PHP-in-image attacks).
		if ( 0 === strpos( $validated['type'], 'image/' ) ) {
			$actual_mime = wp_get_image_mime( $file_path );
			if ( ! $actual_mime || $actual_mime !== $validated['type'] ) {
				return new WP_Error(
					'rest_invalid_image',
					__( 'File is not a valid image.', 'uploads-unleashed' ),
					array( 'status' => 400 )
				);
			}
		}

		// Correct filename if extension doesn't match detected type.
		$final_filename = $filename;
		if ( ! empty( $validated['proper_filename'] ) ) {
			$final_filename = $validated['proper_filename'];
		}

		return array(
			'type'     => $validated['type'],
			'filename' => sanitize_file_name( $final_filename ),
		);
	}

	/**
	 * Checks multisite quota constraints.
	 *
	 * @since 0.1.0
	 *
	 * @param string $file_path The path to the uploaded file.
	 * @return true|WP_Error True if quota OK, WP_Error if exceeded.
	 */
	protected function check_multisite_quota( string $file_path ) {
		if ( ! is_multisite() ) {
			return true;
		}

		$file_size = filesize( $file_path );
		if ( false === $file_size ) {
			return new WP_Error( 'rest_file_unreadable', __( 'Could not determine file size for quota check.', 'uploads-unleashed' ), array( 'status' => 500 ) );
		}

		$space_used    = get_space_used();
		$space_allowed = get_space_allowed();
		$file_size_mb  = $file_size / MB_IN_BYTES;

		if ( $space_used + $file_size_mb > $space_allowed ) {
			return new WP_Error( 'rest_quota_exceeded', __( 'You have used your space quota.', 'uploads-unleashed' ), array( 'status' => 400 ) );
		}

		return true;
	}

	/**
	 * Sideloads the completed upload into the WordPress uploads directory.
	 *
	 * Uses wp_handle_sideload() to validate, move, and apply filters,
	 * matching how WordPress core handles REST API uploads.
	 *
	 * @since 0.1.0
	 *
	 * @param string $file_path The path to the uploaded file.
	 * @param string $filename  The sanitized filename.
	 * @param string $mime_type The validated MIME type.
	 * @return array|WP_Error Upload result array on success, WP_Error on failure.
	 */
	protected function sideload_to_uploads( string $file_path, string $filename, string $mime_type ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';

		$file_data = array(
			'error'    => 0,
			'tmp_name' => $file_path,
			'name'     => $filename,
			'type'     => $mime_type,
			'size'     => filesize( $file_path ),
		);

		$result = wp_handle_sideload( $file_data, array( 'test_form' => false ) );

		if ( isset( $result['error'] ) ) {
			return new WP_Error( 'rest_upload_error', $result['error'], array( 'status' => 400 ) );
		}

		return $result;
	}

	/**
	 * Creates the WordPress attachment post.
	 *
	 * @since 0.1.0
	 *
	 * @param array $upload_result The upload result from sideload_to_uploads().
	 * @return int|WP_Error Attachment ID on success, WP_Error on failure.
	 */
	protected function create_attachment( array $upload_result ) {
		$filename = basename( $upload_result['file'] );

		$attachment = array(
			'post_mime_type' => $upload_result['type'],
			'post_title'     => preg_replace( '/\.[^.]+$/', '', $filename ),
			'post_status'    => 'inherit',
			'guid'           => $upload_result['url'],
		);

		$attachment_id = wp_insert_attachment( $attachment, $upload_result['file'] );

		if ( is_wp_error( $attachment_id ) ) {
			wp_delete_file( $upload_result['file'] );

			return $attachment_id;
		}

		// Generate metadata (thumbnails, video metadata, etc.).
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		$metadata = wp_generate_attachment_metadata( $attachment_id, $upload_result['file'] );
		wp_update_attachment_metadata( $attachment_id, $metadata );

		return $attachment_id;
	}

	/**
	 * Prepares attachment data in REST API format.
	 *
	 * Uses WP_REST_Attachments_Controller to ensure consistent format
	 * with the standard /wp/v2/media endpoint.
	 *
	 * @since 0.1.0
	 *
	 * @param int $attachment_id The attachment ID.
	 * @return array Attachment data in REST API format.
	 */
	protected function prepare_attachment_for_response( int $attachment_id ): array {
		$controller = new WP_REST_Attachments_Controller( 'attachment' );
		$post       = get_post( $attachment_id );
		$request    = new WP_REST_Request( 'GET' );
		$request->set_param( 'context', 'edit' );

		$response = $controller->prepare_item_for_response( $post, $request );

		return $response->get_data();
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
	 * Verifies the checksum of uploaded chunk data.
	 *
	 * The Upload-Checksum header format is: "{algorithm} {base64-encoded-checksum}"
	 * Example: "sha256 aGVsbG8gd29ybGQ="
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request    The request object.
	 * @param string          $chunk_data The raw chunk data to verify.
	 * @return true|WP_Error True if checksum is valid or not provided, WP_Error on mismatch.
	 */
	protected function verify_chunk_checksum( WP_REST_Request $request, string $chunk_data ) {
		$checksum_header = $request->get_header( 'Upload-Checksum' );

		// Checksum is optional per TUS spec.
		if ( empty( $checksum_header ) ) {
			return true;
		}

		// Parse header: "{algorithm} {base64-checksum}".
		$parts = explode( ' ', $checksum_header, 2 );
		if ( count( $parts ) !== 2 ) {
			return new WP_Error(
				'rest_invalid_checksum_format',
				__( 'Invalid Upload-Checksum header format. Expected: "algorithm base64checksum".', 'uploads-unleashed' ),
				array( 'status' => 400 )
			);
		}

		$algorithm        = strtolower( $parts[0] );
		$expected_encoded = $parts[1];

		// Validate algorithm is supported.
		$supported_algorithms = array( 'sha256', 'sha1', 'md5' );
		if ( ! in_array( $algorithm, $supported_algorithms, true ) ) {
			return new WP_Error(
				'rest_unsupported_checksum_algorithm',
				sprintf(
					/* translators: 1: received algorithm, 2: comma-separated list of supported algorithms */
					__( 'Unsupported checksum algorithm "%1$s". Supported: %2$s.', 'uploads-unleashed' ),
					$algorithm,
					implode( ', ', $supported_algorithms )
				),
				array( 'status' => 400 )
			);
		}

		// Decode expected checksum.
		$expected_checksum = base64_decode( $expected_encoded, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- TUS protocol requires base64.
		if ( false === $expected_checksum ) {
			return new WP_Error(
				'rest_invalid_checksum_encoding',
				__( 'Invalid base64 encoding in Upload-Checksum header.', 'uploads-unleashed' ),
				array( 'status' => 400 )
			);
		}

		// Calculate actual checksum of chunk data.
		$actual_checksum = hash( $algorithm, $chunk_data, true );

		// Compare checksums.
		if ( ! hash_equals( $expected_checksum, $actual_checksum ) ) {
			return new WP_Error(
				'rest_checksum_mismatch',
				__( 'Checksum mismatch. The uploaded data does not match the provided checksum.', 'uploads-unleashed' ),
				array( 'status' => 460 ) // TUS-specific status code for checksum mismatch.
			);
		}

		return true;
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
					'description' => __( 'Unique identifier for the upload.', 'uploads-unleashed' ),
					'type'        => 'string',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
				'offset'   => array(
					'description' => __( 'Current byte offset of the upload.', 'uploads-unleashed' ),
					'type'        => 'integer',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
				'length'   => array(
					'description' => __( 'Total size of the upload in bytes.', 'uploads-unleashed' ),
					'type'        => 'integer',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
				'filename' => array(
					'description' => __( 'Name of the file being uploaded.', 'uploads-unleashed' ),
					'type'        => 'string',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
			),
		);

		return $this->add_additional_fields_schema( $this->schema );
	}

	/**
	 * Checks basic upload access (exists, belongs to user).
	 *
	 * @since 0.1.0
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return true|WP_Error True if the request has access, WP_Error otherwise.
	 */
	private function can_access_upload( WP_REST_Request $request ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return new WP_Error( 'rest_cannot_view_upload', __( 'Sorry, you are not allowed to view this upload.', 'uploads-unleashed' ), array( 'status' => rest_authorization_required_code() ) );
		}

		$upload_id = $request->get_param( 'id' );
		$upload    = ( new Uploads_Unleashed_TUS_Upload_Session() )->get( $upload_id );

		if ( ! $upload ) {
			return new WP_Error( 'rest_upload_not_found', __( 'Upload not found.', 'uploads-unleashed' ), array( 'status' => 404 ) );
		}

		if ( get_current_user_id() !== $upload['user_id'] ) {
			return new WP_Error( 'rest_cannot_view_upload', __( 'Sorry, you are not allowed to view this upload.', 'uploads-unleashed' ), array( 'status' => 403 ) );
		}

		// Cache for reuse in handlers.
		$this->current_upload = $upload;

		return true;
	}

	/**
	 * Returns a WP_Error for oversized chunks.
	 *
	 * @since 0.2.0
	 *
	 * @param int $max_chunk_size Maximum chunk size in bytes.
	 * @return WP_Error
	 */
	private function chunk_too_large_error( int $max_chunk_size ): WP_Error {
		return new WP_Error(
			'rest_chunk_too_large',
			sprintf(
				/* translators: %s: Maximum chunk size. */
				__( 'Chunk size exceeds maximum allowed size of %s.', 'uploads-unleashed' ),
				size_format( $max_chunk_size )
			),
			array( 'status' => 413 )
		);
	}

	/**
	 * Deletes an upload's chunk file and session data.
	 *
	 * @since 0.1.0
	 *
	 * @param string $upload_id The upload ID to delete.
	 */
	private function delete_upload( string $upload_id ): void {
		( new Uploads_Unleashed_TUS_Chunk_Storage() )->delete( $upload_id );
		( new Uploads_Unleashed_TUS_Upload_Session() )->delete( $upload_id );
	}
}

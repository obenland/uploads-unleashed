<?php
/**
 * REST API: Uploads_Unleashed_TUS_Attachments_Controller class
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

/**
 * Creates the attachment for a finished TUS upload through core's attachments controller.
 *
 * Runs core's create_item() on a file that is already in the uploads
 * directory, so TUS uploads get the same treatment as core's own: the
 * parent post, title, caption, description and alt text fields, EXIF and
 * IPTC defaults, the generate_sub_sizes and convert_format flags, the
 * rest_insert_attachment, rest_after_insert_attachment and
 * wp_after_insert_post hooks, and metadata generation.
 *
 * @since 1.2.0
 */
class Uploads_Unleashed_TUS_Attachments_Controller extends WP_REST_Attachments_Controller {

	/**
	 * The moved upload, as returned by wp_handle_upload().
	 *
	 * @since 1.2.0
	 * @var array
	 */
	private array $file;

	/**
	 * Constructor.
	 *
	 * @since 1.2.0
	 *
	 * @param array $file The moved upload, as returned by wp_handle_upload().
	 */
	public function __construct( array $file ) {
		parent::__construct( 'attachment' );

		$this->file = $file;
	}

	/**
	 * Returns the moved upload instead of handling a file upload.
	 *
	 * Parameters are untyped to match the parent method.
	 *
	 * @since 1.2.0
	 *
	 * @param array       $files   Unused.
	 * @param array       $headers Unused.
	 * @param string|null $time    Unused.
	 * @return array The moved upload.
	 */
	protected function upload_from_file( $files, $headers, $time = null ): array {
		return $this->file;
	}

	/**
	 * Returns the moved upload instead of handling a raw upload.
	 *
	 * Parameters are untyped to match the parent method.
	 *
	 * @since 1.2.0
	 *
	 * @param string      $data    Unused.
	 * @param array       $headers Unused.
	 * @param string|null $time    Unused.
	 * @return array The moved upload.
	 */
	protected function upload_from_data( $data, $headers, $time = null ): array {
		return $this->file;
	}
}

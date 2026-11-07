<?php
/**
 * Tests for the upload context carried in Upload-Metadata.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

// phpcs:disable WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode, WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- TUS requires base64; tests read fixtures.

/**
 * Tests that finalization applies the upload context through core's attachments controller.
 *
 * @since 1.2.0
 */
class Test_Uploads_Unleashed_TUS_Upload_Context extends WP_Test_REST_TestCase {

	/**
	 * Administrator user ID.
	 *
	 * @var int
	 */
	protected static int $admin_id;

	/**
	 * Author user ID.
	 *
	 * @var int
	 */
	protected static int $author_id;

	/**
	 * Post the uploads are attached to, owned by the administrator.
	 *
	 * @var int
	 */
	protected static int $post_id;

	/**
	 * Creates the shared fixtures.
	 *
	 * @param WP_UnitTest_Factory $factory Test factory.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ): void {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id = $factory->user->create( array( 'role' => 'author' ) );
		self::$post_id   = $factory->post->create( array( 'post_author' => self::$admin_id ) );
	}

	/**
	 * Logs in the administrator.
	 */
	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	/**
	 * Removes the uploaded attachments.
	 */
	public function tear_down(): void {
		$attachment_ids = get_posts(
			array(
				'post_type'   => 'attachment',
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
			)
		);
		foreach ( $attachment_ids as $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}

		parent::tear_down();
	}

	/**
	 * Creates an upload through the REST API.
	 *
	 * @param string $contents The file contents.
	 * @param array  $metadata Upload-Metadata fields.
	 * @return WP_REST_Response The creation response.
	 */
	protected function create_upload( string $contents, array $metadata ): WP_REST_Response {
		$pairs = array();
		foreach ( $metadata as $key => $value ) {
			$pairs[] = $key . ' ' . base64_encode( (string) $value );
		}

		$request = new WP_REST_Request( 'POST', '/wp/v2/media' );
		$request->set_header( 'Upload-Length', (string) strlen( $contents ) );
		$request->set_header( 'Upload-Metadata', implode( ',', $pairs ) );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Uploads a file in one PATCH and returns the finalization response.
	 *
	 * @param string $contents The file contents.
	 * @param array  $metadata Upload-Metadata fields.
	 * @return WP_REST_Response The response to the PATCH that completes the upload.
	 */
	protected function upload( string $contents, array $metadata ): WP_REST_Response {
		$response = $this->create_upload( $contents, $metadata );
		$this->assertSame( 201, $response->get_status() );

		$request = new WP_REST_Request( 'PATCH', '/wp/v2/media/' . basename( $response->get_headers()['Location'] ) );
		$request->set_header( 'Content-Type', 'application/offset+octet-stream' );
		$request->set_header( 'Upload-Offset', '0' );
		$request->set_body( $contents );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Uploads a core test image with the given metadata.
	 *
	 * @param string $image    Image file name in the core test data.
	 * @param array  $metadata Extra Upload-Metadata fields.
	 * @return WP_REST_Response The finalization response.
	 */
	protected function upload_image( string $image, array $metadata = array() ): WP_REST_Response {
		return $this->upload(
			(string) file_get_contents( DIR_TESTDATA . '/images/' . $image ),
			array_merge(
				array(
					'filename' => $image,
					'filetype' => 'image/jpeg',
				),
				$metadata
			)
		);
	}

	/**
	 * Tests that the post field attaches the upload to its parent post.
	 */
	public function test_post_attaches_upload_to_parent(): void {
		$response = $this->upload_image( 'canola.jpg', array( 'post' => self::$post_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( self::$post_id, $response->get_data()['post'] );
	}

	/**
	 * Tests that an upload can't be attached to a post the user can't edit.
	 */
	public function test_create_rejects_post_user_cannot_edit(): void {
		wp_set_current_user( self::$author_id );

		$response = $this->create_upload(
			'test data 123',
			array(
				'filename' => 'test.txt',
				'post'     => self::$post_id,
			)
		);

		$this->assertErrorResponse( 'rest_cannot_edit', $response, 403 );
	}

	/**
	 * Tests that the block editor fields are applied to the attachment.
	 */
	public function test_fields_are_applied_to_attachment(): void {
		$response = $this->upload_image(
			'canola.jpg',
			array(
				'title'       => 'A field',
				'caption'     => 'Yellow flowers',
				'description' => 'Canola in bloom',
				'alt_text'    => 'A canola field',
			)
		);

		$attachment = get_post( $response->get_data()['id'] );

		$this->assertSame( 'A field', $attachment->post_title );
		$this->assertSame( 'Yellow flowers', $attachment->post_excerpt );
		$this->assertSame( 'Canola in bloom', $attachment->post_content );
		$this->assertSame( 'A canola field', $response->get_data()['alt_text'] );
	}

	/**
	 * Tests that core's IPTC defaults apply when no fields are given.
	 */
	public function test_image_metadata_sets_title_and_caption(): void {
		$response   = $this->upload_image( '2004-07-22-DSC_0007.jpg' );
		$attachment = get_post( $response->get_data()['id'] );

		// Core prefers the IPTC headline over the title.
		$this->assertSame( 'IPTC Headline', $attachment->post_title );
		$this->assertSame( 'IPTC Caption', $attachment->post_excerpt );
	}

	/**
	 * Tests that core's REST insert hooks fire with the upload's fields.
	 */
	public function test_fires_core_attachment_hooks(): void {
		$fired    = array();
		$callback = static function ( WP_Post $attachment, WP_REST_Request $request, bool $creating ) use ( &$fired ): void {
			$fired[ current_filter() ] = array( $attachment->ID, $request['title'], $creating );
		};
		add_action( 'rest_insert_attachment', $callback, 10, 3 );
		add_action( 'rest_after_insert_attachment', $callback, 10, 3 );

		$response = $this->upload_image( 'canola.jpg', array( 'title' => 'Hooked' ) );

		remove_action( 'rest_insert_attachment', $callback );
		remove_action( 'rest_after_insert_attachment', $callback );

		$expected = array( $response->get_data()['id'], 'Hooked', true );
		$this->assertSame( $expected, $fired['rest_insert_attachment'] );
		$this->assertSame( $expected, $fired['rest_after_insert_attachment'] );
	}

	/**
	 * Tests that generate_sub_sizes false skips sub-sizes and returns what the client needs to sideload them.
	 */
	public function test_generate_sub_sizes_false_skips_sub_sizes(): void {
		$response = $this->upload_image( 'canola.jpg', array( 'generate_sub_sizes' => 'false' ) );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertEmpty( wp_get_attachment_metadata( $data['id'] )['sizes'] );
		$this->assertNotEmpty( $data['missing_image_sizes'] );
		$this->assertSame( 640, $data['media_details']['width'] );
	}

	/**
	 * Tests that convert_format false keeps the original format for sub-sizes.
	 */
	public function test_convert_format_false_keeps_original_format(): void {
		if ( ! wp_image_editor_supports( array( 'mime_type' => 'image/webp' ) ) ) {
			$this->markTestSkipped( 'The image editor does not support WebP.' );
		}

		$to_webp = static function (): array {
			return array( 'image/jpeg' => 'image/webp' );
		};
		add_filter( 'image_editor_output_format', $to_webp );

		$converted = $this->upload_image( 'canola.jpg' );
		$original  = $this->upload_image( 'canola.jpg', array( 'convert_format' => 'false' ) );

		remove_filter( 'image_editor_output_format', $to_webp );

		$this->assertSame( 'image/webp', wp_get_attachment_metadata( $converted->get_data()['id'] )['sizes']['thumbnail']['mime-type'] );
		$this->assertSame( 'image/jpeg', wp_get_attachment_metadata( $original->get_data()['id'] )['sizes']['thumbnail']['mime-type'] );
	}
}

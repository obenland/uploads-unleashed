<?php
/**
 * Pending uploads notice tests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

/**
 * Tests for the interrupted-uploads notice on the Media Library screen.
 *
 * @covers ::uploads_unleashed_pending_uploads_notice
 */
class Test_Pending_Uploads_Notice extends WP_UnitTestCase {

	/**
	 * Loads the screen API, which only wp-admin loads.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();

		require_once ABSPATH . 'wp-admin/includes/class-wp-screen.php';
		require_once ABSPATH . 'wp-admin/includes/screen.php';
	}

	/**
	 * Resets the current screen.
	 */
	public function tear_down(): void {
		$GLOBALS['current_screen'] = null;

		parent::tear_down();
	}

	/**
	 * Returns the notice's output.
	 *
	 * @return string Output.
	 */
	protected function get_notice(): string {
		ob_start();
		uploads_unleashed_pending_uploads_notice();

		return (string) ob_get_clean();
	}

	/**
	 * Tests that the notice is hooked to admin_notices.
	 */
	public function test_hooked_to_admin_notices(): void {
		$this->assertSame( 10, has_action( 'admin_notices', 'uploads_unleashed_pending_uploads_notice' ) );
	}

	/**
	 * Tests that the Media Library gets a hidden notice for the resume UI to reveal.
	 */
	public function test_renders_hidden_notice_on_media_library(): void {
		set_current_screen( 'upload' );

		$processor = new WP_HTML_Tag_Processor( $this->get_notice() );

		$this->assertTrue( $processor->next_tag( 'div' ) );
		$this->assertSame( 'uploads-unleashed-pending-notice', $processor->get_attribute( 'id' ) );
		$this->assertSame( 'notice notice-info is-dismissible', $processor->get_attribute( 'class' ) );
		$this->assertSame( 'display:none;', $processor->get_attribute( 'style' ) );

		$this->assertTrue( $processor->next_tag( 'a' ) );
		$this->assertSame( admin_url( 'media-new.php' ), $processor->get_attribute( 'href' ) );
	}

	/**
	 * Tests that the notice links to Media → Add New with its messages.
	 */
	public function test_notice_text(): void {
		set_current_screen( 'upload' );

		$output = $this->get_notice();

		$this->assertStringContainsString( 'You have interrupted uploads.', $output );
		$this->assertStringContainsString( '>Resume uploads</a>', $output );
	}

	/**
	 * Tests that other screens get no notice.
	 *
	 * @dataProvider data_other_screens
	 *
	 * @param string $screen Screen ID.
	 */
	public function test_no_notice_on_other_screens( string $screen ): void {
		set_current_screen( $screen );

		$this->assertSame( '', $this->get_notice() );
	}

	/**
	 * Screens that aren't the Media Library.
	 *
	 * @return array[] Screen IDs.
	 */
	public function data_other_screens(): array {
		return array(
			'dashboard'           => array( 'dashboard' ),
			'Media → Add New'     => array( 'media' ),
			'attachment edit'     => array( 'attachment' ),
			'posts list'          => array( 'edit-post' ),
			'network media admin' => array( 'upload-network' ),
		);
	}

	/**
	 * Tests that there is no notice without a screen, e.g. outside wp-admin.
	 */
	public function test_no_notice_without_screen(): void {
		$this->assertNull( get_current_screen() );

		$this->assertSame( '', $this->get_notice() );
	}
}

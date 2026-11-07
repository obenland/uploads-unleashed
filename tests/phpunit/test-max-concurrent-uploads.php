<?php
/**
 * Parallel upload limit tests.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

/**
 * Tests that the parallel upload limit is passed to the TUS client.
 *
 * @since 1.2.0
 */
class Test_Uploads_Unleashed_Max_Concurrent_Uploads extends WP_UnitTestCase {

	/**
	 * Filter callback under test.
	 *
	 * @since 1.2.0
	 * @var callable|null
	 */
	private $filter;

	/**
	 * Clean up after each test.
	 *
	 * @since 1.2.0
	 */
	public function tear_down(): void {
		if ( $this->filter ) {
			remove_filter( 'uploads_unleashed_max_concurrent_uploads', $this->filter );
			$this->filter = null;
		}

		parent::tear_down();
	}

	/**
	 * Tests that the client gets a limit of 3 by default.
	 *
	 * @since 1.2.0
	 */
	public function test_default_limit_is_localized(): void {
		$this->assertSame( 3, $this->get_localized_limit() );
	}

	/**
	 * Tests that the filter changes the limit.
	 *
	 * @since 1.2.0
	 */
	public function test_filter_changes_limit(): void {
		$this->filter = static function (): int {
			return 6;
		};
		add_filter( 'uploads_unleashed_max_concurrent_uploads', $this->filter );

		$this->assertSame( 6, $this->get_localized_limit() );
	}

	/**
	 * Tests that the limit is at least 1.
	 *
	 * @since 1.2.0
	 */
	public function test_limit_is_at_least_one(): void {
		$this->filter = static function (): int {
			return 0;
		};
		add_filter( 'uploads_unleashed_max_concurrent_uploads', $this->filter );

		$this->assertSame( 1, $this->get_localized_limit() );
	}

	/**
	 * Registers the scripts again and returns the limit localized for the TUS client.
	 *
	 * @since 1.2.0
	 *
	 * @return int|null The localized limit, or null if it's missing.
	 */
	private function get_localized_limit(): ?int {
		wp_deregister_script( 'uploads-unleashed' );
		uploads_unleashed_register_scripts();

		$data = (string) wp_scripts()->get_data( 'uploads-unleashed', 'data' );
		if ( ! preg_match( '/"maxConcurrentUploads":"?(\d+)"?/', $data, $matches ) ) {
			return null;
		}

		return (int) $matches[1];
	}
}

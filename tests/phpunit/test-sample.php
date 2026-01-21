<?php
/**
 * Sample test case.
 *
 * @package resumable-uploads
 */

/**
 * Sample test case.
 */
class Test_Sample extends WP_UnitTestCase {

	/**
	 * Test that the plugin is loaded.
	 */
	public function test_plugin_loaded() {
		$this->assertTrue( defined( 'RESUMABLE_UPLOADS_VERSION' ) );
	}
}

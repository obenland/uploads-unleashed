<?php
/**
 * Minimal stand-in for the WP_CLI class the plugin's command uses.
 *
 * WP-CLI isn't loaded under PHPUnit. This records what a command outputs, so
 * tests can assert on it, and turn WP_CLI::error() into an exception instead
 * of exiting.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

/**
 * Records WP-CLI output.
 *
 * @since 1.2.0
 */
class WP_CLI {

	/**
	 * Output in the order it was written: arrays of a type and its data.
	 *
	 * @since 1.2.0
	 * @var array[]
	 */
	public static array $output = array();

	/**
	 * Clears the recorded output.
	 *
	 * @since 1.2.0
	 */
	public static function reset(): void {
		self::$output = array();
	}

	/**
	 * Records a success message.
	 *
	 * @since 1.2.0
	 *
	 * @param string $message Message.
	 */
	public static function success( string $message ): void {
		self::$output[] = array( 'success', $message );
	}

	/**
	 * Throws instead of printing the message and exiting.
	 *
	 * @since 1.2.0
	 *
	 * @param string $message Message.
	 *
	 * @throws RuntimeException Always, with the message.
	 */
	public static function error( string $message ): void {
		throw new RuntimeException( $message ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Test stub, never rendered.
	}
}

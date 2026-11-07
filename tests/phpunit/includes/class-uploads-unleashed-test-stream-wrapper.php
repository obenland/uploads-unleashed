<?php
/**
 * Stream wrapper for tests that simulates a remote uploads directory.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

// phpcs:disable WordPress.WP.AlternativeFunctions, WordPress.PHP.NoSilencedErrors.Discouraged, Generic.CodeAnalysis.UnusedFunctionParameter -- A stream wrapper calls the raw filesystem functions it wraps, and PHP dictates its method signatures.

/**
 * Stream wrapper that maps `uutest://` URLs onto a local directory.
 *
 * Stands in for a remote stream wrapper such as S3-Uploads (`s3://`) or VIP
 * (`vip://`): wp_is_stream() recognizes it, and it implements just enough for
 * wp_handle_sideload() to copy a file into it. Like those wrappers, it can't
 * lock files, and glob() can't list it.
 *
 * @since 1.2.0
 */
class Uploads_Unleashed_Test_Stream_Wrapper {

	/**
	 * The wrapper's protocol.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	const PROTOCOL = 'uutest';

	/**
	 * Local directory that `uutest://` URLs map onto.
	 *
	 * @since 1.2.0
	 * @var string
	 */
	public static string $root = '';

	/**
	 * Stream context, set by PHP.
	 *
	 * @since 1.2.0
	 * @var resource|null
	 */
	public $context;

	/**
	 * Open file handle.
	 *
	 * @since 1.2.0
	 * @var resource|null
	 */
	private $handle;

	/**
	 * Open directory handle.
	 *
	 * @since 1.2.0
	 * @var resource|null
	 */
	private $dir_handle;

	/**
	 * Registers the wrapper and maps it onto a local directory.
	 *
	 * @since 1.2.0
	 *
	 * @param string $root Local directory to map `uutest://` onto.
	 */
	public static function register( string $root ): void {
		self::$root = rtrim( $root, '/' );

		if ( ! in_array( self::PROTOCOL, stream_get_wrappers(), true ) ) {
			stream_wrapper_register( self::PROTOCOL, self::class );
		}
	}

	/**
	 * Unregisters the wrapper.
	 *
	 * @since 1.2.0
	 */
	public static function unregister(): void {
		if ( in_array( self::PROTOCOL, stream_get_wrappers(), true ) ) {
			stream_wrapper_unregister( self::PROTOCOL );
		}
	}

	/**
	 * Converts a `uutest://` URL into the local path it maps onto.
	 *
	 * @since 1.2.0
	 *
	 * @param string $url The wrapper URL.
	 * @return string The local path.
	 */
	public static function local_path( string $url ): string {
		return self::$root . '/' . ltrim( substr( $url, strlen( self::PROTOCOL . '://' ) ), '/' );
	}

	/**
	 * Opens a file.
	 *
	 * @since 1.2.0
	 *
	 * @param string      $path        The wrapper URL.
	 * @param string      $mode        The fopen() mode.
	 * @param int         $options     Stream options.
	 * @param string|null $opened_path Unused.
	 * @return bool Whether the file was opened.
	 */
	public function stream_open( string $path, string $mode, int $options, ?string &$opened_path ): bool {
		$this->handle = @fopen( self::local_path( $path ), $mode );

		return false !== $this->handle;
	}

	/**
	 * Reads from the file.
	 *
	 * @since 1.2.0
	 *
	 * @param int $count Number of bytes to read.
	 * @return string|false The data read.
	 */
	public function stream_read( int $count ) {
		return fread( $this->handle, $count );
	}

	/**
	 * Writes to the file.
	 *
	 * @since 1.2.0
	 *
	 * @param string $data The data to write.
	 * @return int Number of bytes written.
	 */
	public function stream_write( string $data ): int {
		return (int) fwrite( $this->handle, $data );
	}

	/**
	 * Closes the file.
	 *
	 * @since 1.2.0
	 */
	public function stream_close(): void {
		fclose( $this->handle );
	}

	/**
	 * Checks for end of file.
	 *
	 * @since 1.2.0
	 *
	 * @return bool Whether the pointer is at the end of the file.
	 */
	public function stream_eof(): bool {
		return feof( $this->handle );
	}

	/**
	 * Returns information about the open file.
	 *
	 * @since 1.2.0
	 *
	 * @return array|false The stat array.
	 */
	public function stream_stat() {
		return fstat( $this->handle );
	}

	/**
	 * Changes file metadata (touch, chmod, chown, chgrp).
	 *
	 * @since 1.2.0
	 *
	 * @param string $path   The wrapper URL.
	 * @param int    $option The STREAM_META_* option.
	 * @param mixed  $value  The option value.
	 * @return bool Whether the change succeeded.
	 */
	public function stream_metadata( string $path, int $option, $value ): bool {
		$local = self::local_path( $path );

		switch ( $option ) {
			case STREAM_META_TOUCH:
				return touch( $local );
			case STREAM_META_ACCESS:
				return chmod( $local, $value );
			default:
				return true;
		}
	}

	/**
	 * Returns information about a file or directory.
	 *
	 * @since 1.2.0
	 *
	 * @param string $path  The wrapper URL.
	 * @param int    $flags STREAM_URL_STAT_* flags.
	 * @return array|false The stat array, or false if it doesn't exist.
	 */
	public function url_stat( string $path, int $flags ) {
		$local = self::local_path( $path );

		if ( ! file_exists( $local ) ) {
			return false;
		}

		return stat( $local );
	}

	/**
	 * Deletes a file.
	 *
	 * @since 1.2.0
	 *
	 * @param string $path The wrapper URL.
	 * @return bool Whether the file was deleted.
	 */
	public function unlink( string $path ): bool {
		return @unlink( self::local_path( $path ) );
	}

	/**
	 * Creates a directory.
	 *
	 * @since 1.2.0
	 *
	 * @param string $path    The wrapper URL.
	 * @param int    $mode    The permissions.
	 * @param int    $options STREAM_MKDIR_RECURSIVE or 0.
	 * @return bool Whether the directory was created.
	 */
	public function mkdir( string $path, int $mode, int $options ): bool {
		return @mkdir( self::local_path( $path ), $mode, (bool) ( $options & STREAM_MKDIR_RECURSIVE ) );
	}

	/**
	 * Opens a directory.
	 *
	 * @since 1.2.0
	 *
	 * @param string $path    The wrapper URL.
	 * @param int    $options Unused.
	 * @return bool Whether the directory was opened.
	 */
	public function dir_opendir( string $path, int $options ): bool {
		$this->dir_handle = @opendir( self::local_path( $path ) );

		return false !== $this->dir_handle;
	}

	/**
	 * Reads the next directory entry.
	 *
	 * @since 1.2.0
	 *
	 * @return string|false The entry name, or false when there are no more.
	 */
	public function dir_readdir() {
		return readdir( $this->dir_handle );
	}

	/**
	 * Closes the directory handle.
	 *
	 * @since 1.2.0
	 *
	 * @return bool Always true.
	 */
	public function dir_closedir(): bool {
		closedir( $this->dir_handle );

		return true;
	}
}

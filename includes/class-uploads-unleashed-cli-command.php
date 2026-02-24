<?php
/**
 * Uploads Unleashed WP-CLI command.
 *
 * @package uploads-unleashed
 */

/**
 * Manages TUS upload sessions.
 *
 * @since 1.0.0
 */
class Uploads_Unleashed_CLI_Command {

	/**
	 * Lists active upload sessions.
	 *
	 * ## OPTIONS
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp tus list
	 *     wp tus list --format=json
	 *
	 * @subcommand list
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function list_( $args, $assoc_args ) {
		$sessions = Uploads_Unleashed_TUS_Chunk_Storage::list_active_sessions();

		if ( empty( $sessions ) ) {
			WP_CLI::success( 'No active upload sessions.' );
			return;
		}

		$items = array();
		foreach ( $sessions as $session ) {
			$progress = 0;
			if ( ! empty( $session['length'] ) ) {
				$progress = round( ( $session['offset'] / $session['length'] ) * 100 );
			}

			$user      = get_userdata( $session['user_id'] );
			$remaining = $session['expires_at'] - time();

			$items[] = array(
				'upload_id' => $session['upload_id'],
				'filename'  => $session['filename'],
				'size'      => size_format( $session['length'] ),
				'progress'  => $progress . '%',
				'user'      => $user ? $user->user_login : '#' . $session['user_id'],
				'expires'   => human_time_diff( time(), time() + $remaining ),
			);
		}

		WP_CLI\Utils\format_items(
			$assoc_args['format'] ?? 'table',
			$items,
			array( 'upload_id', 'filename', 'size', 'progress', 'user', 'expires' )
		);
	}

	/**
	 * Cancels an active upload session.
	 *
	 * ## OPTIONS
	 *
	 * <upload_id>
	 * : The upload ID to cancel.
	 *
	 * ## EXAMPLES
	 *
	 *     wp tus cancel abc-123-def
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function cancel( $args, $assoc_args ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- WP-CLI command signature.
		$upload_id = $args[0];

		$session = new Uploads_Unleashed_TUS_Upload_Session();
		$data    = $session->get( $upload_id );

		if ( ! $data ) {
			WP_CLI::error( sprintf( 'Upload session %s not found.', $upload_id ) );
		}

		$storage = new Uploads_Unleashed_TUS_Chunk_Storage();
		$storage->delete( $upload_id );
		$session->delete( $upload_id );

		WP_CLI::success( sprintf( 'Canceled upload session %s (%s).', $upload_id, $data['filename'] ) );
	}

	/**
	 * Cleans up expired upload sessions and chunk files.
	 *
	 * ## EXAMPLES
	 *
	 *     wp tus cleanup
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function cleanup( $args, $assoc_args ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter -- WP-CLI command signature.
		Uploads_Unleashed_TUS_Chunk_Storage::cleanup_expired();

		WP_CLI::success( 'Expired uploads cleaned up.' );
	}
}

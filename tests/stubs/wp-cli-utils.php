<?php
/**
 * Minimal stand-in for the WP-CLI formatting helper the plugin's command uses.
 *
 * @package uploads-unleashed
 */

declare( strict_types = 1 );

namespace WP_CLI\Utils;

/**
 * Records the items a command formats.
 *
 * @since 1.2.0
 *
 * @param string   $format Output format.
 * @param array[]  $items  Rows.
 * @param string[] $fields Columns.
 */
function format_items( string $format, array $items, array $fields ): void {
	\WP_CLI::$output[] = array(
		'items',
		array(
			'format' => $format,
			'items'  => $items,
			'fields' => $fields,
		),
	);
}

/**
 * WordPress Scripts configuration.
 *
 * @see https://developer.wordpress.org/block-editor/reference-guides/packages/packages-scripts/
 */

const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		index: path.resolve( __dirname, 'src/index.ts' ),
		'wp-uploader': path.resolve( __dirname, 'src/wp-uploader.ts' ),
		'resumable-ui': path.resolve( __dirname, 'src/resumable-ui.ts' ),
	},
};

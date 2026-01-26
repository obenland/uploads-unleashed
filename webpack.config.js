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
		'block-editor': path.resolve( __dirname, 'src/block-editor.js' ),
		plupload: path.resolve( __dirname, 'src/plupload.js' ),
		'resume-ui': path.resolve( __dirname, 'src/resume-ui.js' ),
		'tus-client': path.resolve( __dirname, 'src/tus-client.js' ),
	},
};

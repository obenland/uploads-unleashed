/**
 * WordPress Scripts configuration.
 *
 * @see https://developer.wordpress.org/block-editor/reference-guides/packages/packages-scripts/
 */

const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
// eslint-disable-next-line import/no-extraneous-dependencies
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );
const path = require( 'path' );

module.exports = {
	...defaultConfig,
	entry: {
		'block-editor': path.resolve( __dirname, 'src/block-editor.js' ),
		plupload: path.resolve( __dirname, 'src/plupload.js' ),
		'resume-ui': path.resolve( __dirname, 'src/resume-ui.js' ),
		'tus-client': path.resolve( __dirname, 'src/tus-client.js' ),
	},
	plugins: [
		...defaultConfig.plugins.filter(
			( plugin ) =>
				plugin.constructor.name !== 'DependencyExtractionWebpackPlugin'
		),
		new DependencyExtractionWebpackPlugin( {
			requestToExternal( request ) {
				if ( request === 'tus-js-client' ) {
					return 'tus';
				}
			},
			requestToHandle( request ) {
				if ( request === 'tus-js-client' ) {
					return 'uploads-unleashed-tus';
				}
			},
		} ),
	],
};

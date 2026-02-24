/**
 * Mock for @wordpress/i18n module.
 */

module.exports = {
	__: ( text ) => text,
	sprintf: ( format, ...args ) => {
		let result = format;
		let argIndex = 0;
		args.forEach( ( arg, index ) => {
			result = result.replace(
				new RegExp( `%${ index + 1 }\\$s`, 'g' ),
				String( arg )
			);
		} );
		result = result.replace( /%[ds]/g, () => String( args[ argIndex++ ] ) );
		return result;
	},
	_n: ( single, plural, count ) => ( count === 1 ? single : plural ),
	_x: ( text ) => text,
	_nx: ( single, plural, count ) => ( count === 1 ? single : plural ),
};

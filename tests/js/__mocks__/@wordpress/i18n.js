/**
 * Mock for the `@wordpress/i18n` module.
 */

export const __ = ( text ) => text;

export const sprintf = ( format, ...args ) => {
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
};

export const _n = ( single, plural, count ) =>
	count === 1 ? single : plural;

export const _x = ( text ) => text;

export const _nx = ( single, plural, count ) =>
	count === 1 ? single : plural;

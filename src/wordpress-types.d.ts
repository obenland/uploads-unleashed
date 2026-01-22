/**
 * WordPress global type declarations.
 *
 * Shared type definitions for the WordPress global objects used across
 * multiple entry points (wp-uploader.ts, media-utils.ts, resumable-ui.ts).
 *
 * @package resumable-uploads
 */

interface ApiFetchOptions {
	path?: string;
	url?: string;
	method?: string;
	body?: FormData | string | object;
	signal?: AbortSignal;
}

type ApiFetchMiddleware = (
	options: ApiFetchOptions,
	next: ( options: ApiFetchOptions ) => Promise< unknown >
) => Promise< unknown >;

interface ApiFetch {
	( options: ApiFetchOptions ): Promise< unknown >;
	use: ( middleware: ApiFetchMiddleware ) => void;
}

interface BackboneCollection {
	on: ( event: string, callback: ( model: BackboneModel ) => void ) => void;
	off: ( event: string, callback?: ( model: BackboneModel ) => void ) => void;
}

interface BackboneModel {
	get: ( attr: string ) => unknown;
	set: ( attrs: Record< string, unknown > ) => void;
}

interface PluploadFile {
	id: string;
	name: string;
	size: number;
	loaded: number;
	percent: number;
	status: number;
	type: string;
	getNative?: () => File;
	attachment?: BackboneModel;
}

interface PluploadInstance {
	id: string;
	state: number;
	files: PluploadFile[];
	bind: ( event: string, callback: ( ...args: unknown[] ) => void ) => void;
	trigger: ( event: string, ...args: unknown[] ) => void;
	removeFile: ( file: PluploadFile ) => void;
	stop: () => void;
	start: () => void;
}

interface WpUploaderInstance {
	uploader: PluploadInstance;
}

interface WpUploaderConstructor {
	new ( options: unknown ): WpUploaderInstance;
	prototype: WpUploaderInstance;
}

interface JQueryStatic {
	( callback: () => void ): void;
	( document: Document ): {
		ready: ( callback: () => void ) => void;
	};
}

declare global {
	interface Window {
		wp: {
			apiFetch?: ApiFetch;
			Uploader?: WpUploaderConstructor & {
				queue?: BackboneCollection;
			};
		};
		resumableUploads?: {
			endpoint: string;
			nonce: string;
		};
		plupload?: {
			Uploader: new ( settings: unknown ) => PluploadInstance;
		};
		uploader?: PluploadInstance;
		uploadSuccess?: ( fileObj: PluploadFile, serverData: string ) => void;
		wpFileError?: ( fileObj: PluploadFile, message: string ) => void;
		jQuery?: JQueryStatic;
	}
}

export {
	ApiFetch,
	ApiFetchMiddleware,
	ApiFetchOptions,
	BackboneCollection,
	BackboneModel,
	JQueryStatic,
	PluploadFile,
	PluploadInstance,
	WpUploaderConstructor,
	WpUploaderInstance,
};

/**
 * Mock for the `@wordpress/data` module.
 */

import { vi } from 'vitest';

export const dispatch = vi.fn( () => ( {
	createWarningNotice: vi.fn(),
	createInfoNotice: vi.fn(),
} ) );

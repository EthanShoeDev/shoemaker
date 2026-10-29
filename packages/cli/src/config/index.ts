import type { ShoeboxConfig } from './schema.ts';

export type { ShoeboxConfig } from './schema.ts';

// Identity helper so `shoebox.config.ts` gets type checking and completions.
export const defineConfig = (config: ShoeboxConfig) => config;

import type { ShoemakerConfig } from './schema.ts';

export type { ShoemakerConfig } from './schema.ts';

// Identity helper so `shoemaker.config.ts` gets type checking and completions.
export const defineConfig = (config: ShoemakerConfig) => config;

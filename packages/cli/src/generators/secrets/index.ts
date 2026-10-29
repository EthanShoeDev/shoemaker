import type { Generator, Renderer } from '../../engine/types.ts';
import { secretspecRenderer } from './secretspec.ts';
import { varlockRenderer } from './varlock.ts';

// The managers' CLIs: varlock is an npm package (root devDependency), the
// secretspec CLI comes from nixpkgs.
const secretsTooling: Generator = (ctx) => {
  switch (ctx.config.secrets) {
    case 'varlock': {
      return {
        catalog: ['varlock'],
        gitignore: ['.env.local', '.env.*.local'],
      };
    }
    case 'secretspec': {
      return { nixPackages: ['secretspec'] };
    }
    case 'none': {
      return {};
    }
  }
};

export const secretsGenerators: ReadonlyArray<Generator> = [secretsTooling];

export const secretsRenderers: ReadonlyArray<Renderer> = [
  varlockRenderer,
  secretspecRenderer,
];

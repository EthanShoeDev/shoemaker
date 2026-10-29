import type { Generator } from '../../engine/types.ts';
import { effectApiGenerator } from './effect-api.ts';
import { effectCliGenerator } from './effect-cli.ts';
import { expoGenerator } from './expo.ts';
import { foldkitGenerator } from './foldkit.ts';
import { libraryGenerator } from './library.ts';
import { tanstackStartGenerator } from './tanstack-start.ts';

export const appGenerators: ReadonlyArray<Generator> = [
  tanstackStartGenerator,
  foldkitGenerator,
  expoGenerator,
  effectApiGenerator,
  effectCliGenerator,
  libraryGenerator,
];

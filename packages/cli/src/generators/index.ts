import type { Generator, Renderer } from '../engine/types.ts';
import { appGenerators } from './apps/index.ts';
import { infraGenerators } from './infra/index.ts';
import { openspecGenerator } from './openspec/index.ts';
import { rootGenerators, rootRenderers } from './root/index.ts';
import { secretsGenerators, secretsRenderers } from './secrets/index.ts';
import {
  taskRunnerGenerators,
  taskRunnerRenderers,
} from './task-runner/index.ts';

export const generators: ReadonlyArray<Generator> = [
  ...rootGenerators,
  ...taskRunnerGenerators,
  ...secretsGenerators,
  ...appGenerators,
  ...infraGenerators,
  openspecGenerator,
];

export const renderers: ReadonlyArray<Renderer> = [
  ...rootRenderers,
  ...taskRunnerRenderers,
  ...secretsRenderers,
];

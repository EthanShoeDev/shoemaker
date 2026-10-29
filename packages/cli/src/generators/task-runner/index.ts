import type { Generator, Renderer } from '../../engine/types.ts';
import { nxRenderer } from './nx.ts';
import { baseTasks } from './tasks.ts';
import { turboRenderer } from './turbo.ts';

export const taskRunnerGenerators: ReadonlyArray<Generator> = [baseTasks];

export const taskRunnerRenderers: ReadonlyArray<Renderer> = [
  turboRenderer,
  nxRenderer,
];

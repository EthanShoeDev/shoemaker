import type { Generator } from '../../engine/types.ts';
import { alchemyInfra } from './alchemy.ts';

export const infraGenerators: ReadonlyArray<Generator> = [alchemyInfra];

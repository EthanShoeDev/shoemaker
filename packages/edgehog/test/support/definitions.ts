import { Array as Arr } from 'effect';

import type { FlagConfig, FlagDefinition, FlagRule } from '../../src/index.ts';

export const boolean = (
  rules: ReadonlyArray<FlagRule> = [],
  enabled = true,
): FlagConfig => ({
  type: 'boolean',
  enabled,
  variants: { on: true, off: false },
  defaultVariant: 'off',
  rules,
});

export const text = (
  value: string,
  rules: ReadonlyArray<FlagRule> = [],
): FlagConfig => ({
  type: 'string',
  enabled: true,
  variants: { base: value, other: 'other' },
  defaultVariant: 'base',
  rules,
});

export const define = (
  key: string,
  config: FlagConfig | null,
  version = 1,
): FlagDefinition => ({ id: `id-${key}`, key, config, version });

export const definitions = (...flags: ReadonlyArray<FlagDefinition>) =>
  new Map(Arr.map(flags, (flag) => [flag.key, flag]));

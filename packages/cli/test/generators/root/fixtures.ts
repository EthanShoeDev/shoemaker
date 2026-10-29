import { Array as Arr, Predicate } from 'effect';

import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import { generate } from '../../../src/engine/generate.ts';
import type { GeneratedFile } from '../../../src/engine/types.ts';
import { presets } from '../../presets.ts';

export const presetNames = ['minimal', 'web', 'full'] as const;

export const preset = (name: (typeof presetNames)[number]): ShoemakerConfig => {
  const config = presets[name];
  if (config === undefined) throw new Error(`no preset ${name}`);
  return config;
};

export const render = (config: ShoemakerConfig) => {
  const { files, aggregate } = generate(config);
  const byPath = new Map(Arr.map(files, (file) => [file.path, file] as const));
  const file = (path: string): GeneratedFile => {
    const found = byPath.get(path);
    if (found === undefined) throw new Error(`${path} was not generated`);
    return found;
  };
  return { files, aggregate, byPath, file };
};

export const record = (value: unknown): Record<string, unknown> =>
  Predicate.isObject(value) ? { ...value } : {};

export const parseJson = (file: GeneratedFile) => {
  const value: unknown = JSON.parse(file.content);
  return record(value);
};

import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import { generate } from '../../../src/engine/generate.ts';
import { presets } from '../../presets.ts';
import { lookup } from '../files.ts';

export const presetNames = ['minimal', 'web', 'full'] as const;

export const preset = (name: (typeof presetNames)[number]): ShoemakerConfig => {
  const config = presets[name];
  if (config === undefined) throw new Error(`no preset ${name}`);
  return config;
};

export const render = (config: ShoemakerConfig) => {
  const { files, aggregate } = generate(config);
  return { files, aggregate, ...lookup(files) };
};

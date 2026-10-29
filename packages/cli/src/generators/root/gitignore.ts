import { Array as Arr } from 'effect';

import type { Renderer } from '../../engine/types.ts';
import { managed, region } from '../shared.ts';

const BASE = [
  'node_modules',
  'dist',
  '.turbo',
  '.output',
  '.nitro',
  '.direnv',
  '*.tsbuildinfo',
  '.env.local',
  '.env.*.local',
  'coverage',
  '.vitest/',
  'tmp/',
  '*.log',
  '*.tgz',
  '.DS_Store',
  '# Dependency docs cloned for agents to read; keep them out of every hash.',
  'docs/cloned-repos-as-docs/',
  '# Agent settings and skills are tracked; local state is not.',
  '.claude/*',
  '!.claude/settings.json',
  '!.claude/skills',
];

export const gitignore: Renderer = (_ctx, aggregate) => {
  const lines = [...new Set([...BASE, ...aggregate.gitignore])];
  return [
    managed(
      '.gitignore',
      `${region('shoemaker', Arr.join(lines, '\n'), '#')}\n\n# Project-specific ignores go below.\n`,
    ),
  ];
};

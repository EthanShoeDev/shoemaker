import { Array as Arr, Record as Rec } from 'effect';

import type { ShoemakerConfig } from '../../config/schema.ts';
import type { Generator } from '../../engine/types.ts';
import { owned, seed } from '../shared.ts';
import { SKILL_ROOTS } from './roots.ts';
import { openspecSkills } from './skills.gen.ts';

export const OPENSPEC_PACKAGE = '@fission-ai/openspec';

// Off when absent, so a repo made before the feature existed is left alone.
export const hasOpenspec = (config: ShoemakerConfig) =>
  config.features.openspec === true;

// Repo-relative path -> contents.
export const openspecSkillFiles = Rec.fromEntries(
  Arr.flatMap(SKILL_ROOTS, (root) =>
    Arr.map(
      Rec.toEntries(openspecSkills),
      ([file, lines]) => [`${root}/${file}`, Arr.join(lines, '\n')] as const,
    ),
  ),
);

// `skillsScope` keeps `openspec update` from offering to move the skills to
// the home directory, where every other project's agents would load them.
const CONFIG = `schema: spec-driven
skillsScope: project
`;

export const openspecGenerator: Generator = (ctx) =>
  hasOpenspec(ctx.config)
    ? {
        files: [
          // Seeds: the specs, changes and project context are the repo's.
          seed('openspec/config.yaml', CONFIG),
          seed('openspec/specs/.gitkeep', ''),
          seed('openspec/changes/archive/.gitkeep', ''),
          // Tells OpenSpec which tools the skills are installed for.
          seed('.agents/skills/.openspec-target', 'claude own-files\n'),
          ...Arr.map(Rec.toEntries(openspecSkillFiles), ([path, content]) =>
            owned(path, content),
          ),
        ],
        // Written by OpenSpec and agents, in OpenSpec's own layout.
        ignore: [
          'openspec/**',
          ...Arr.map(SKILL_ROOTS, (root) => `${root}/openspec*/**`),
        ],
      }
    : {};

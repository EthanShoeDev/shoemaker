// Renders the agent skills of the OpenSpec that versions.ts pins into
// packages/cli/src/generators/openspec/skills.gen.ts, and into this repo,
// whose root catalog it pins to the same CLI.
//
//   bun scripts/update-openspec-skills.ts
//
// `bun run update:generated-versions` runs it when that pin moves.
import { Command } from 'effect/cli';

import { versions } from '../packages/cli/src/versions.ts';
import { vendorOpenspecSkills } from './lib/openspec-skills.ts';
import { runScript } from './lib/run.ts';

const updateSkills = Command.make('update-openspec-skills', {}, () =>
  vendorOpenspecSkills(versions['@fission-ai/openspec']),
).pipe(Command.withDescription('Vendor the pinned OpenSpec agent skills'));

runScript(Command.run(updateSkills, { version: '0.0.0' }));

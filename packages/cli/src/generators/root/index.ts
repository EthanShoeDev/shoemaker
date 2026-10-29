import type { Generator, Renderer } from '../../engine/types.ts';
import { agentFiles } from './agents.ts';
import { changesets, ci, vscode } from './editor-ci.ts';
import { gitignore } from './gitignore.ts';
import { flake, nixFiles } from './nix.ts';
import { rootCatalog, rootPackageJson, rootTooling } from './package-json.ts';
import { readmeFile } from './readme.ts';
import {
  bunfig,
  jscpdConfig,
  knipConfig,
  oxfmtConfig,
  oxlintConfig,
  rootTsconfig,
  vitestConfig,
} from './tooling.ts';

export const rootGenerators: ReadonlyArray<Generator> = [
  rootPackageJson,
  rootTooling,
  rootTsconfig,
  bunfig,
  nixFiles,
  agentFiles,
  vscode,
  ci,
  changesets,
  readmeFile,
];

export const rootRenderers: ReadonlyArray<Renderer> = [
  rootCatalog,
  oxlintConfig,
  oxfmtConfig,
  knipConfig,
  jscpdConfig,
  vitestConfig,
  flake,
  gitignore,
];

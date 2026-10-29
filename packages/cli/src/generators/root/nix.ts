import { Array as Arr, pipe } from 'effect';

import type { Generator, Renderer } from '../../engine/types.ts';
import { managed, owned } from '../shared.ts';

// Prebuilt bun release archives for the version in `packageManager`
// (package-json.ts) and the CI setup action. nixpkgs lags bun releases, so
// the flake swaps the source; bump all three together.
const BUN_VERSION = '1.4.4';
const BUN_SOURCES = [
  [
    'aarch64-darwin',
    'darwin-aarch64',
    'sha256-wkDX8My5DCY6hJ/NsJt+5iYw2SE0jtaq/ahrnVd7xRA=',
  ],
  [
    'x86_64-darwin',
    'darwin-x64',
    'sha256-UKNJH3Orwv6BZzFxqFdi07wswWgMzsrdmD3pmt93l34=',
  ],
  [
    'aarch64-linux',
    'linux-aarch64',
    'sha256-uqa7NvUdblhWHgK76oJQOKnfRU9nPW13bou/hvjHhQ4=',
  ],
  [
    'x86_64-linux',
    'linux-x64',
    'sha256-v4zL+ysLgBWeD5ptFcVTF63YB3U028YTCj7bUvzLOVw=',
  ],
] as const;

// A `#` region whose markers sit at the indentation of the body.
const nixRegion = (id: string, body: string, pad: string) =>
  Arr.join(
    [`${pad}# shoebox:begin ${id}`, body, `${pad}# shoebox:end ${id}`],
    '\n',
  );

const bunOverlay = () => {
  const sources = pipe(
    BUN_SOURCES,
    Arr.map(
      ([system, archive, hash]) => `              "${system}" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v\${finalAttrs.version}/bun-${archive}.zip";
                hash = "${hash}";
              };`,
    ),
    Arr.join('\n'),
  );
  return `    # nixpkgs lags bun releases, so repoint the prebuilt release archives at
    # the version in package.json \`packageManager\` and the CI setup action.
    # bun ships binaries only, so this is a src swap and nothing is compiled.
    # Keep the three in lockstep.
    bunOverlay = _final: prev: {
      bun = prev.bun.overrideAttrs (finalAttrs: oldAttrs: {
        version = "${BUN_VERSION}";
        __intentionallyOverridingVersion = true;
        passthru =
          oldAttrs.passthru
          // {
            sources = {
${sources}
            };
          };
      });
    };`;
};

export const flake: Renderer = (ctx, aggregate) => {
  const packages = [
    ...new Set([
      'bun',
      'nodejs_24',
      ...aggregate.nixPackages,
      ...ctx.config.nixPackages,
    ]),
  ];
  const description =
    ctx.config.description === ''
      ? ctx.config.name
      : `${ctx.config.name}: ${ctx.config.description}`;
  const content = `{
  description = ${JSON.stringify(description)};

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = {nixpkgs, ...}: let
${nixRegion('bun', bunOverlay(), '    ')}
    forAllSystems = function:
      nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
        system:
          function (import nixpkgs {
            inherit system;
            overlays = [bunOverlay];
          })
      );
  in {
    formatter = forAllSystems (pkgs: pkgs.alejandra);

    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
${nixRegion(
  'packages',
  Arr.join(
    Arr.map(packages, (p) => `          ${p}`),
    '\n',
  ),
  '          ',
)}
          # Project packages go below the region.
        ];
        shellHook = ''
${nixRegion('shell-hook', '          export TZ=UTC', '          ')}
        '';
      };
    });
  };
}
`;
  return [managed('flake.nix', content)];
};

export const nixFiles: Generator = () => ({
  files: [owned('.envrc', 'use flake\n')],
  gitignore: ['.direnv', 'result', 'result-*'],
});

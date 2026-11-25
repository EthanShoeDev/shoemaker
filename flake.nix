{
  description = "shoemaker: shared tooling and the shoemaker repo scaffolder";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = {nixpkgs, ...}: let
    # nixpkgs still ships bun 1.3.x, so repoint the prebuilt release archives
    # at 1.4.5 to match `packageManager` and CI. bun ships binaries only, so
    # this is a src swap and nothing is compiled. Keep the three in lockstep.
    bunOverlay = _final: prev: {
      bun = prev.bun.overrideAttrs (finalAttrs: oldAttrs: {
        version = "1.4.5";
        __intentionallyOverridingVersion = true;
        passthru =
          oldAttrs.passthru
          // {
            sources = {
              "aarch64-darwin" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-darwin-aarch64.zip";
                hash = "sha256-tda8LhPK8U5XyJZh6J79Bz/xYWW0G/5DiCYWQQYJzRA=";
              };
              "x86_64-darwin" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-darwin-x64.zip";
                hash = "sha256-pJcud4zOS2oZTX0onzJqphV21x2At6U+naLzc5Vm5f0=";
              };
              "aarch64-linux" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-aarch64.zip";
                hash = "sha256-GGVqO/DqVkH1eWrkITt1JVV5pwoP3tLzN5M3hVaM34Q=";
              };
              "x86_64-linux" = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-x64.zip";
                hash = "sha256-lFWbO1KJlaSUUvnyQEzsdPLv19BuCgAKjNIUsCw2Zus=";
              };
            };
          };
      });
    };
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
          bun
          nodejs_24
          git
          gh
          alejandra
          # The OpenSpec bun.lock pins, as the command its skills call.
          (writeShellScriptBin "openspec" ''
            root="$(git rev-parse --show-toplevel)" || exit 1
            exec "$root/node_modules/.bin/openspec" "$@"
          '')
        ];
        shellHook = ''
          export TZ=UTC
          # OpenSpec skills stay in the repo: ones in the home directory load in
          # every project. Upgrades come from shoemaker.
          export OPENSPEC_SKILLS_SCOPE=project
          export OPENSPEC_NO_UPDATE_CHECK=1
        '';
      };
    });
  };
}

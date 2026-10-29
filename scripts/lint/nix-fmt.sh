#!/usr/bin/env bash
# Formats nix files with the flake formatter (alejandra). Skips quietly when nix
# is not installed so contributors without nix can still run `lint:check`.
set -euo pipefail
if ! command -v nix >/dev/null 2>&1; then
  echo "nix not installed; skipping nix fmt"
  exit 0
fi
exec nix fmt "$@"

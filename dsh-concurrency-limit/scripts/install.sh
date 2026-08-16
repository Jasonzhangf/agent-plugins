#!/usr/bin/env bash
#
# Install dsh-concurrency-limit into a dsh profile.
#
# A checkout install (`dsh plugin add ./dsh-concurrency-limit`) links the
# plugin directory into the profile. The plugin imports in-box @deepseek-ai/*
# packages at runtime, so Node must resolve them from the plugin realpath:
# this script links the plugin's node_modules to the healed profiles tree
# (DSH_HOME/profiles/node_modules), builds lib/ when stale or missing, adds
# the bundle to the profile, and prints the verification/boot commands.
#
# Destructive steps (replacing a real node_modules/ or deleting lib/) never
# run without explicit --force; the default is a loud error.
#
# Usage:
#   scripts/install.sh [--profile <name>] [--dsh-checkout <dir>] [--force] [--skip-build] [--check]

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="web"
DSH_CHECKOUT=""
SKIP_BUILD=0
FORCE=0
CHECK=0

usage() { sed -n "1,22p" "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      [[ $# -ge 2 ]] || { echo "error: --profile requires a value" >&2; usage >&2; exit 2; }
      PROFILE="$2"; shift 2 ;;
    --dsh-checkout)
      [[ $# -ge 2 ]] || { echo "error: --dsh-checkout requires a value" >&2; usage >&2; exit 2; }
      DSH_CHECKOUT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --check) CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# Resolve the DSH home like the harness: $DSH_HOME (trimmed non-empty) wins,
# else Node's homedir() + /.dsh. Use node itself so tilde and homedir()
# semantics match the running dsh, not a bash approximation.
resolve_dsh_home() {
  local node_home trimmed
  node_home="$(node -p "require('os').homedir()" 2>/dev/null || echo "$HOME")"
  trimmed="$(printf "%s" "${DSH_HOME:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ -n "$trimmed" ]]; then echo "$trimmed"; else echo "$node_home/.dsh"; fi
}

command -v dsh >/dev/null || { echo "dsh CLI not found on PATH" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found on PATH (dsh requires it)" >&2; exit 1; }

DSH_HOME_RESOLVED="$(resolve_dsh_home)"
HEALED="$DSH_HOME_RESOLVED/profiles/node_modules"

if [[ "$CHECK" -eq 1 ]]; then
  echo "[check] plugin dir:       $PLUGIN_DIR"
  echo "[check] profile:          $PROFILE"
  echo "[check] dsh home:         $DSH_HOME_RESOLVED"
  echo "[check] healed modules:   $HEALED ($( [[ -d "$HEALED" ]] && echo present || echo MISSING ))"
  if [[ -L "$PLUGIN_DIR/node_modules" ]]; then
    echo "[check] node_modules:     symlink -> $(readlink "$PLUGIN_DIR/node_modules")"
  elif [[ -d "$PLUGIN_DIR/node_modules" ]]; then
    echo "[check] node_modules:     REAL DIRECTORY (must be removed with --force to install)"
  else
    echo "[check] node_modules:     absent (will be symlinked to healed tree)"
  fi
  echo "[check] lib/index.js:     $( [[ -f "$PLUGIN_DIR/lib/index.js" ]] && echo present || echo MISSING )"
  echo "[check] lib/client.js:    $( [[ -f "$PLUGIN_DIR/lib/client.js" ]] && echo present || echo MISSING )"
  echo "[check] plugin row:       $( dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -c "concurrency-limit" || true ) occurrence(s) in composed config"
  echo "[check] dry-run complete (no changes made)"
  exit 0
fi

if [[ ! -d "$HEALED" ]]; then
  echo "healed profiles node_modules not found at $HEALED (has any profile been created?)" >&2
  echo "resolved dsh home: $DSH_HOME_RESOLVED; override with DSH_HOME if this is wrong" >&2
  exit 1
fi

# --- link runtime node_modules (in-box @deepseek-ai/* resolution) ---
link_healed() { ln -sfn "$HEALED" "$PLUGIN_DIR/node_modules"; }
if [[ -L "$PLUGIN_DIR/node_modules" ]]; then
  echo "== node_modules already a symlink -> $(readlink "$PLUGIN_DIR/node_modules")"
  if [[ "$(readlink "$PLUGIN_DIR/node_modules")" != "$HEALED" ]]; then
    echo "   pointing elsewhere; relinking to $HEALED"
    link_healed
  fi
elif [[ -d "$PLUGIN_DIR/node_modules" ]]; then
  if [[ "$FORCE" -eq 1 ]]; then
    echo "== replacing real node_modules/ (--force)"
    rm -rf "$PLUGIN_DIR/node_modules"
    link_healed
  else
    echo "node_modules/ is a real directory; refusing to replace it." >&2
    echo "Run with --force to remove it (it is likely a pnpm-installed dev tree)." >&2
    exit 1
  fi
else
  link_healed
fi

# --- build lib/ when stale or missing ---
newest_lib() {
  if [[ -f "$PLUGIN_DIR/lib/client.js" && "$PLUGIN_DIR/lib/client.js" -nt "$PLUGIN_DIR/lib/index.js" ]]; then
    echo "$PLUGIN_DIR/lib/client.js"
  else
    echo "$PLUGIN_DIR/lib/index.js"
  fi
}
needs_build() {
  [[ -f "$PLUGIN_DIR/lib/index.js" && -f "$PLUGIN_DIR/lib/client.js" ]] || return 0
  local newest src
  newest="$(newest_lib)"
  while IFS= read -r src; do
    [[ "$src" -nt "$newest" ]] && return 0
  done < <(find "$PLUGIN_DIR/src" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" \) 2>/dev/null)
  return 1
}

# Build inside a subshell that temporarily points node_modules at the checkout
# toolchain and ALWAYS restores the healed symlink, even on tsdown failure.
build_with_checkout() {
  (
    cd "$PLUGIN_DIR"
    restore() { link_healed; }
    trap restore EXIT
    echo "== building lib/ with dsh checkout toolchain"
    rm -rf lib
    link_healed
    ln -sfn "$DSH_CHECKOUT/node_modules" "$PLUGIN_DIR/node_modules"
    "$DSH_CHECKOUT/node_modules/.bin/tsdown"
  )
}

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  if [[ ! -f "$PLUGIN_DIR/lib/index.js" || ! -f "$PLUGIN_DIR/lib/client.js" ]]; then
    echo "lib/ missing and --skip-build given; run pnpm install + pnpm run build first" >&2
    exit 1
  fi
  echo "== --skip-build: reusing existing lib/"
elif needs_build; then
  if [[ -d "$PLUGIN_DIR/lib" && "$FORCE" -ne 1 ]]; then
    echo "lib/ is stale; refusing to delete it without --force." >&2
    echo "Re-run with --force to rebuild (deletes lib/ and rebuilds)." >&2
    exit 1
  fi
  if [[ -n "$DSH_CHECKOUT" && -x "$DSH_CHECKOUT/node_modules/.bin/tsdown" ]]; then
    build_with_checkout
  else
    echo "lib/ is stale or missing and no --dsh-checkout given; run pnpm install + pnpm run build in the plugin first" >&2
    exit 1
  fi
else
  echo "== lib/ fresh; skipping build (--skip-build to force)"
fi

echo "== add bundle to profile $PROFILE"
dsh plugin --profile "$PROFILE" add "$PLUGIN_DIR"

echo "== verify"
dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -A5 "concurrency-limit" || {
  echo "plugin row missing from composed config" >&2
  exit 1
}

echo
echo "Installed. Boot with:  dsh --profile $PROFILE"
echo "Per-window stepper appears in the composer tool row; /concurrency shows the current cap."
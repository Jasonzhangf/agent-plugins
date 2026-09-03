#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_root"
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
npx --yes tsx --test plugin/test/opencode.test.ts plugin/test/opencode-bridge.test.ts

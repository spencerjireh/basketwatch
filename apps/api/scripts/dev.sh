#!/bin/sh
# Dev runner for the API.
#
# Why tsc and not tsx: tsx compiles with esbuild, and esbuild does not implement
# emitDecoratorMetadata. NestJS resolves constructor dependencies from that
# metadata, so under tsx every type-injected provider arrives as `undefined` and
# the failure looks like a DI bug rather than a compiler one. It cost an hour to
# find once; this comment is here so it does not cost another.
#
# So: the real compiler in watch mode, and node --watch on its output. Dev and
# prod therefore compile through exactly the same path.
#
# --env-file-if-exists loads the repo-root .env and does NOT override variables
# already set in the environment, which is what makes an inline DATABASE_URL win.
set -e

cd "$(dirname "$0")/.."

# One blocking build so dist/main.js exists before node --watch looks for it.
npx tsc -p tsconfig.json

npx tsc -p tsconfig.json --watch --preserveWatchOutput &
TSC_PID=$!
trap 'kill $TSC_PID 2>/dev/null' EXIT INT TERM

node --watch --env-file-if-exists=../../../.env dist/main.js

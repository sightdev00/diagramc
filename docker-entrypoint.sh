#!/bin/sh
set -eu

set -- archviz serve \
  --host 0.0.0.0 \
  --port "${DIAGRAMC_PORT:-8765}" \
  --state-file "${DIAGRAMC_STATE_FILE:-/data/studio-state.json}"

if [ -n "${DIAGRAMC_TOKEN:-}" ]; then
  set -- "$@" --token "$DIAGRAMC_TOKEN"
fi

exec "$@"

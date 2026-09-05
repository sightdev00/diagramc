#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist

archviz validate examples/llm_deployment_stack.yaml

archviz build examples/llm_deployment_stack.yaml \
  --theme themes/presentation.yaml \
  --format all \
  --output dist/llm_deployment_stack

echo
echo "Artifacts:"
ls -lh dist/

# DiagramC

DiagramC is an AI-assisted, local-first diagram compiler and visual editor for engineering teams.

它将可验证的结构化图数据、AI 命令预览和可编辑画布结合在一起，用于架构图、流程图、系统关系图与技术方案图。

## Why DiagramC

Most diagram tools treat the drawing as the source of truth. DiagramC keeps structure, layout and presentation separate:

```text
YAML / JSON / AI command
          ↓
Canonical Diagram Document
          ↓
Validation and layout
          ↓
Editable Studio · SVG · Mermaid · PNG
```

This makes diagrams reviewable, repeatable and suitable for both hand editing and AI-assisted workflows.

## Features

- Semantic YAML/JSON compiler with validation and deterministic SVG/Mermaid output.
- DiagramC Studio: React, AntV X6 and ELK-powered editing canvas.
- Nodes, relations, groups, layouts, themes, undo/redo and keyboard shortcuts.
- Multiple diagrams with local persistence, switching, deletion and JSON/SVG/PNG export.
- AI command preview before application; supports Ollama and OpenAI-compatible providers.
- Paste AI-generated Mermaid flowchart source and convert common nodes, subgraphs and labeled edges into editable diagrams.
- SVG import in fidelity mode (preserve appearance) or structured mode (convert to editable nodes and edges).
- Paste raw AI-generated SVG source into a new fidelity diagram; sanitization diagnostics explain removed unsafe content.
- Editable fidelity-SVG source: apply source updates directly to the canvas.
- Optional shared Studio state and protected LAN access with an automatic token.

## Quick start

Requirements:

- Python 3.10 or newer
- Node.js 22 and pnpm 11

```bash
# Python package and test tooling
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Web editor
pnpm install --frozen-lockfile
pnpm build

# Start Studio on this computer only
archviz serve
```

Open `http://127.0.0.1:8765`.

### LAN access

```bash
archviz serve --host 0.0.0.0
```

For a non-loopback listener, DiagramC automatically creates or reuses an access token in `$HOME/.diagramc/access-token` and prints the local-network URL containing `?token=...`. The browser exchanges it for an HttpOnly cookie.

The token is an access-control mechanism, not TLS. For untrusted networks, place DiagramC behind HTTPS, a VPN, or an authenticated reverse proxy.

### Docker

The container serves Studio on port `8765`. Both Studio state and the automatic LAN token are kept in the `/data` volume.

```bash
docker run --rm -p 8765:8765 -v diagramc-data:/data \
  ghcr.io/sightdev00/diagramc:latest
```

The first startup prints a protected URL with a generated token. To set a token yourself, pass `-e DIAGRAMC_TOKEN='a-long-random-value'`. Published images are created only for version tags and use `ghcr.io/sightdev00/diagramc:<version>`.

## Compiler quick start

```bash
archviz validate examples/llm_deployment_stack.yaml

archviz build examples/llm_deployment_stack.yaml \
  --theme themes/presentation.yaml \
  --format all \
  --output dist/llm_deployment_stack
```

## Development

```bash
pip install -e ".[dev]"
pnpm install --frozen-lockfile

make check
```

Useful commands:

```bash
make test          # Python tests
make lint          # Ruff linting
make format-check  # Ruff formatting check
pnpm typecheck     # TypeScript check
pnpm build         # Production web build
pnpm e2e           # Chromium Studio smoke test
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Code map](docs/CODEMAP.md)
- [Studio implementation](docs/M0_IMPLEMENTATION.md)
- [Product and technical proposal](docs/DIAGRAMC_PRODUCT_TECHNICAL_PROPOSAL.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)

## Project status

DiagramC is currently **alpha**. The semantic compiler and Studio are usable, but public APIs, document details and editor behaviors may change before 1.0.

## Contributing

Bug reports, documentation corrections, tests and focused feature proposals are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Copyright 2026 DiagramC contributors. Licensed under the [Apache License 2.0](LICENSE).

# Code map

## Entry points

| Entry point | Responsibility |
| --- | --- |
| `src/archviz/cli.py` | `archviz` CLI: validation, build, schema, migration and Studio serving. |
| `src/archviz/compiler.py` | Diagram-as-code compiler facade. |
| `src/archviz/web_server.py` | Static Studio server, Provider Gateway, shared state and token guard. |
| `apps/web/src/App.tsx` | Studio application state, editing actions, AI flow, import/export and persistence. |
| `apps/web/src/diagram.ts` | X6 rendering, ELK layout reconciliation and canvas event bindings. |

## Python compiler

```text
compiler.compile_diagram
    ↓
parser.load_diagram
    ↓
validator.raise_on_errors
    ↓
layout.layout_diagram
    ↓
render.svg or render.mermaid
```

Key modules:

- `models.py`: V1 semantic compiler IR.
- `v2/models.py`: Diagram Document 2.0 data model.
- `v2/commands.py`: atomic command transaction application.
- `v2/validator.py`: V2 document validation.
- `ai_normalizer.py`: converts relaxed provider output into strict transactions.
- `web_server.py`: validates provider input, replays transactions and serves Studio APIs.

## Web Studio

```text
App.tsx
  ├── Inspector.tsx            properties and fidelity SVG source editor
  ├── diagram.ts               X6 cells, ELK layout, selection and connection events
  ├── svgImport.ts             sanitized fidelity/structured SVG import
  ├── commandHistory.ts        persistent AI command records
  ├── modelProfiles.ts         browser-local provider profiles
  ├── sharedStore.ts           same-origin shared state API client
  └── workspaceStore.ts        browser-local workspace persistence
```

## Tests

- `tests/test_v2_*.py`: V2 model, migration, validation and commands.
- `tests/test_web_gateway.py`: Provider Gateway, token and replay behavior.
- `tests/test_*`: parser, layout, renderer and AI normalization coverage.

Browser-level Studio tests are planned next; see [ROADMAP.md](ROADMAP.md).

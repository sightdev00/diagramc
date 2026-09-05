# Architecture

DiagramC has two complementary paths that share the same goal: diagrams remain structured, reviewable and exportable.

```text
Diagram-as-code                         DiagramC Studio
YAML / JSON                             Browser editor / AI command / SVG import
      ↓                                               ↓
Python semantic IR                         Diagram Document 2.0
      ↓                                               ↓
Validate → layout → SVG/Mermaid             Validate → ELK layout → X6 canvas
      ↓                                               ↓
Artifacts / Figma                               JSON / SVG / PNG export
```

## Core boundaries

### Compiler path

The Python compiler uses a canonical semantic IR:

```text
Diagram
├── DiagramMeta
├── Group[]
├── Node[]
├── Edge[]
└── Annotation[]
```

The parser loads YAML/JSON into this IR. Validators check it before the deterministic layout and SVG/Mermaid renderers consume it. Renderers never parse source files directly.

### Studio path

The Studio stores an independent Diagram Document 2.0 with elements, relations, layouts, presentation settings, assets and metadata. Its important boundary is the transaction:

```text
User action / AI response
          ↓
Diagram Command transaction
          ↓
Pydantic and semantic validation
          ↓
Candidate document
          ↓
Human applies or discards it
```

AI providers therefore do not mutate the X6 canvas or write SVG directly. They return reviewable commands. The server applies the same validation path used by Studio history replay.

## Runtime topology

```text
Browser
  ├── React Studio + AntV X6
  ├── ELK.js layout
  ├── Local browser workspace and provider keys
  └── Same-origin requests
           ↓
archviz serve
  ├── Static Studio build
  ├── Provider Gateway
  ├── Optional shared workspace/history/model profile
  └── Token guard for non-loopback listeners
           ↓
Ollama / OpenAI-compatible provider
```

API keys are never written to the shared Studio state. Non-loopback serving requires a token, but the connection remains plain HTTP unless the deployment adds HTTPS or a trusted reverse proxy.

## SVG import modes

- **Fidelity** stores a sanitized SVG as a movable and resizable vector image. It preserves appearance and allows source editing, but it is not per-shape editing.
- **Structured** converts common SVG primitives into DiagramC nodes and relations. It enables editing but cannot guarantee exact visual equivalence.

## Extensibility

The stable boundaries are semantic documents, transactions, layout adapters and renderers. Future Graphviz, Mermaid import, Figma integration and repository-analysis adapters should connect at these boundaries rather than coupling to the canvas implementation.

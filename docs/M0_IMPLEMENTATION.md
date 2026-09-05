# DiagramC Studio alpha implementation status

Last updated: 2026-09-05

## What is implemented

### Document and command layer

- Diagram Document 2.0 JSON Schema, migration and semantic validation.
- Atomic element, relation, layout and presentation transactions.
- AI output normalization, candidate preview and manual application.
- Command history with reapply/replay support.

### Studio editing

- React + AntV X6 editor with ELK layered layout.
- Nodes, relations, groups, property editing, selection, shortcuts, undo/redo and theme controls.
- Multiple diagrams: create, switch, delete and browser persistence.
- JSON, SVG and PNG export with configurable output options.
- Current right-side panel and workspace are restored after refresh.

### SVG workflow

- Fidelity import keeps a sanitized SVG as a resizable vector canvas object.
- Structured import maps common primitives to editable DiagramC elements and relations.
- Fidelity SVG source can be edited and applied immediately to refresh the rendered image.

### AI and state

- Ollama, OpenAI and OpenAI-compatible provider profiles.
- Shared server state for workspace, command history and safe model-profile fields.
- API keys stay in the browser and are excluded from shared state.

### Serving and access control

- `archviz serve` serves Studio and the Provider Gateway from one origin.
- Loopback hosts are open for local use.
- Non-loopback hosts automatically create/reuse an access token and issue an HttpOnly cookie after token URL access.

## Running Studio

```bash
pip install -e ".[dev]"
pnpm install --frozen-lockfile
pnpm build
archviz serve
```

For LAN use:

```bash
archviz serve --host 0.0.0.0
```

The terminal prints a protected access URL. The token provides access control only; deploy HTTPS, a VPN or a trusted reverse proxy for untrusted networks.

## Known boundaries

- Fidelity SVG is intentionally an overall vector object, not an automatic per-element editor.
- Raw Mermaid and raw SVG paste-to-apply workflows are planned for v0.2.
- The web entry bundle is currently large because X6 and ELK are not code-split.
- Shared state is process-local and does not yet implement multi-user conflict resolution.
- Provider URLs are user-configurable; enterprise deployments should add host/network allowlists and request auditing.
- Browser E2E coverage is not yet in place.

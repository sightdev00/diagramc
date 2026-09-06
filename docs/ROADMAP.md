# Roadmap

## v0.1.0 — GitHub-ready alpha

- [x] Semantic YAML/JSON input, canonical IR, validation and deterministic layout.
- [x] SVG and Mermaid rendering with themes and examples.
- [x] DiagramC Studio: X6 editor, ELK layout, multi-diagram workspace and export.
- [x] AI command preview, manual apply, history and replay.
- [x] SVG fidelity/structured import and editable fidelity-SVG source.
- [x] Local and protected LAN Studio serving.
- [x] GitHub release workflow and Docker image definition (publishes on matching `v*` tags).
- [x] Browser E2E coverage for Studio editing, import/export, complex SVG and AI preview/reapply (V8 evidence uploaded by CI).
- [ ] Public demo gallery.

## v0.2.0 — AI source workflow

- [ ] Paste and apply raw SVG source directly from AI output.
- [x] Paste and apply Mermaid flowchart source directly from AI output.
- [x] Mermaid flowchart parser for common flowchart syntax, shapes, subgraphs and labels.
- [x] Improve fidelity SVG editing feedback and source diagnostics.

## v0.3.0 — Reliability and collaboration

- [x] Token rotation for automatically managed LAN tokens and session replacement.
- [x] Provider endpoint policy, rate limiting and audit-friendly security controls.
- [x] Version conflict handling for shared Studio state.
- [ ] Accessibility pass and bilingual product documentation.
- [ ] Code splitting and large-diagram performance work.

## Future layout and integration work

- [ ] Graphviz backend and advanced layout constraints.
- [ ] Edge-crossing diagnostics, fixed ports and richer routing controls.
- [ ] Reusable component library, icon resolver and additional themes.
- [ ] Figma plugin and incremental semantic-ID sync.
- [ ] Repository analysis, call-graph ingestion and CI diagram diffs.

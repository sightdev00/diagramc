# Figma Workflow

## Source of truth

`*.yaml` or `*.json` is the structural source of truth.

Do not edit generated SVG as the canonical architecture definition.

## Import

1. Build SVG:
   `archviz build diagrams/x.yaml -f svg -o dist/x.svg`
2. Drag SVG into Figma.
3. Keep imported group named `00_archviz_import`.
4. Duplicate it before visual refinement.
5. Replace frequently used visual blocks with Figma components.

## Why the SVG is Figma-friendly

The renderer uses:

- `<g id="node-*">`
- `<g id="group-*">`
- `<text>` and `<tspan>`
- vectors and paths
- no HTML `foreignObject`
- no emoji dependency

## Update loop

```text
architecture change
    ↓
edit YAML
    ↓
rebuild SVG
    ↓
import beside old Figma version
    ↓
compare semantic delta
    ↓
update affected presentation components
```

Future versions should implement a native Figma plugin using semantic node IDs for incremental synchronization.

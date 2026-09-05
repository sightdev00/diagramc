from __future__ import annotations

from pathlib import Path

from .layout import layout_diagram
from .parser import load_diagram
from .render import render_mermaid, render_svg
from .theme import load_theme
from .validator import raise_on_errors


def compile_diagram(
    input_path: str | Path,
    output_path: str | Path,
    fmt: str = "svg",
    theme_path: str | Path | None = None,
):
    diagram = load_diagram(input_path)
    diagnostics = raise_on_errors(diagram)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if fmt == "svg":
        layout = layout_diagram(diagram)
        theme = load_theme(theme_path)
        content = render_svg(diagram, layout, theme)
        output_path.write_text(content, encoding="utf-8")
    elif fmt == "mermaid":
        content = render_mermaid(diagram)
        output_path.write_text(content, encoding="utf-8")
    else:
        raise ValueError(f"Unsupported output format: {fmt}")

    return diagnostics

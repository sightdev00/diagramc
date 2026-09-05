from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from .compiler import compile_diagram
from .models import Diagram
from .parser import load_diagram
from .validator import validate_diagram
from .v2 import load_document, save_document, validate_document
from .web_server import serve as serve_studio


app = typer.Typer(
    help="archviz: engineering diagram compiler",
    no_args_is_help=True,
)
console = Console()


def _show_diagnostics(diags):
    table = Table(title="Diagnostics")
    table.add_column("Level")
    table.add_column("Message")
    for d in diags:
        style = "red" if d.level == "error" else "yellow"
        table.add_row(f"[{style}]{d.level}[/{style}]", d.message)
    if diags:
        console.print(table)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8765, "--port", min=1, max=65535),
    web_root: Optional[Path] = typer.Option(None, "--web-root"),
    state_file: Optional[Path] = typer.Option(None, "--state-file"),
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="Require this token for browser access (automatic for non-local hosts)",
    ),
):
    """Serve DiagramC Studio and its local/remote model Provider Gateway."""
    serve_studio(host=host, port=port, web_root=web_root, state_file=state_file, access_token=token)


@app.command("schema-v2")
def schema_v2(output: Path = typer.Option(Path("diagram-v2.schema.json"), "--output", "-o")):
    """Export the normative DiagramC 2.0 JSON Schema."""
    source = Path(__file__).resolve().parents[2] / "schemas" / "diagram-v2.schema.json"
    if not source.is_file():
        raise typer.BadParameter(f"schema file not found: {source}")
    output.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    console.print(f"[green]Generated[/green] {output}")


@app.command()
def validate(input: Path):
    """Validate a YAML/JSON diagram source."""
    diagram = load_diagram(input)
    diags = validate_diagram(diagram)
    _show_diagnostics(diags)
    errors = [d for d in diags if d.level == "error"]
    if errors:
        raise typer.Exit(code=1)
    console.print("[green]OK[/green]")


@app.command("validate-v2")
def validate_v2(input: Path):
    """Validate a DiagramC 2.0 document (V1 input is migrated in memory)."""
    document = load_document(input)
    diags = validate_document(document)
    _show_diagnostics(diags)
    errors = [d for d in diags if d.level == "error"]
    if errors:
        raise typer.Exit(code=1)
    console.print(
        f"[green]OK[/green] schema={document.schema_version} revision={document.document.revision}"
    )


@app.command()
def migrate(
    input: Path,
    output: Path = typer.Option(..., "--output", "-o"),
):
    """Migrate a V1 YAML/JSON diagram to the DiagramC 2.0 document format."""
    document = load_document(input)
    save_document(document, output)
    console.print(f"[green]Generated[/green] {output}")


@app.command()
def build(
    input: Path,
    output: Path = typer.Option(..., "--output", "-o"),
    format: str = typer.Option("svg", "--format", "-f", help="svg, mermaid, or all"),
    theme: Optional[Path] = typer.Option(None, "--theme"),
):
    """Build diagram artifacts."""
    fmt = format.lower()

    if fmt == "all":
        base = output
        if base.suffix:
            base = base.with_suffix("")
        svg_out = base.with_suffix(".svg")
        mmd_out = base.with_suffix(".mmd")
        compile_diagram(input, svg_out, "svg", theme)
        compile_diagram(input, mmd_out, "mermaid", theme)
        console.print(f"[green]Generated[/green] {svg_out}")
        console.print(f"[green]Generated[/green] {mmd_out}")
        return

    if fmt not in {"svg", "mermaid"}:
        raise typer.BadParameter("format must be svg, mermaid, or all")

    compile_diagram(input, output, fmt, theme)
    console.print(f"[green]Generated[/green] {output}")


@app.command()
def schema(output: Path = typer.Option(Path("diagram.schema.json"), "--output", "-o")):
    """Export JSON Schema for IDE completion / validation."""
    schema_data = Diagram.model_json_schema()
    output.write_text(json.dumps(schema_data, indent=2, ensure_ascii=False), encoding="utf-8")
    console.print(f"[green]Generated[/green] {output}")


@app.command()
def init(
    directory: Path = typer.Argument(Path(".")),
):
    """Initialize an archviz workspace."""
    (directory / "diagrams").mkdir(parents=True, exist_ok=True)
    (directory / "dist").mkdir(parents=True, exist_ok=True)
    sample = directory / "diagrams" / "example.yaml"
    if not sample.exists():
        sample.write_text(
            """diagram:
  title: Example Architecture
  direction: TB

groups:
  - id: app
    label: Application
    kind: layer
    order: 10

  - id: runtime
    label: Runtime
    kind: layer
    order: 20

nodes:
  - id: client
    label: Client
    type: application
    group: app

  - id: engine
    label: Inference Engine
    type: runtime
    group: runtime

edges:
  - source: client
    target: engine
    kind: main
""",
            encoding="utf-8",
        )
    console.print(f"[green]Initialized[/green] {directory}")

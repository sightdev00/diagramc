from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import yaml

from ..models import Diagram as DiagramV1
from .migration import migrate_v1_to_v2
from .models import DiagramDocument
from .validator import raise_on_errors


def _read_data(path: Path) -> Dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        data = yaml.safe_load(raw)
    elif path.suffix.lower() == ".json":
        data = json.loads(raw)
    else:
        raise ValueError(f"Unsupported input format: {path.suffix}")
    if not isinstance(data, dict):
        raise ValueError("Diagram document root must be an object")
    return data


def load_document(path: str | Path, *, migrate_v1: bool = True) -> DiagramDocument:
    path = Path(path)
    data = _read_data(path)
    if data.get("schemaVersion") == "2.0":
        document = DiagramDocument.model_validate(data)
    elif migrate_v1:
        document = migrate_v1_to_v2(DiagramV1.model_validate(data), document_id=path.stem)
    else:
        raise ValueError("Expected a DiagramC 2.0 document")
    raise_on_errors(document)
    return document


def save_document(document: DiagramDocument, path: str | Path) -> None:
    path = Path(path)
    data = document.to_external_dict()
    if path.suffix.lower() in {".yaml", ".yml"}:
        content = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    elif path.suffix.lower() == ".json":
        content = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    else:
        raise ValueError(f"Unsupported output format: {path.suffix}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

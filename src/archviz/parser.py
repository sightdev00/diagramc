from __future__ import annotations

import json
from pathlib import Path

import yaml

from .models import Diagram


def load_diagram(path: str | Path) -> Diagram:
    path = Path(path)
    raw = path.read_text(encoding="utf-8")

    if path.suffix.lower() in {".yaml", ".yml"}:
        data = yaml.safe_load(raw)
    elif path.suffix.lower() == ".json":
        data = json.loads(raw)
    else:
        raise ValueError(f"Unsupported input format: {path.suffix}")

    return Diagram.model_validate(data)

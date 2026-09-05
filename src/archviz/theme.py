from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import yaml


DEFAULT_THEME: Dict[str, Any] = {
    "canvas": {"fill": "#F8FAFC"},
    "text": {
        "primary": "#101828",
        "secondary": "#475467",
        "muted": "#667085",
        "font_family": "Arial, Microsoft YaHei, sans-serif",
    },
    "node": {
        "default": {"fill": "#FFFFFF", "stroke": "#98A2B3", "text": "#101828"},
        "application": {"fill": "#FFFFFF", "stroke": "#2FA55D", "text": "#173622"},
        "agent": {"fill": "#FFFFFF", "stroke": "#2FA55D", "text": "#173622"},
        "api": {"fill": "#FFFFFF", "stroke": "#2C7FD0", "text": "#153B64"},
        "gateway": {"fill": "#FFFFFF", "stroke": "#2C7FD0", "text": "#153B64"},
        "runtime": {"fill": "#FFFFFF", "stroke": "#E44B3D", "text": "#7A1D16"},
        "service": {"fill": "#FFFFFF", "stroke": "#8259C8", "text": "#43266F"},
        "model": {"fill": "#FFF8EE", "stroke": "#E7901A", "text": "#70410A"},
        "gpu": {"fill": "#FFF8EE", "stroke": "#E7901A", "text": "#70410A"},
        "cpu": {"fill": "#F1FFFF", "stroke": "#27999B", "text": "#0D6668"},
        "storage": {"fill": "#F1FFFF", "stroke": "#27999B", "text": "#0D6668"},
        "annotation": {"fill": "#FFFBF4", "stroke": "#E59622", "text": "#70410A"},
    },
    "group": {
        "default": {"fill": "#FFFFFF", "stroke": "#D0D5DD"},
        "application": {"fill": "#F0FBF4", "stroke": "#2FA55D"},
        "api": {"fill": "#F2F8FF", "stroke": "#2C7FD0"},
        "runtime": {"fill": "#FFF7F6", "stroke": "#E44B3D"},
        "product": {"fill": "#FAF7FF", "stroke": "#8259C8"},
        "hardware": {"fill": "#FFFBF5", "stroke": "#E4931C"},
        "callout": {"fill": "#FFFBF4", "stroke": "#E59622"},
    },
    "edge": {
        "main": {"stroke": "#667085", "width": 2.2, "dash": ""},
        "secondary": {"stroke": "#98A2B3", "width": 1.8, "dash": "6 5"},
        "critical": {"stroke": "#E44B3D", "width": 3.2, "dash": ""},
        "async": {"stroke": "#27999B", "width": 2.0, "dash": "3 4"},
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_theme(path: str | Path | None = None) -> dict:
    if path is None:
        return DEFAULT_THEME

    path = Path(path)
    override = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return _deep_merge(DEFAULT_THEME, override)

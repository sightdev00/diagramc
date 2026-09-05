from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ElementKind(str, Enum):
    node = "node"
    group = "group"
    lane = "lane"
    note = "note"
    image = "image"


class RelationKind(str, Enum):
    directed = "directed"
    undirected = "undirected"


class PortDirection(str, Enum):
    in_ = "in"
    out = "out"
    inout = "inout"


class PortSide(str, Enum):
    top = "top"
    right = "right"
    bottom = "bottom"
    left = "left"
    auto = "auto"


class LayoutDirection(str, Enum):
    up = "UP"
    right = "RIGHT"
    down = "DOWN"
    left = "LEFT"


class Point(StrictModel):
    x: float
    y: float


class Size(StrictModel):
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class DocumentMeta(StrictModel):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    title: str = Field(min_length=1, max_length=256)
    description: Optional[str] = Field(default=None, max_length=4096)
    diagram_type: str = Field(
        alias="diagramType",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    revision: int = Field(default=0, ge=0)
    created_at: Optional[datetime] = Field(default=None, alias="createdAt")
    updated_at: Optional[datetime] = Field(default=None, alias="updatedAt")


class Port(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    direction: PortDirection = PortDirection.inout
    side: PortSide = PortSide.auto
    data: Dict[str, Any] = Field(default_factory=dict)


class Element(StrictModel):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    kind: ElementKind
    semantic_type: str = Field(alias="semanticType", min_length=1, max_length=128)
    parent_id: Optional[str] = Field(default=None, alias="parentId")
    data: Dict[str, Any] = Field(default_factory=dict)
    ports: List[Port] = Field(default_factory=list)
    style_ref: Optional[str] = Field(default=None, alias="styleRef")
    extensions: Dict[str, Any] = Field(default_factory=dict)


class Endpoint(StrictModel):
    element_id: str = Field(alias="elementId", min_length=1, max_length=128)
    port_id: Optional[str] = Field(default=None, alias="portId")


class Relation(StrictModel):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    kind: RelationKind = RelationKind.directed
    semantic_type: str = Field(alias="semanticType", min_length=1, max_length=128)
    source: Endpoint
    target: Endpoint
    data: Dict[str, Any] = Field(default_factory=dict)
    style_ref: Optional[str] = Field(default=None, alias="styleRef")
    extensions: Dict[str, Any] = Field(default_factory=dict)


class Constraint(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=128)
    subject: Optional[str] = None
    reference: Optional[str] = None
    elements: List[str] = Field(default_factory=list)
    value: Any = None


class LayoutOverride(StrictModel):
    pinned: bool = False
    position: Optional[Point] = None
    size: Optional[Size] = None
    collapsed: bool = False


class Layout(StrictModel):
    engine: str = Field(min_length=1, max_length=128)
    profile: str = Field(min_length=1, max_length=128)
    direction: Optional[LayoutDirection] = None
    options: Dict[str, Any] = Field(default_factory=dict)
    overrides: Dict[str, LayoutOverride] = Field(default_factory=dict)


class Presentation(StrictModel):
    theme: Optional[str] = None
    target: Optional[str] = None
    styles: Dict[str, Any] = Field(default_factory=dict)


class Asset(StrictModel):
    type: str
    uri: str = Field(min_length=1)
    mime_type: Optional[str] = Field(default=None, alias="mimeType")
    checksum: Optional[str] = None


class DiagramDocument(StrictModel):
    schema_version: str = Field(default="2.0", alias="schemaVersion", pattern=r"^2\.0$")
    document: DocumentMeta
    elements: List[Element] = Field(default_factory=list)
    relations: List[Relation] = Field(default_factory=list)
    constraints: List[Constraint] = Field(default_factory=list)
    layouts: Dict[str, Layout] = Field(default_factory=dict)
    presentation: Presentation = Field(default_factory=Presentation)
    assets: Dict[str, Asset] = Field(default_factory=dict)
    extensions: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    def to_external_dict(self) -> Dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)

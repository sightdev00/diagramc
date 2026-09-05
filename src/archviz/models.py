from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Direction(str, Enum):
    TB = "TB"
    LR = "LR"


class NodeType(str, Enum):
    generic = "generic"
    application = "application"
    agent = "agent"
    api = "api"
    gateway = "gateway"
    service = "service"
    runtime = "runtime"
    model = "model"
    database = "database"
    queue = "queue"
    gpu = "gpu"
    cpu = "cpu"
    storage = "storage"
    algorithm = "algorithm"
    module = "module"
    function = "function"
    process = "process"
    thread = "thread"
    annotation = "annotation"


class EdgeKind(str, Enum):
    main = "main"
    secondary = "secondary"
    critical = "critical"
    async_ = "async"


class GroupKind(str, Enum):
    layer = "layer"
    cluster = "cluster"
    callout = "callout"


class DiagramMeta(BaseModel):
    title: str
    subtitle: Optional[str] = None
    direction: Direction = Direction.TB
    width: int = 1600
    margin: int = 40


class Group(BaseModel):
    id: str
    label: str
    kind: GroupKind = GroupKind.layer
    order: int = 0
    style: Optional[str] = None


class Node(BaseModel):
    id: str
    label: str
    type: NodeType = NodeType.generic
    group: Optional[str] = None
    description: List[str] = Field(default_factory=list)
    icon: Optional[str] = None
    style: Optional[str] = None
    width: Optional[float] = None
    height: Optional[float] = None


class Edge(BaseModel):
    source: str
    target: str
    kind: EdgeKind = EdgeKind.main
    label: Optional[str] = None


class Annotation(BaseModel):
    id: str
    label: str
    target: Optional[str] = None
    group: Optional[str] = None
    style: Optional[str] = None


class Diagram(BaseModel):
    diagram: DiagramMeta
    groups: List[Group] = Field(default_factory=list)
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
    annotations: List[Annotation] = Field(default_factory=list)


class Rect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class NodePlacement(BaseModel):
    node_id: str
    rect: Rect


class GroupPlacement(BaseModel):
    group_id: str
    rect: Rect


class LayoutResult(BaseModel):
    width: float
    height: float
    nodes: Dict[str, Rect]
    groups: Dict[str, Rect]

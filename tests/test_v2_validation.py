from archviz.v2.models import (
    DiagramDocument,
    DocumentMeta,
    Element,
    ElementKind,
    Endpoint,
    Port,
    Relation,
)
from archviz.v2.validator import validate_document


def _document(*elements: Element, relations=None) -> DiagramDocument:
    return DiagramDocument(
        document=DocumentMeta(id="validation", title="Validation", diagramType="flow"),
        elements=list(elements),
        relations=relations or [],
    )


def test_reports_missing_endpoints_and_ports():
    source = Element(
        id="source",
        kind=ElementKind.node,
        semanticType="flow.step",
        ports=[Port(id="out")],
    )
    relation = Relation(
        id="r1",
        semanticType="flow.next",
        source=Endpoint(elementId="source", portId="missing"),
        target=Endpoint(elementId="unknown"),
    )

    codes = {item.code for item in validate_document(_document(source, relations=[relation]))}
    assert {"missing-port", "missing-endpoint"} <= codes


def test_reports_parent_cycles_and_duplicate_ports():
    first = Element(
        id="first",
        kind=ElementKind.node,
        semanticType="flow.step",
        parentId="second",
        ports=[Port(id="p"), Port(id="p")],
    )
    second = Element(
        id="second",
        kind=ElementKind.group,
        semanticType="group.container",
        parentId="first",
    )

    codes = {item.code for item in validate_document(_document(first, second))}
    assert {"parent-cycle", "duplicate-port"} <= codes

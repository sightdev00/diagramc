from archviz.models import Diagram
from archviz.validator import validate_diagram


def test_missing_edge_target_is_error():
    diagram = Diagram.model_validate(
        {
            "diagram": {"title": "x"},
            "nodes": [{"id": "a", "label": "A"}],
            "edges": [{"source": "a", "target": "missing"}],
        }
    )
    diags = validate_diagram(diagram)
    assert any(d.level == "error" for d in diags)

from archviz.layout import layout_diagram
from archviz.parser import load_diagram


def test_layout_has_nodes_and_groups():
    diagram = load_diagram("examples/llm_deployment_stack.yaml")
    layout = layout_diagram(diagram)
    assert "vllm" in layout.nodes
    assert "runtime" in layout.groups
    assert layout.height > 500

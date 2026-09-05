from pathlib import Path

from archviz.parser import load_diagram


def test_load_example():
    path = Path("examples/llm_deployment_stack.yaml")
    diagram = load_diagram(path)
    assert diagram.diagram.title
    assert any(n.id == "vllm" for n in diagram.nodes)

from archviz.layout import layout_diagram
from archviz.parser import load_diagram
from archviz.render import render_mermaid, render_svg
from archviz.theme import load_theme


def test_svg_is_figma_friendly():
    diagram = load_diagram("examples/llm_deployment_stack.yaml")
    layout = layout_diagram(diagram)
    svg = render_svg(diagram, layout, load_theme())
    assert "<foreignObject" not in svg
    assert 'id="node-vllm"' in svg
    assert "<text" in svg


def test_mermaid_contains_runtime():
    diagram = load_diagram("examples/llm_deployment_stack.yaml")
    mmd = render_mermaid(diagram)
    assert "vllm" in mmd
    assert "flowchart" in mmd

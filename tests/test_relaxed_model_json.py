import pytest

from archviz.web_server import _extract_json


@pytest.mark.parametrize(
    "content",
    [
        "{'transactionId': 't-python', 'baseRevision': 0, 'actor': 'ai', 'operations': []}",
        "{transactionId: 't-json5', baseRevision: 0, actor: ai, operations: [],}",
        "<think>draft {not: the_result}</think>\n{transactionId: final, baseRevision: 0, actor: ai, operations: []}",
    ],
)
def test_accepts_common_relaxed_json_from_local_models(content):
    result = _extract_json(content)

    assert result["operations"] == []
    assert str(result["transactionId"]).startswith(("t-", "final"))


def test_still_rejects_non_object_model_output():
    with pytest.raises(ValueError, match="JSON object"):
        _extract_json("I cannot create this diagram")

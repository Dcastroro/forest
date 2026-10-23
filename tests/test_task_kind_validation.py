from copy import deepcopy

import pytest

from research.kernel import GraphCommandService, GraphError
from test_graph import command, graph


@pytest.mark.parametrize("method", ["preview", "simulate", "apply"])
@pytest.mark.parametrize("operation,wrapped", [("add_node", False), ("add_node", True), ("edit_node", False), ("edit_node", True)])
@pytest.mark.parametrize("kind", ["not_a_real_kind", ["command"], True])
def test_invalid_task_kind_is_rejected_without_mutation(tmp_path, method, operation, wrapped, kind):
    original = graph()
    service = GraphCommandService(original, tmp_path)
    before = deepcopy(service.graph)
    fields = {"config": {"kind": kind}}
    params = {("node" if operation == "add_node" else "patch"): fields} if wrapped else fields
    cmd = command(original, operation, ["a"] if operation == "edit_node" else [], **params)
    with pytest.raises(GraphError) as caught:
        getattr(service, method)(cmd)
    assert caught.value.code == "invalid_task_kind"
    assert caught.value.status_code == 422
    assert service.graph == before
    assert original == graph()
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("kind", [
    None, "", "agent", "command", "experiment", "analysis", "verification",
    "repository_clone", "research_analysis", "research_plan", "research_route_review",
    "figure", "figure_revise", "paper_generate", "paper_compile", "paper_revise",
    "literature", "ideas", "suggest_paths", "review",
])
def test_supported_task_kinds_and_inference_remain_available(tmp_path, kind):
    original = graph()
    result = GraphCommandService(original, tmp_path).apply(command(original, "add_node", config={
        "kind": kind, "custom_metadata": {"preserved": True},
    }))
    added = result["graph"]["nodes"][-1]
    assert added["config"] == {"kind": kind, "custom_metadata": {"preserved": True}}


def test_legacy_unknown_kind_does_not_block_unrelated_edit_or_repair(tmp_path):
    original = graph()
    original["nodes"][0]["config"] = {"kind": "legacy_unknown", "preserve": "metadata"}
    service = GraphCommandService(original, tmp_path)
    renamed = service.apply(command(original, "edit_node", ["a"], title="Renamed"))["graph"]
    assert renamed["nodes"][0]["config"]["kind"] == "legacy_unknown"
    repaired = GraphCommandService(renamed, tmp_path).apply(command(renamed, "edit_node", ["a"], config={"kind": "command"}))["graph"]
    assert repaired["nodes"][0]["config"] == {"kind": "command", "preserve": "metadata"}

import pytest

from pqa_eval.config.settings import get_settings
from pqa_eval.config.tenant_config import get_tenant_config, list_tenant_ids
from pqa_eval.config.thresholds import resolve_threshold, resolve_weight
from pqa_eval.core.exceptions import NoTenantContextError, UnknownTenantError
from pqa_eval.core.tenant_context import TenantContext


def test_settings_defaults_and_env_override(monkeypatch):
    monkeypatch.delenv("PQA_EVAL_PROVIDER", raising=False)
    assert get_settings().provider == "stub"
    monkeypatch.setenv("PQA_EVAL_PROVIDER", "bedrock")
    monkeypatch.setenv("PQA_EVAL_MAX_WORKERS", "2")
    s = get_settings()
    assert s.provider == "bedrock" and s.max_workers == 2
    assert s.aws_region == "ap-south-1"


def test_commerce_tenant_config_loads_with_defaults_merged():
    cfg = get_tenant_config("commerce")
    assert cfg.tenant_id == "commerce"
    # commerce overrides faithfulness to 0.95; defaults fill the rest
    assert cfg.thresholds["faithfulness"] == 0.95
    assert cfg.thresholds["private_source_guard"] == 1.0
    assert cfg.composite_floor == 0.85
    assert cfg.budgets.latency_ms > 0 and cfg.budgets.output_tokens > 0
    assert 0 < cfg.relevance_floor < 1
    assert cfg.stability.n_runs >= 2


def test_unknown_tenant_raises():
    with pytest.raises(UnknownTenantError):
        get_tenant_config("no_such_ministry")


def test_list_tenants_excludes_underscore_files():
    ids = list_tenant_ids()
    assert "commerce" in ids
    assert all(not t.startswith("_") for t in ids)


def test_threshold_resolution_layers(monkeypatch):
    with pytest.raises(NoTenantContextError):
        resolve_threshold("faithfulness")
    with TenantContext("commerce"):
        assert resolve_threshold("faithfulness") == 0.95        # tenant layer
        assert resolve_threshold("answer_relevancy") == 0.80    # defaults layer
        monkeypatch.setenv("PQA_EVAL_THRESHOLD__COMMERCE__FAITHFULNESS", "0.5")
        assert resolve_threshold("faithfulness") == 0.5         # env layer wins
        with pytest.raises(KeyError):
            resolve_threshold("not_a_metric")


def _tenant_dir_with(tmp_path, monkeypatch, mutate):
    """Copy the packaged tenant configs to a temp dir, mutate commerce.yaml,
    and point config_dir at it."""
    import shutil

    import yaml

    src = get_settings().config_dir
    dst = tmp_path / "tenants"
    shutil.copytree(src, dst)
    path = dst / "commerce.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    mutate(data)
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    monkeypatch.setenv("PQA_EVAL_CONFIG_DIR", str(dst))
    return dst


def test_defaults_define_a_threshold_and_weight_for_every_metric():
    cfg = get_tenant_config("commerce")
    assert set(cfg.thresholds) == set(cfg.weights)
    assert len(cfg.thresholds) == 18


def test_mistyped_threshold_key_is_rejected_not_ignored(tmp_path, monkeypatch):
    """A typo'd metric name must fail loudly. Silently accepting it would let a
    ministry believe it had tightened a bar that never bound."""
    def mutate(data):
        data.setdefault("thresholds", {})["faithfullness"] = 0.98  # typo

    _tenant_dir_with(tmp_path, monkeypatch, mutate)
    with pytest.raises(ValueError, match="threshold but no weight"):
        get_tenant_config("commerce")


def test_mistyped_weight_key_is_rejected(tmp_path, monkeypatch):
    def mutate(data):
        data["weights"] = {"faythfulness": 0.5}  # typo

    _tenant_dir_with(tmp_path, monkeypatch, mutate)
    with pytest.raises(ValueError, match="weight but no threshold"):
        get_tenant_config("commerce")


def test_enabled_metrics_must_be_known(tmp_path, monkeypatch):
    def mutate(data):
        data["enabled_metrics"] = ["faithfulness", "not_a_real_metric"]

    _tenant_dir_with(tmp_path, monkeypatch, mutate)
    with pytest.raises(ValueError, match="unknown metric"):
        get_tenant_config("commerce")


def test_weights_sum_to_one_over_defaults():
    with TenantContext("commerce"):
        names = [
            "faithfulness", "answer_relevancy", "context_precision",
            "context_recall", "context_utilization", "contextual_relevancy",
            "hallucination", "subquestion_completeness", "citation_quality",
            "annexure_fidelity", "terminology_style", "no_speculation",
        ]
        assert abs(sum(resolve_weight(n) for n in names) - 1.0) < 1e-9
        assert resolve_weight("private_source_guard") == 0.0  # veto, never averaged

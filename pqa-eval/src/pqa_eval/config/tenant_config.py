from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from pqa_eval.config.settings import get_settings
from pqa_eval.core.exceptions import UnknownTenantError


class Budgets(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    latency_ms: int
    output_tokens: int


class Stability(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    n_runs: int
    max_std: float


class Terminology(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    style_notes: str = ""
    banned_terms: list[str] = Field(default_factory=list)
    question_type_styles: dict[str, str] = Field(default_factory=dict)


class LiveEndpoint(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    url: str | None = None
    timeout_s: int = 60


class TenantConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    display_name: str = ""
    thresholds: dict[str, float]
    weights: dict[str, float]
    composite_floor: float
    budgets: Budgets
    relevance_floor: float
    stability: Stability
    baseline_run_id: str | None = None
    terminology: Terminology
    live_endpoint: LiveEndpoint
    enabled_metrics: list[str] | None = None

    @model_validator(mode="after")
    def _every_metric_has_a_threshold_and_a_weight(self) -> "TenantConfig":
        """Reject a config where the threshold and weight key sets disagree.

        Without this, a mis-typed metric name in a tenant file is silently
        accepted and does nothing — a ministry could set `faithfullness: 0.98`,
        believe it had tightened its bar, and keep running at the default. A
        threshold that does not bind is worse than no threshold at all.
        """
        missing_weight = sorted(set(self.thresholds) - set(self.weights))
        missing_threshold = sorted(set(self.weights) - set(self.thresholds))
        if missing_weight or missing_threshold:
            problems = []
            if missing_weight:
                problems.append(f"have a threshold but no weight: {missing_weight}")
            if missing_threshold:
                problems.append(f"have a weight but no threshold: {missing_threshold}")
            raise ValueError(
                f"Tenant '{self.tenant_id}' config is inconsistent — {'; '.join(problems)}. "
                f"Every metric needs both. A name appearing on only one side is "
                f"almost always a typo, and a mis-typed override binds nothing."
            )
        return self

    @model_validator(mode="after")
    def _enabled_metrics_are_known(self) -> "TenantConfig":
        if self.enabled_metrics is not None:
            unknown = sorted(set(self.enabled_metrics) - set(self.thresholds))
            if unknown:
                raise ValueError(
                    f"Tenant '{self.tenant_id}' enables unknown metric(s) {unknown}. "
                    f"Known: {sorted(self.thresholds)}"
                )
        return self


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def list_tenant_ids() -> list[str]:
    cfg_dir = get_settings().config_dir
    return sorted(
        p.stem for p in cfg_dir.glob("*.yaml") if not p.name.startswith("_")
    )


def get_tenant_config(tenant_id: str) -> TenantConfig:
    cfg_dir = get_settings().config_dir
    path = cfg_dir / f"{tenant_id}.yaml"
    if tenant_id.startswith("_") or not path.is_file():
        raise UnknownTenantError(
            f"No tenant config at {path}. Known tenants: {list_tenant_ids()}"
        )
    merged = _deep_merge(_load_yaml(cfg_dir / "_defaults.yaml"), _load_yaml(path))
    cfg = TenantConfig(**merged)
    if cfg.tenant_id != tenant_id:
        raise UnknownTenantError(
            f"{path} declares tenant_id '{cfg.tenant_id}', expected '{tenant_id}'"
        )
    return cfg

from __future__ import annotations

import os

from pqa_eval.config.tenant_config import get_tenant_config
from pqa_eval.core.tenant_context import TenantContext


def _env_override(tenant_id: str, metric_name: str) -> float | None:
    key = f"PQA_EVAL_THRESHOLD__{tenant_id.upper()}__{metric_name.upper()}"
    raw = os.getenv(key)
    return float(raw) if raw is not None else None


def resolve_threshold(metric_name: str) -> float:
    """env override -> tenant yaml -> _defaults.yaml. Fail-closed on unknown names."""
    tenant_id = TenantContext.current().tenant_id
    override = _env_override(tenant_id, metric_name)
    if override is not None:
        return override
    thresholds = get_tenant_config(tenant_id).thresholds
    if metric_name not in thresholds:
        raise KeyError(
            f"Unknown metric '{metric_name}'. Known: {sorted(thresholds)}"
        )
    return thresholds[metric_name]


def resolve_weight(metric_name: str) -> float:
    tenant_id = TenantContext.current().tenant_id
    weights = get_tenant_config(tenant_id).weights
    if metric_name not in weights:
        raise KeyError(f"Unknown metric '{metric_name}'. Known: {sorted(weights)}")
    return weights[metric_name]

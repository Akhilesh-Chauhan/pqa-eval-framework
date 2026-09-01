from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_PKG_CONFIG_DIR = Path(__file__).parent / "tenants"
# repo layout: src/pqa_eval/config/settings.py -> pqa-eval/
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    provider: str
    aws_region: str
    judge_model_id: str
    embed_model_id: str
    data_dir: Path
    runs_dir: Path
    config_dir: Path
    max_workers: int
    judge_max_context_chars: int


def get_settings() -> Settings:
    """Read settings fresh from env every call — deliberately uncached so
    tests can monkeypatch and CI can override per-job."""
    return Settings(
        provider=os.getenv("PQA_EVAL_PROVIDER", "stub"),
        aws_region=os.getenv("PQA_EVAL_AWS_REGION", "ap-south-1"),
        judge_model_id=os.getenv("PQA_EVAL_JUDGE_MODEL_ID", ""),
        embed_model_id=os.getenv("PQA_EVAL_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0"),
        data_dir=Path(os.getenv("PQA_EVAL_DATA_DIR", _PROJECT_ROOT / "data")),
        runs_dir=Path(os.getenv("PQA_EVAL_RUNS_DIR", _PROJECT_ROOT / "runs")),
        config_dir=Path(os.getenv("PQA_EVAL_CONFIG_DIR", _PKG_CONFIG_DIR)),
        max_workers=max(1, int(os.getenv("PQA_EVAL_MAX_WORKERS", "4"))),
        judge_max_context_chars=int(os.getenv("PQA_EVAL_JUDGE_MAX_CONTEXT_CHARS", "120000")),
    )

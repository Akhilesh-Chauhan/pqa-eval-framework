from pydantic import BaseModel, ConfigDict, Field

from pqa_eval.schema.citation import Citation, RetrievedContext


class DraftResult(BaseModel):
    """What the system under test returned for one sample.

    Shape is identical for StaticFixtureClient (capture replay) and
    HttpPQAClient (live), so metrics never know which mode produced it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    sample_id: str
    tenant_id: str
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    retrieved_contexts: list[RetrievedContext] = Field(default_factory=list)
    latency_ms: int | None = None      # None => BudgetCompliance reports "not measurable"
    input_tokens: int | None = None
    output_tokens: int | None = None
    model_version: str
    prompt_version: str

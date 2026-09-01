from pydantic import BaseModel, ConfigDict, Field

from pqa_eval.schema.citation import Citation, RetrievedContext
from pqa_eval.schema.enums import House, QuestionType, RetrievalMode


class SubQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    part_label: str                    # "a", "b", ... "aa"
    text: str


class ConversationTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: str                          # "drafter" | "assistant"
    content: str
    citations: list[Citation] = Field(default_factory=list)


class PQMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    house: House | None = None
    session: str | None = None
    question_number: str | None = None
    diary_number: str | None = None
    subject: str | None = None
    department: str | None = None
    minister: str | None = None
    answer_date: str | None = None     # ISO date string
    annexure_refs: list[str] = Field(default_factory=list)
    language: str = "en"


class PQAGoldenSample(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    # identity & isolation
    sample_id: str
    tenant_id: str

    # the question
    question: str                      # full PQ text including sub-parts
    sub_questions: list[SubQuestion] = Field(default_factory=list)
    question_type: QuestionType = QuestionType.UNSTARRED
    clubbed_with: list[str] = Field(default_factory=list)
    transferred_from: str | None = None

    # ground truth
    expected_answer: str
    expected_citations: list[Citation] = Field(default_factory=list)
    expected_refusal: bool = False

    # retrieval
    retrieved_contexts: list[RetrievedContext] | None = None  # None => re-retrieve live
    retrieval_mode: RetrievalMode = RetrievalMode.STATIC

    # private-source safeguards
    is_private_source_used: bool = False
    promote_to_public_acknowledged: bool = False
    private_spans: list[str] = Field(default_factory=list)

    # metadata & conversation
    metadata: PQMetadata = Field(default_factory=PQMetadata)
    conversation_history: list[ConversationTurn] = Field(default_factory=list)

    # evaluation control
    tags: list[str] = Field(default_factory=list)
    expected_failure_metrics: list[str] = Field(default_factory=list)

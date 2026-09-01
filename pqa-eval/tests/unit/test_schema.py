import pytest
from pydantic import ValidationError

from pqa_eval.schema.citation import Citation, RetrievedContext, SourceVisibility
from pqa_eval.schema.draft import DraftResult
from pqa_eval.schema.enums import QuestionType, RetrievalMode
from pqa_eval.schema.golden import PQAGoldenSample, PQMetadata, SubQuestion


def minimal_sample(**overrides) -> dict:
    d = dict(
        sample_id="s1",
        tenant_id="commerce",
        question="(a) whether exports grew; (b) the details thereof?",
        sub_questions=[
            {"part_label": "a", "text": "whether exports grew"},
            {"part_label": "b", "text": "the details thereof"},
        ],
        question_type="UNSTARRED",
        expected_answer="(a) Yes. (b) Exports grew 2.6% in 2024-25.",
        expected_citations=[
            {"citation_id": "c1", "source_ref": "LSQ-2023-1234", "visibility": "public"}
        ],
        retrieved_contexts=[
            {"text": "Exports grew 2.6% in 2024-25.", "doc_id": "LSQ-2023-1234", "visibility": "public"}
        ],
        metadata={"house": "LOK_SABHA", "subject": "Exports", "department": "DoC"},
    )
    d.update(overrides)
    return d


def test_golden_round_trip_and_defaults():
    s = PQAGoldenSample(**minimal_sample())
    assert s.question_type is QuestionType.UNSTARRED
    assert s.retrieval_mode is RetrievalMode.STATIC
    assert s.is_private_source_used is False
    assert s.promote_to_public_acknowledged is False
    assert s.private_spans == []
    assert s.conversation_history == []
    assert s.expected_failure_metrics == []
    assert s.expected_refusal is False
    # round trip
    assert PQAGoldenSample(**s.model_dump()) == s


def test_golden_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        PQAGoldenSample(**minimal_sample(surprise_field="x"))


def test_golden_is_frozen():
    s = PQAGoldenSample(**minimal_sample())
    with pytest.raises(ValidationError):
        s.tenant_id = "defence"


def test_retrieved_context_requires_visibility():
    with pytest.raises(ValidationError):
        RetrievedContext(text="t", doc_id="d")  # no visibility


def test_citation_visibility_enum():
    c = Citation(citation_id="c1", source_ref="DOC-1", visibility="private")
    assert c.visibility is SourceVisibility.PRIVATE


def test_draft_result_optional_measurements():
    d = DraftResult(
        sample_id="s1", tenant_id="commerce", answer="A.",
        citations=[], retrieved_contexts=[],
        model_version="m1", prompt_version="p1",
    )
    assert d.latency_ms is None and d.output_tokens is None


def test_subquestion_and_metadata():
    sq = SubQuestion(part_label="a", text="whether exports grew")
    m = PQMetadata(house="RAJYA_SABHA", subject="SEZ", department="DoC",
                   session="265", question_number="512", language="en")
    assert sq.part_label == "a" and m.question_number == "512"

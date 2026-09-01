from enum import Enum

from pydantic import BaseModel, ConfigDict


class SourceVisibility(str, Enum):
    PUBLIC = "public"    # tenant KB or approved public external source
    PRIVATE = "private"  # private external source — gated by promote-to-public


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    citation_id: str
    source_ref: str                    # doc id / PQ number / annexure ref
    visibility: SourceVisibility
    quoted_span: str | None = None     # verbatim span this citation supports
    context_index: int | None = None   # index into the retrieved contexts


class RetrievedContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str
    doc_id: str
    visibility: SourceVisibility       # on the CONTEXT, not just the citation:
                                       # PrivateSourceGuard needs to know which
                                       # retrieved chunk was the private one
    score: float | None = None         # retriever relevance score, if available
    is_annexure: bool = False

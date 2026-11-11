from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator


class SearchOptions(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    match_count: int = Field(default=6, ge=1, le=12)
    candidate_count: int = Field(default=24, ge=1, le=50)
    min_similarity: FiniteFloat = Field(default=0.35, ge=-1, le=1)
    semantic_weight: FiniteFloat = Field(default=1, ge=0, le=10)
    keyword_weight: FiniteFloat = Field(default=1, ge=0, le=10)
    rrf_k: int = Field(default=60, ge=1, le=1000)
    max_context_chars: int = Field(default=12000, ge=1000, le=24000)

    @model_validator(mode="after")
    def validate_combination(self):
        if self.candidate_count < self.match_count:
            raise ValueError("candidate_count must be at least match_count")
        if self.semantic_weight + self.keyword_weight == 0:
            raise ValueError("At least one search branch must have a positive weight")
        return self


class QueryEmbedding(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    values: list[FiniteFloat] = Field(min_length=1, max_length=16000)

    @model_validator(mode="after")
    def validate_vector(self):
        if not self.model.strip():
            raise ValueError("An explicit embedding model is required")
        if not any(value != 0 for value in self.values):
            raise ValueError("A zero vector cannot be used for cosine search")
        if any(abs(value) > 3.4e38 for value in self.values):
            raise ValueError("Embedding values must fit pgvector float32 storage")
        return self


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    chunk_id: UUID
    document_id: UUID
    chunk_index: int = Field(ge=0)
    document_kind: Literal["pdf", "txt"]
    page_number: int | None
    content: str = Field(min_length=1, max_length=6000)
    semantic_similarity: FiniteFloat | None = Field(ge=-1, le=1)
    semantic_rank: int | None = Field(default=None, ge=1)
    keyword_rank: int | None = Field(default=None, ge=1)
    fusion_score: FiniteFloat = Field(gt=0)
    truncated: bool = False

    @model_validator(mode="after")
    def validate_source(self):
        if self.document_kind == "pdf" and (self.page_number is None or self.page_number < 1):
            raise ValueError("PDF references require a real page number")
        if self.document_kind == "txt" and self.page_number is not None:
            raise ValueError("TXT references must not invent page numbers")
        if self.semantic_rank is None and self.keyword_rank is None:
            raise ValueError("A result must match at least one search branch")
        return self

    @property
    def source_label(self) -> str:
        return f"Page {self.page_number}" if self.document_kind == "pdf" else f"Chunk {self.chunk_index + 1}"


class SearchResult(BaseModel):
    chunks: list[RetrievedChunk]
    context_chars: int
    # Empty results mean no eligible retrieved passages, not provider failure.
    # Nonempty results are evidence candidates, not proof the answer is supported.

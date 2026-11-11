"""Server-only retrieval for future authenticated chat/quiz endpoints.

The caller MUST derive user_id from a verified access token. This module never
accepts an HTTP request or exposes a browser RPC. Query embeddings must come from
our server's configured provider, not untrusted browser input.
"""
import json
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from pydantic import ValidationError

from app.config import Settings
from app.retrieval.models import QueryEmbedding, RetrievedChunk, SearchOptions, SearchResult


class RetrievalError(Exception):
    """Safe-to-display retrieval error, without SQL/connection secrets."""


class RetrievalNotConfigured(RetrievalError):
    pass


class DocumentUnavailable(RetrievalError):
    pass


class DocumentNotReady(RetrievalError):
    pass


class EmbeddingMismatch(RetrievalError):
    pass


class RetrievalTimedOut(RetrievalError):
    pass


SEARCH_SQL = """
select * from quest_private.hybrid_document_search(
    %(document_id)s::uuid, %(user_id)s::uuid, %(query_text)s,
    %(embedding)s::extensions.vector, %(embedding_model)s,
    %(match_count)s, %(candidate_count)s, %(min_similarity)s,
    %(semantic_weight)s, %(keyword_weight)s, %(rrf_k)s
)
"""


def search_with_connection(
    connection,
    *,
    user_id: UUID,
    document_id: UUID,
    query_text: str,
    query_embedding: QueryEmbedding,
    options: SearchOptions,
) -> SearchResult:
    """Run one bounded, owner/document-scoped database search.

    Connection must use psycopg dict_row. See retrieve_document for the real
    connection entry point, timeouts and read-only transaction configuration.
    """
    query = query_text.strip()
    if not query or len(query) > 2000 or "\x00" in query:
        raise RetrievalError("Enter a search query between 1 and 2000 characters.")
    if not isinstance(user_id, UUID) or not isinstance(document_id, UUID):
        raise RetrievalError("A verified user and selected document are required.")
    parameters = {
        "document_id": document_id,
        "user_id": user_id,
        "query_text": query,
        # Finite float values are validated before serialization; no string-built SQL.
        "embedding": json.dumps(query_embedding.values, allow_nan=False),
        "embedding_model": query_embedding.model,
        "match_count": options.match_count,
        "candidate_count": options.candidate_count,
        "min_similarity": options.min_similarity,
        "semantic_weight": options.semantic_weight,
        "keyword_weight": options.keyword_weight,
        "rrf_k": options.rrf_k,
    }
    try:
        rows = connection.execute(SEARCH_SQL, parameters).fetchall()
    except psycopg.errors.NoDataFound:
        # Missing and unauthorized documents intentionally produce the same error.
        raise DocumentUnavailable("This document is not available.") from None
    except psycopg.errors.ObjectNotInPrerequisiteState:
        raise DocumentNotReady("This document has not finished processing.") from None
    except psycopg.errors.InvalidParameterValue:
        raise EmbeddingMismatch("Query embeddings must match the document's model and dimensions.") from None
    except psycopg.errors.QueryCanceled:
        raise RetrievalTimedOut("Document search took too long. Please retry.") from None
    except (psycopg.errors.UndefinedFunction, psycopg.errors.UndefinedTable, psycopg.errors.InvalidSchemaName):
        raise RetrievalNotConfigured("Database search is not installed. Apply the reviewed migrations.") from None
    except psycopg.errors.InsufficientPrivilege:
        raise RetrievalNotConfigured("The backend database role cannot perform document search.") from None
    except psycopg.Error:
        raise RetrievalError("Document search is temporarily unavailable.") from None

    if len(rows) > options.match_count:
        raise RetrievalError("Document search returned an invalid result set.")
    chunks: list[RetrievedChunk] = []
    seen: set[UUID] = set()
    remaining = options.max_context_chars
    for row in rows:
        try:
            chunk = RetrievedChunk.model_validate(row)
        except ValidationError:
            raise RetrievalError("Document search returned invalid source metadata.") from None
        if chunk.document_id != document_id or chunk.chunk_id in seen:
            raise RetrievalError("Document search returned an invalid source scope.")
        seen.add(chunk.chunk_id)
        if remaining <= 0:
            continue
        if len(chunk.content) > remaining:
            chunk = chunk.model_copy(update={"content": chunk.content[:remaining], "truncated": True})
        chunks.append(chunk)
        remaining -= len(chunk.content)
    return SearchResult(chunks=chunks, context_chars=options.max_context_chars - remaining)


def retrieve_document(
    *,
    user_id: UUID,
    document_id: UUID,
    query_text: str,
    query_embedding: QueryEmbedding,
    settings: Settings,
    options: SearchOptions | None = None,
) -> SearchResult:
    """Real database adapter. Does not generate embeddings or fake missing data."""
    if settings.database_url is None:
        raise RetrievalNotConfigured("Set DATABASE_URL locally to enable document search.")
    try:
        with psycopg.connect(
            settings.database_url.get_secret_value(),
            connect_timeout=5,
            row_factory=dict_row,
            options=f"-c statement_timeout={settings.retrieval_statement_timeout_ms} -c default_transaction_read_only=on",
        ) as connection:
            return search_with_connection(
                connection,
                user_id=user_id,
                document_id=document_id,
                query_text=query_text,
                query_embedding=query_embedding,
                options=options or settings.retrieval,
            )
    except psycopg.OperationalError:
        raise RetrievalError("The document search database is unavailable. Please retry later.") from None

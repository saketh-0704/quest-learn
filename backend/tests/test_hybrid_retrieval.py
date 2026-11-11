from uuid import UUID
from unittest.mock import Mock

import psycopg
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.retrieval.models import QueryEmbedding, SearchOptions
from app.retrieval.service import (
    DocumentNotReady, DocumentUnavailable, EmbeddingMismatch, RetrievalError,
    RetrievalNotConfigured, RetrievalTimedOut, retrieve_document, search_with_connection,
)

OWNER = UUID("10000000-0000-0000-0000-000000000001")
DOCUMENT = UUID("20000000-0000-0000-0000-000000000001")
EMBEDDING = QueryEmbedding(model="fixture-v1", values=[1, 0, 0])


def row(index=0, **changes):
    result = {
        "chunk_id": UUID(int=index + 1), "document_id": DOCUMENT,
        "chunk_index": index, "document_kind": "txt", "page_number": None,
        "content": "A relevant source passage.", "semantic_similarity": 0.9,
        "semantic_rank": 1, "keyword_rank": 1, "fusion_score": 2 / 61,
    }
    return result | changes


def run(rows, *, options=None, query="What is a function?"):
    connection = Mock()
    connection.execute.return_value.fetchall.return_value = rows
    result = search_with_connection(
        connection, user_id=OWNER, document_id=DOCUMENT, query_text=query,
        query_embedding=EMBEDDING, options=options or SearchOptions(),
    )
    return connection, result


def test_query_and_owner_are_bound_not_interpolated_into_sql():
    query = "quasar'); DROP TABLE documents; --"
    connection, result = run([row()], query=query)
    sql, parameters = connection.execute.call_args.args
    assert query not in sql
    assert "%(user_id)s" in sql and "%(document_id)s" in sql
    assert parameters["query_text"] == query
    assert parameters["user_id"] == OWNER and parameters["document_id"] == DOCUMENT
    assert parameters["embedding_model"] == "fixture-v1"
    assert result.chunks[0].source_label == "Chunk 1"


def test_context_is_bounded_and_preserves_exact_source_prefixes():
    _, result = run([row(content="a" * 900), row(1, content="b" * 400)], options=SearchOptions(max_context_chars=1000))
    assert result.context_chars == 1000
    assert result.chunks[0].content == "a" * 900
    assert result.chunks[1].content == "b" * 100
    assert result.chunks[1].truncated
    assert result.chunks[1].source_label == "Chunk 2"


def test_empty_results_are_not_substituted_with_fake_evidence():
    _, result = run([])
    assert result.chunks == [] and result.context_chars == 0


def test_keyword_only_result_is_valid_even_without_cosine_similarity():
    _, result = run([row(semantic_similarity=None, semantic_rank=None, keyword_rank=1)])
    assert result.chunks[0].keyword_rank == 1


def test_pdf_source_uses_stored_page():
    _, result = run([row(document_kind="pdf", page_number=4)])
    assert result.chunks[0].source_label == "Page 4"


@pytest.mark.parametrize("bad_rows", [
    [row(document_id=UUID(int=999))],
    [row(), row()],
    [row(page_number=4)],
    [row(document_kind="pdf", page_number=None)],
    [row(semantic_rank=None, keyword_rank=None)],
])
def test_inconsistent_or_unscoped_results_fail_closed(bad_rows):
    with pytest.raises(RetrievalError):
        run(bad_rows)


@pytest.mark.parametrize("query", [" ", "x" * 2001, "null\x00byte"])
def test_invalid_queries_never_execute_sql(query):
    connection = Mock()
    with pytest.raises(RetrievalError):
        search_with_connection(connection, user_id=OWNER, document_id=DOCUMENT,
            query_text=query, query_embedding=EMBEDDING, options=SearchOptions())
    connection.execute.assert_not_called()


@pytest.mark.parametrize("values", [[0, 0, 0], [float("nan")], [float("inf")], [1e100], []])
def test_invalid_query_vectors_are_rejected(values):
    with pytest.raises(ValidationError):
        QueryEmbedding(model="fixture-v1", values=values)


@pytest.mark.parametrize("options", [
    {"match_count": 13}, {"candidate_count": 51}, {"match_count": 6, "candidate_count": 5},
    {"keyword_weight": 0, "semantic_weight": 0}, {"min_similarity": float("nan")},
])
def test_unbounded_or_invalid_search_options_are_rejected(options):
    with pytest.raises(ValidationError):
        SearchOptions(**options)


@pytest.mark.parametrize("database_error, domain_error", [
    (psycopg.errors.NoDataFound, DocumentUnavailable),
    (psycopg.errors.ObjectNotInPrerequisiteState, DocumentNotReady),
    (psycopg.errors.InvalidParameterValue, EmbeddingMismatch),
    (psycopg.errors.QueryCanceled, RetrievalTimedOut),
    (psycopg.errors.UndefinedFunction, RetrievalNotConfigured),
    (psycopg.errors.InsufficientPrivilege, RetrievalNotConfigured),
])
def test_database_errors_are_actionable_without_leaking_internals(database_error, domain_error):
    connection = Mock()
    connection.execute.side_effect = database_error("private connection/SQL details")
    with pytest.raises(domain_error) as caught:
        search_with_connection(connection, user_id=OWNER, document_id=DOCUMENT,
            query_text="quasar", query_embedding=EMBEDDING, options=SearchOptions())
    assert "private connection" not in str(caught.value)


def test_no_database_configuration_fails_clearly_without_connecting(monkeypatch):
    connect = Mock()
    monkeypatch.setattr("app.retrieval.service.psycopg.connect", connect)
    with pytest.raises(RetrievalNotConfigured):
        retrieve_document(user_id=OWNER, document_id=DOCUMENT, query_text="quasar",
            query_embedding=EMBEDDING, settings=Settings(_env_file=None, database_url=None))
    connect.assert_not_called()


def test_real_adapter_uses_read_only_connection_and_bounded_timeouts(monkeypatch):
    connection = Mock()
    connection.execute.return_value.fetchall.return_value = [row()]
    context = Mock()
    context.__enter__ = Mock(return_value=connection)
    context.__exit__ = Mock(return_value=False)
    connect = Mock(return_value=context)
    monkeypatch.setattr("app.retrieval.service.psycopg.connect", connect)
    settings = Settings(_env_file=None, database_url="postgresql://local-test/questlearn")
    result = retrieve_document(user_id=OWNER, document_id=DOCUMENT, query_text="quasar",
        query_embedding=EMBEDDING, settings=settings)
    assert result.chunks[0].document_id == DOCUMENT
    assert connect.call_args.kwargs["connect_timeout"] == 5
    assert "default_transaction_read_only=on" in connect.call_args.kwargs["options"]
    assert "statement_timeout=5000" in connect.call_args.kwargs["options"]


def test_connection_failures_do_not_reveal_passwords(monkeypatch):
    connect = Mock(side_effect=psycopg.OperationalError("password=super-secret"))
    monkeypatch.setattr("app.retrieval.service.psycopg.connect", connect)
    with pytest.raises(RetrievalError) as caught:
        retrieve_document(user_id=OWNER, document_id=DOCUMENT, query_text="quasar",
            query_embedding=EMBEDDING, settings=Settings(_env_file=None,database_url="postgresql://local-test/questlearn"))
    assert "super-secret" not in str(caught.value)


def test_search_configuration_can_be_set_without_code_changes(monkeypatch):
    monkeypatch.setenv("RETRIEVAL__SEMANTIC_WEIGHT", "2")
    monkeypatch.setenv("RETRIEVAL__KEYWORD_WEIGHT", "0.5")
    settings = Settings(_env_file=None)
    assert settings.retrieval.semantic_weight == 2
    assert settings.retrieval.keyword_weight == 0.5

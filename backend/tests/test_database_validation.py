from pathlib import Path
from runpy import run_path

import pytest
from pglast import ast, parse_sql


ROOT = Path(__file__).resolve().parents[2]
builder = run_path(str(ROOT / "backend/scripts/build_database_validation.py"))


@pytest.mark.parametrize("suite", sorted((ROOT / "supabase/tests").glob("*.sql")))
def test_rehearsal_cannot_commit_migrations_or_fixtures(suite):
    query = builder["build_validation"](suite)
    statements = parse_sql(query)
    transaction_commands = [
        statement.stmt.kind.name
        for statement in statements
        if isinstance(statement.stmt, ast.TransactionStmt)
    ]
    assert transaction_commands == ["TRANS_STMT_BEGIN", "TRANS_STMT_ROLLBACK"]
    assert isinstance(statements[-1].stmt, ast.TransactionStmt)
    assert "Validation requires an empty test project" in query
    assert "statement_timeout = '30s'" in query


def test_rehearsal_preserves_function_bodies_and_sql_literals():
    statements = builder["statements_without_transaction"]("""
        begin;
        create function example() returns text language plpgsql as $$
        begin return 'commit; rollback;'; end;
        $$;
        commit;
    """)
    assert len(statements) == 1
    assert "begin return 'commit; rollback;'; end;" in statements[0]
    assert isinstance(parse_sql(statements[0])[0].stmt, ast.CreateFunctionStmt)


def test_rehearsal_refuses_unexpected_transaction_control():
    with pytest.raises(ValueError, match="Unexpected transaction control"):
        builder["statements_without_transaction"]("begin; savepoint nested; rollback;")

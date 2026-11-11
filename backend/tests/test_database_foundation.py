from pathlib import Path
import pytest
from pglast import parse_sql
from app.config import Settings

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("sql_file", sorted((ROOT / "supabase").rglob("*.sql")))
def test_postgres_sql_parses(sql_file):
    # Syntax only. This does not execute SQL or prove RLS/security behavior.
    assert parse_sql(sql_file.read_text(encoding="utf-8"))


def test_supabase_settings_hide_privileged_values():
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_secret_key="server-secret-for-test",
        database_url="postgresql://example:password-for-test@localhost/postgres",
    )
    assert "server-secret-for-test" not in repr(settings)
    assert "password-for-test" not in repr(settings)
    assert settings.supabase_secret_key.get_secret_value() == "server-secret-for-test"

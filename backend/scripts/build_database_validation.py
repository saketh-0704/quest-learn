"""Build a rollback-only migration rehearsal for an empty Supabase test project.

This command does not connect to a database. Review the generated SQL before
running it through an approved database connection. Requires the dev dependency
pglast. Existing migration files remain the source of truth.
"""

import argparse
from pathlib import Path

from pglast import ast, parse_sql, split


ROOT = Path(__file__).resolve().parents[2]


def statements_without_transaction(source: str) -> list[str]:
    statements = []
    for statement in split(source):
        node = parse_sql(statement)[0].stmt
        if isinstance(node, ast.TransactionStmt):
            # Only the existing file-level wrappers may be removed.
            if node.kind.name not in {"TRANS_STMT_BEGIN", "TRANS_STMT_COMMIT", "TRANS_STMT_ROLLBACK"}:
                raise ValueError("Unexpected transaction control in SQL source")
            continue
        statements.append(statement.rstrip(";"))
    return statements


def build_validation(test_file: Path) -> str:
    parts = ["""-- Generated rehearsal: no COMMIT; all schema and fixture changes roll back.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $preflight$
begin
  if exists (select 1 from auth.users)
     or exists (select 1 from storage.objects)
     or exists (select 1 from storage.buckets)
     or exists (select 1 from pg_namespace where nspname = 'quest_private')
     or exists (select 1 from pg_tables where schemaname = 'public')
     or exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal)
  then
    raise exception 'Validation requires an empty test project with no custom auth triggers';
  end if;
end;
$preflight$;
create temporary table quest_validation_results (
  sequence integer generated always as identity,
  result text not null
) on commit drop;
grant insert on quest_validation_results to anon, authenticated;
grant usage on sequence quest_validation_results_sequence_seq to anon, authenticated;
"""
    ]
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        parts.append(f"-- Migration: {migration.name}")
        parts.extend(statement + ";" for statement in statements_without_transaction(migration.read_text(encoding="utf-8")))
    parts.append(f"-- Test suite: {test_file.name}")
    for statement in statements_without_transaction(test_file.read_text(encoding="utf-8")):
        node = parse_sql(statement)[0].stmt
        if isinstance(node, ast.SelectStmt):
            # pgTAP setup and JWT context must not become TAP results.
            value = node.targetList[0].val if node.targetList else None
            function = value.funcname[-1].sval if isinstance(value, ast.FuncCall) else None
            if function in {"no_plan", "set_config"}:
                # Run SELECT without emitting a result set to the SQL tool.
                parts.append("do $setup$ begin perform * from (" + statement + ") as setup; end; $setup$;")
            else:
                parts.append("insert into pg_temp.quest_validation_results(result) " + statement + ";")
        else:
            parts.append(statement + ";")
    parts.append("""reset role;
select jsonb_build_object(
  'suite', '__SUITE__',
  'passed', count(*) filter (where result ~ '^ok [0-9]+'),
  'failed', count(*) filter (where result ~ '^not ok'),
  'results', jsonb_agg(result order by sequence)
) as validation_report from pg_temp.quest_validation_results;
rollback;
""".replace("__SUITE__", test_file.name.replace("'", "''")))
    return "\n".join(parts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", choices=[path.name for path in (ROOT / "supabase/tests").glob("*.sql")])
    args = parser.parse_args()
    print(build_validation(ROOT / "supabase/tests" / args.suite))

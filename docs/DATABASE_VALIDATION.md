# Database rehearsal — 29 October 2026

The two prepared migrations now have real PostgreSQL execution coverage. A malformed UUID in the hybrid retrieval fixture was corrected; no production migration logic needed changing.

## Target and method

Inspected connected project: `ngfqtzwksapqedvnylxd` (`saketh-0704's Project`), PostgreSQL 17.11.0.003. Before testing, it had zero application tables, auth users, storage objects, buckets, or migration-history entries, and no custom triggers on `auth.users`. pgvector 0.8.2 and pgTAP 1.3.3 were available but not installed.

Docker and WSL are not installed on this workstation. Instead, each suite ran as a single rollback-only transaction through the connected Supabase SQL tool. The transaction temporarily applied both migrations, enabled pgTAP, ran the existing suite with its real role switches, collected TAP results, and rolled back. Every rehearsal first refuses nonempty targets and uses a three-second lock timeout and thirty-second statement timeout.

The generator is [build_database_validation.py](../backend/scripts/build_database_validation.py). It uses PostgreSQL parsing to remove only file-level transaction wrappers; function bodies and SQL literals are preserved. It does not connect to a database. Its output contains one BEGIN, one final ROLLBACK, and no top-level COMMIT. Rehearsals neither apply nor record permanent migrations.

## Results

| Suite | Passed | Failed | Verified behavior |
|---|---:|---:|---|
| `001_access_policies.test.sql` | 32 | 0 | Both users' isolation, anonymous denial, private chunks/answer keys, protected XP/scores, private bucket metadata, foreign keys, uniqueness, and RLS |
| `002_hybrid_retrieval.test.sql` | 20 | 0 | Semantic/keyword fusion, deduplication, ownership, document scope, limits, model/dimension validation, PDF pages, zero vectors, and denied browser execution |

The initial retrieval run failed because the zero-vector fixture referenced a malformed document UUID. Correcting that UUID allowed all 20 assertions to execute and pass.

After both rehearsals, an independent query confirmed zero application tables, auth users, buckets, storage objects, or migration entries; `quest_private`, pgvector, and pgTAP were absent. No fixture or schema change persisted.

## Permanent migration preview

The reviewed changes are:

1. [Learning foundation](../supabase/migrations/20261029180340_learning_foundation.sql): enable pgvector; create 12 public and 4 private application tables, ownership constraints, indexes, read policies, and the private `study-material` bucket. Browser roles cannot write application records or access private answer keys and raw chunks.
2. [Hybrid retrieval](../supabase/migrations/20261029180349_hybrid_retrieval.sql): add the generated full-text column and GIN index, plus the private document-scoped search function restricted to the server role.

After user approval, both migrations were installed permanently on 29 October 2026. The local filenames now match hosted history. On 30 October an additional migration restricted browser execution of the internal RLS event trigger. All 16 application tables have RLS enabled and the study-material bucket is private. See [authentication and installation evidence](AUTHENTICATION.md).

## Remaining boundaries

This rehearsal validates SQL behavior on the actual PostgreSQL version. It does not validate browser login, token verification, Storage HTTP upload/download, live embeddings, the Python adapter's live connection, or a deployed frontend/API. Local Supabase CLI lint was not run because the local container runtime is unavailable. Those checks remain separate implementation milestones.

References: [Supabase pgTAP documentation](https://supabase.com/docs/guides/database/extensions/pgtap) and [database testing](https://supabase.com/docs/guides/local-development/testing/overview).

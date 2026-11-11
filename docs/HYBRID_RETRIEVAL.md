# Document-scoped hybrid retrieval

Implemented as a server-only PostgreSQL search function and a real Python/psycopg adapter. Both migrations passed a rollback-only rehearsal and were then installed in the connected Supabase project after user approval. All 20 retrieval pgTAP assertions passed. See [validation evidence](DATABASE_VALIDATION.md). The frontend still uses labelled prototype content; no search endpoint or live AI provider has been introduced.

## How it works

1. A future authenticated FastAPI route verifies the access token and derives the user UUID. It passes the selected document ID and query to the retrieval module; the browser must never supply authoritative identity or embeddings.
2. The server generates the query embedding using exactly the document's stored embedding model/configuration. This provider integration is still pending; the retriever accepts its real output and never supplies fake vectors in runtime code.
3. `quest_private.hybrid_document_search` validates query limits, ownership, ready state, embedding model and dimensions before searching. A missing or unauthorized document gets the same generic error.
4. Cosine similarity finds meaning-based candidates in that user's selected document. An adjustable threshold filters this branch. Zero query vectors are rejected; stored zero vectors have no cosine score and can only qualify through keyword matches.
5. PostgreSQL English full-text search finds lexical candidates with `websearch_to_tsquery`, `tsvector` and `ts_rank_cd`. A GIN index supports the keyword predicate. This is normalized/stemmed keyword matching, not literal substring matching or BM25. Punctuation and stop words follow PostgreSQL's English configuration.
6. Both candidate queries filter by owner, selected document, model and dimensions before ranking/limiting. Each returns at most 24 candidates by default (hard maximum 50).
7. Weighted Reciprocal Rank Fusion merges/deduplicates chunk IDs: `semantic_weight / (k + semantic_rank) + keyword_weight / (k + keyword_rank)`. A missing branch contributes zero. Ties use chunk index and UUID for stable ordering. Raw keyword relevance and cosine similarity are never added together.
8. The database returns up to six chunks by default (hard maximum 12). Python validates source metadata/scope, preserves PDF page numbers and uses chunk references for TXT. Returned text is capped at 12,000 characters; partial chunks are explicitly marked truncated and remain exact prefixes of stored content.

A keyword-only match can survive below the semantic threshold. Empty results mean there were no eligible candidates. Nonempty results are candidate evidence, not proof that the question is answerable. RRF scores and cosine scores are not answer-confidence probabilities. The future RAG layer must still treat reference text as untrusted, validate cited chunk IDs, bound prompt/history tokens and abstain if the passages do not support an answer. Whole-document summaries need separate section coverage; do not label these few chunks as a complete document summary.

## Database changes

`supabase/migrations/20261029180349_hybrid_retrieval.sql` adds a generated full-text column, GIN index and a private SECURITY INVOKER function. Browser/anonymous execution is revoked, and quest_private stays outside exposed API schemas. A server Postgres connection is required; a Supabase publishable key cannot access this function.

The MVP uses exact cosine ranking within one authorized document, plus bounded candidates/results and a statement timeout. There is no ANN vector index yet because embedding dimensions/provider are not selected. This is a deliberate single-document MVP tradeoff; benchmark representative documents before scaling. Generated-column/index creation takes a database lock; review/apply migrations separately. No other database, vector store, agent or RAG framework is required.

## Backend integration contract

Main code:
- `backend/app/retrieval/models.py`: query embedding, limits and returned evidence schemas.
- `backend/app/retrieval/service.py`: parameterized database call, read-only connection, timeout/error mapping, context budget.
- `backend/app/config.py`: nested retrieval settings and secret DATABASE_URL.

After a real provider and verified-user route exist, its server-side call will be:

```python
result = retrieve_document(
    user_id=verified_user.id,              # derived from verified token, never request.user_id
    document_id=selected_document_id,
    query_text=question,
    query_embedding=QueryEmbedding(
        model=document_embedding_model,
        values=provider_query_vector,      # actual output of the matching embedding provider
    ),
    settings=settings,
)
```

These example variables are the future route's integration contract, not an executable demo or mock runtime flow. Token verification is now implemented; the future HTTP search route must use the VerifiedUser dependency and connect a real embedding provider. Do not connect the prototype to a privileged database call directly.

## Configuration

Set DATABASE_URL locally in backend/.env. Use TLS for hosted Postgres connections; verify the certificate with the project's CA where available. Never paste database passwords or provider keys into chat. Backend/.env.example documents all tunable `RETRIEVAL__...` values.

Defaults: six results, 24 candidates per branch, equal weights, RRF k=60, cosine threshold=0.35, 12,000 context characters, five-second database statement timeout and five-second connect timeout. Threshold 0.35 is a starting configuration, not a quality guarantee; calibrate it on your chosen embedding model and a set of supported/unsupported questions. Character budgeting does not replace the future generation model's token budget.

Setting either search weight to zero is an explicit single-branch experiment. Both zero is invalid; errors never silently fall back to keyword-only, fake content or an unconfigured provider. Embedding model/dimensions are still checked for all modes. Changing the embedding model requires re-embedding stored chunks, even if dimensions are unchanged.

## Tests and commands

From the repository root:

```powershell
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.lock
backend/.venv/Scripts/python -m pip install --no-deps -e ./backend
backend/.venv/Scripts/python -m pytest backend/tests -q
backend/.venv/Scripts/python -m pip check
```

After Docker is installed/running, validate in a fresh isolated local Supabase database:

```powershell
npm ci
npm run db:start
npx supabase migration up --local
npm run db:lint
npm run db:test
```

Do not reset existing data. Follow docs/SUPABASE_SETUP.md for the separate hosted migration review; the initial migrations are already installed; do not reapply them.

`supabase/tests/002_hybrid_retrieval.test.sql` uses synthetic vectors solely in a rolled-back test transaction to check semantic-only matches, keyword-only matches, fusion ranking, deduplication, document/user scoping, threshold empty results, result limits, PDF/TXT references, mismatched models/dimensions, zero vectors, non-ready documents and browser-role denial.

Actually run as of 29 October 2026: 45 backend tests passed, including parameter binding, context bounds, source validation, embedding/option validation, safe error messages, connection configuration, SQL parsing, and rollback-generator safety. Both migrations executed on PostgreSQL 17.11 in rollback-only rehearsals: 32 access-policy and 20 hybrid-retrieval assertions passed. The target was independently verified unchanged afterward. Local Docker/WSL remain unavailable. No live embedding provider, Python-to-database integration test, production search endpoint, load test, or deployed end-to-end RAG test has run.

## Next smallest step

The migrations and verified-user authentication are implemented. Next implement document ingestion and select/configure the embedding model. Then wire the retriever into document chat. The existing frontend prototype, rewards and learning workflows are unaffected by this backend increment.

References: [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search), [PostgreSQL text search](https://www.postgresql.org/docs/current/textsearch-controls.html), [pgvector cosine search](https://github.com/pgvector/pgvector), [psycopg bound parameters](https://www.psycopg.org/psycopg3/docs/basic/params.html).

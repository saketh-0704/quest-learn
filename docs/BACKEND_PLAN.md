# Backend delivery plan

## Objective and current baseline

Deliver a real, private learning workflow: sign in → upload a document or enter a topic → prepare a sourced learning path → read lessons and ask questions → take a graded quiz → retain progress after refresh and sign-in.


## Delivery order and acceptance gates

| Phase | Work | Required evidence before completion |
|---|---|---|
| 1. Document ingestion | Bounded PDF/TXT validation, extraction, page-aware chunks; authenticated upload/list/detail/delete/retry; private storage and metadata; operation IDs and failure cleanup | Valid PDF/TXT persists; invalid, empty, encrypted, oversized, or image-only files get actionable errors; two users cannot access each other's documents; interrupted operations are recoverable; repeat requests cannot duplicate data |
| 2. Retrieval and indexing | Provider-neutral embedding adapter, explicit model/dimensions, batch limits, transactional chunk persistence, existing hybrid search adapter | Index compatible vectors; preserve real page references; no cross-user retrieval; same document retry replaces a consistent chunk version; no fabricated citations; failed embeddings do not mark a document ready |
| 3. Paths, lessons, and chat | Structured generation and validation; separate topic/document flows; source selection from reader resources; stored lessons and bounded chat history | Supabase, biology, and calculus produce different relevant content; answers cite supplied material or abstain; model/provider failures are visible; source instructions cannot override application rules; restart and refresh preserve work |
| 4. Quizzes and grading | Generate validated questions; keep answers in private schema; server-only scoring; idempotent submissions | No answer key in pre-submission responses; repeated/concurrent submission cannot change first-attempt results; feedback refers to actual evidence; unsupported questions are rejected |
| 5. Progress and rewards | Persistent mission completion, transactional XP ledger, badges, revision suggestions | Reload/sign-in restores progress; repeated completion gives no extra rewards; concurrent requests preserve totals; metrics distinguish practice from first attempts |
| 6. Release readiness | Replace remaining preview routes, request tracing, redacted logs, provider cost/rate limits, health/readiness, deployment configuration and rollback runbook | Full browser→API→database journeys pass on desktop/mobile; auth isolation tests pass; clean install/build passes; no secrets in browser bundles; approved deployment smoke tests pass |

Each phase ships a vertical slice with API contract, service/repository separation, frontend states, automated checks, documentation, and live evidence. Do not substitute sample data when real services fail. Complete each acceptance gate before describing a phase as done.

## Phase 1 implementation sequence

1. **Start here:** implement a pure extraction/chunking core and fixture tests. Limit files to 10 MiB and PDFs to 100 pages to match the installed schema. UTF-8 TXT only. Encrypted PDFs and OCR are out of scope. Carry PDF page numbers and stable content hashes into chunks.
2. Add a bounded worker process with execution and memory limits. The parser must not run directly on the API event loop. Document how interrupted work is reconciled after restart; in-process background tasks are not a durable queue.
3. Inspect live schema/grants, then implement owner-scoped repositories and Storage API calls. Server credentials must be configured locally; no browser write grants will be added to bypass the architecture.
4. Define upload/list/detail/delete/retry contracts with verified identity, no caller-supplied owner, bounded streaming, generated storage paths, consistent errors, request idempotency, and storage/database compensation.
5. Wire authenticated document screens to the API. Upload/extraction states belong only to documents. Topic entry remains a separate flow.
6. Validate both users' isolation, failures, cleanup, retry, and actual file processing. Never mark documents `ready` until phase 2 has successfully persisted embeddings.

## Architecture decisions

- Keep a modular FastAPI application: routers for HTTP contracts, services for workflow, repositories for database/storage, provider adapters for external AI, and pure modules for validation/chunking/scoring.
- The existing `documents` table allows `uploaded`, `processing`, `ready`, and `failed`; `ready` requires an embedding model. Private chunks require actual vectors. Extraction output therefore stays in the processing workflow until indexing; do not insert fake vectors. If durable intermediate extraction is needed, introduce a reviewed private staging migration.
- Every write must derive user identity from verified auth and constrain ownership in the query. Privileged credentials never enter frontend environment variables, logs, or responses.
- Generate storage object names from user UUID/document UUID/type, never from filenames. Original filenames are display metadata only.
- Retry only safe operations with limits. Use transaction constraints for grading/rewards and operation keys for upload/indexing. Storage operations and database commits require explicit compensation/reconciliation.
- Model names, dimensions, budgets, deadlines, concurrency, and provider credentials belong in validated backend configuration. Choose a provider before phase 2; paid calls require configured credentials and an agreed budget.

## Dependencies and next decisions

- RAG-Anything is installed in an isolated project environment because its parser dependencies conflict with the active API package versions. Import, parser CLI, and dependency checks passed. Signed-in text understanding now uses Gemini through an isolated temporary RAG index; live synthetic text answering passed. Persistent upload processing remains pending. See [compatibility findings and integration gates](RAG_ANYTHING.md). Do not replace the existing retrieval path before a scoped quality and ownership test.

- Hosted writes need server-only Supabase credentials and/or a restricted database connection, configured locally. Existing public credentials are sufficient only for current read/auth flows. Check presence without printing values before storage work.
- AI features need a selected provider, credentials, model/dimension compatibility, and cost limits. Until configured, return a clear unavailable state rather than invented lessons.
- Production parsing needs a process/container memory budget and durable work reconciliation. OCR, arbitrary website crawling, voice, and multi-document chat remain later scope.

## Progress

- [x] Plan and schema constraints reviewed.
- [ ] Extraction/chunking core and fixture tests.
- [ ] Worker isolation and resource limits.
- [ ] Storage/repositories/API and authenticated frontend upload flow.
- [ ] Live two-user document acceptance gate.
- [ ] Phases 2–6.

Current increment: `/api/learning/document` accepts verified PDF/TXT uploads, extracts text in an isolated worker and generates three lessons using RAG-Anything/Gemini. Files are temporary; no persistent Storage/database writes are claimed. The frontend advances automatically with an indeterminate progress bar and opens the generated workspace. The former 12,000-character restriction has been removed; document text is not truncated.

## Automatic document lessons

`POST /api/learning/document` accepts authenticated PDF/TXT uploads (base64 file, filename, goal, difficulty). The isolated worker extracts UTF-8/PDF text, indexes it with RAG-Anything and generates three validated Gemini lessons: introduction, main concepts, and worked examples. Source text is returned for review and document questions. The browser opens `/workspace` automatically on success; an indeterminate progress bar covers the whole operation. Failures retain the file and goal for retry.

Limits: 10 MB, 100 PDF pages, at least 40 readable characters; no OCR or password-protected PDFs. Document text is not silently truncated. The deadline is 180 seconds, with one active worker per API process. Empty PDF pages are disclosed when other pages have readable text. Temporary indexes are deleted after completion. Lessons and extracted text are held only in browser memory and reset on refresh/sign-out. No durable document storage or queue is implemented. The knowledge check remains a general study-skills quiz. Production parser memory limits and per-user spending limits remain work before public deployment.

The 12,000-character source-text cap is removed from extraction, response validation, follow-up questions and the text editor. File size (10 MB), PDF page/complexity, worker deadline and provider-call budgets still apply. Transport messages are bounded by bytes (64 MiB for text/worker responses), not the former character count. Longer files can still exceed processing time or provider quota.

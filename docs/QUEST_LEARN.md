# Quest Learn implementation record

## Initial inspection

React/TypeScript/Vite uses Supabase Auth and a FastAPI backend. AuthProvider,
RequireAuth and require_user are reusable. Existing document extraction validates
PDF/UTF-8 TXT and preserves page numbers. Postgres already has private chunks,
vectors, owner-scoped hybrid retrieval and a private study-material bucket.

The running QuestLearn flow instead launches a disposable RAGAnything index for
each request. Lessons, quiz state and progress are held in React memory. Existing
database tables are largely scaffolding, not a connected persistence flow.
Prototype rewards, the adventure map and generic learning content must not appear
in the notebook product. Historical design files duplicate old app layouts.
Keep these out of the active route tree rather than rebuild their functionality.

Sequence: authenticated notebook CRUD and private ingestion; durable document
jobs and saved learning materials; selected-source chat and citation passages;
responsive notebook UI; fixture, failure, ownership and live-provider validation.

Changes reach API routes, database migrations, worker processes, configuration,
frontend routing/services/state, auth copy, and tests. Existing document rows are
preserved. Notebook deletion must remove private objects before database rows.
No secrets may reach frontend builds. Legacy endpoints remain available during
the migration; the notebook interface does not use them.

The old RAG worker builds a graph but explicitly retrieves in naive mode.
Do not claim broad retrieval equivalence from a small fixture benchmark.

## Implemented slices

1. Added `notebooks`, composite owner foreign keys, read-only browser RLS, and
   notebook conversation turns. Extended the existing documents table with job
   checkpoints, learning guides, progress, warnings and cancellation. Originals
   use the existing private bucket. Existing QuestLearn rows are preserved.
2. Added a separately supervised worker with one coordinated slot, subprocess
   deadlines, child watchdog, expiring leases, token fencing, retry backoff, and
   checkpointed embeddings/guides. No index rebuild occurs for subsequent chat.
3. Replaced the active route tree and prototype CSS with a responsive notebook
   workspace. Reused AuthProvider, RequireAuth, ErrorBoundary, Icon, Card, Page,
   API transport, extraction and hybrid retrieval. Retained inactive legacy
   components and the legacy worker so historical code is not destructively lost.
4. Added selected-document questions, saved conversation history, validated
   source labels mapped to real chunk IDs, passage inspection and PDF page links.
   Explicit insufficient-evidence abstentions have an honest UI response.

## Verification evidence (November 5, 2026)

- Backend regression suite: **96 passed**, 7 opt-in integration tests skipped
  in the offline/default invocation. Existing Starlette TestClient deprecation
  warning remains; it does not affect runtime behavior.
- Frontend: **36 tests passed**, production TypeScript/Vite build passed.
- Browser fixtures: **3 passed** (sign-in gate, 1440px journey, 390px journey),
  with screenshots inspected and no horizontal overflow or browser exceptions.
- All **7 Supabase integration scenarios passed across targeted runs**: two-user
  API/RLS/private-file isolation; persistence; checkpointed retry without duplicate
  embedding; cancellation fencing; failed deletion recovery; expired lease and
  attempt limits; real subprocess parsing failure; live PDF/TXT lessons and chat.
  Some scenarios combine several assertions in one test.
- Live, unmocked browser assertions passed: real Auth sign-in, notebook creation,
  private PDF upload, worker completion, Gemini answer, actual page-2 passage and
  original PDF URL, saved reviewed status, and restoration after refresh.
  The Windows Chrome harness stalled during shutdown after its assertions passed;
  the runner was stopped to allow account cleanup. The harness now bounds shutdown
  separately and preserves a failing exit code if assertions fail.
  Cleanup was confirmed: zero disposable notebook-test or notebook-browser
  accounts remained. The built frontend was checked for both server secrets;
  neither was present.
- The controlled legacy/vector comparison recovered all three fixture facts and
  correctly identified a missing fact. This is limited evidence; legacy graph
  extraction is retained, not declared generally redundant.

The real browser test exposed transaction-pooler session locks. The configured
database URI was corrected from port 6543 to 5432 on the same verified host.
The store now rejects transaction pooling and explicitly releases advisory locks.
Only idle worker-lock connections created during testing were cleared.

## Remaining limits and operations

OCR is not implemented. Mixed PDFs report pages without readable text, and scans
with no text fail. PDFs are limited to 100 pages and files to 10 MB. Long sources
get consecutive section guides; the application does not promise a single global
summary covering all sections. Chat considers up to four selected sources and a
bounded retrieved evidence window. Reviewed-source progress is self-reported,
not an assessment score. Semantic citation support still needs human review.

Production deployment, load testing, large-corpus retrieval evaluation, history
pagination and production process supervision remain setup/rollout work. The
connected project's existing leaked-password protection warning remains; see
[Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Private-schema RLS-without-policy notices are intentional deny-by-default tables.

See the root README for server-only configuration and API/worker/frontend startup.

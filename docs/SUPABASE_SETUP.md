# Supabase foundation — Day 2

Status: migrations are installed in project `ngfqtzwksapqedvnylxd` after user approval and 52 passing pgTAP assertions. RLS, private storage, and restricted search grants were verified. Account login and protected API verification are implemented and live-tested. See [authentication setup and evidence](AUTHENTICATION.md). Docker/WSL remain unavailable locally.

## Configure the project locally

In your Supabase project's **Connect** dialog / **Project Settings → API Keys**, find the Project URL, publishable key (`sb_publishable_…`), and server secret key (`sb_secret_…`). Public URL and publishable key are browser configuration. The server secret bypasses RLS and belongs only in backend/.env. Do not paste secrets or database passwords into chat. Never place a server secret in any VITE_ variable.

From repository root, create env files only if missing:

```powershell
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (!(Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
```

Edit them with your local editor:

- `backend/.env`: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY. DATABASE_URL is the server-only Postgres URI from Connect; it will be needed for private-schema queries and transactions when the backend is connected. URI-encode special password characters. Choose an appropriate direct/session-pooler connection for your environment and enforce TLS for hosted connections.
- `frontend/.env`: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY only. Keep VITE_API_BASE_URL at http://127.0.0.1:8000 for local development.

The public URL/key now configure the browser Auth client and backend token verification. The server secret and DATABASE_URL remain unused by the account increment and are reserved for later storage/retrieval work. Blank values are ignored by backend settings so the existing liveness endpoint still works.

Keep **quest_private out of exposed API schemas**. FastAPI will use a private server-side Postgres connection for raw chunks, answer keys and future grading transactions, and the server secret for privileged Storage operations. A secret API key does not make an unexposed schema accessible through PostgREST. Verify every access token and derive ownership from its subject before privileged calls.

Before Day 3 email authentication, set the hosted Authentication Site URL to http://127.0.0.1:5173 and allow the exact localhost development URL if using it. Hosted Auth settings are not updated by this local config file.

## Local migration and security testing

Prerequisites: Node 24, Python 3.12, and a running Docker-compatible container runtime. The CLI is pinned in root package-lock.json. Frontend dependencies remain separate in frontend/.

```powershell
# Repository root
npm ci
npm run db:start
npx supabase migration up --local
npm run db:lint
npm run db:test
```

Use a fresh isolated local project. `supabase start` initializes the local stack and may already apply pending migrations; `migration up --local` applies any remaining migrations. No reset is needed. Do not use `db reset` against existing data. Tests create synthetic users/metadata inside a transaction and roll back; run them only against local/test databases. They do not upload actual Storage files or test Storage HTTP endpoints.

SQL syntax and backend checks, without Docker:

```powershell
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.lock
backend/.venv/Scripts/python -m pip install --no-deps -e ./backend
backend/.venv/Scripts/python -m pytest backend/tests -q
backend/.venv/Scripts/python -m pip check
```

SQL parsing is not database execution: it cannot prove grants, RLS, extension compatibility, constraints, transactions or Storage behavior. The rollback-only runtime checks are now recorded in DATABASE_VALIDATION.md; local CLI lint and Storage HTTP checks remain pending.

## Hosted migration workflow (initial migrations now installed)

After local lint and pgTAP pass, confirm the target is your intended fresh project. Inspect any existing public tables, policies, Storage buckets, and installed extensions first. This migration expects pgvector in `extensions`; if vector already exists elsewhere, review that difference before applying. Existing objects with the same names cause failure rather than being overwritten. The migration is wrapped in a transaction and deletes no existing data.

Prepare a linked-project preview only when ready:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
```

Login and link use your local CLI session; do not send tokens/passwords here. Review the dry-run output and migration before approving hosted changes. The initial migrations were applied through the connected migration tool after approval. Their local filenames match hosted history. For future CLI migrations, the write command after review is `npx supabase db push`. Do not push local config wholesale or manually rerun the SQL migration in addition to CLI migration history.

## Schema and permissions

- Browser roles have no app-table writes. Signed-in users can read only their own documents, paths, missions, progress, chats, visible quiz questions, submitted feedback, attempts, ledger entries and badges.
- `quest_private` stores embeddings, raw chunks, citation links and correct-answer keys. Browser roles have neither schema access nor table grants.
- Cross-owner composite foreign keys protect document/chat/mission/quiz links. Stored citations link to chunks of the selected document.
- Chunk uniqueness prevents duplicate document/index pairs. Embedding metadata must match its parent document and vector length. Actual reprocessing transactions are Day 4–5 work; uniqueness alone is not a retry implementation.
- Embeddings use dimensionless `vector` with validated per-document model/dimensions. No approximate vector index exists yet; choose the model/dimensions and filtered search/index strategy in Day 5. Same dimension alone does not make embeddings compatible.
- `study-material` is private, permits PDF/TXT metadata and 10 MiB per file. Generated keys are `user UUID/document UUID.pdf|txt`. Authenticated file reads require a matching owned document; browser uploads, replacements and deletion have no policies. The backend must validate real file bytes and perform storage operations.
- PDFs are bounded at 100 pages in metadata; real extraction/validation comes in Day 4. Scanned/OCR support remains excluded.
- Keys never appear on public quiz-question records. The backend will return explanations only after submission.
- A unique first-attempt index and reward-source indexes stop duplicate source rewards. XP accepts fixed 20/50 amounts and only references eligible first attempts; practice rewards are rejected. Atomic five-answer submission, authoritative scoring, complete reward validation, concurrency testing, and badge eligibility are NOT implemented yet.
- Progress is stored as mission/attempt records. Accuracy, revision rules and level aggregation will be computed from authoritative first-attempt/ledger rows later, not browser totals.

## Deletion and remaining work

Deleting document metadata cascades to chunks, linked chats, paths and their quizzes/progress/rewards in this initial schema. Review retention of historical earned XP before the reward increment; this schema is not a final immutable audit model. There is no deletion endpoint yet. The future backend must remove the actual file through the Storage API before deleting document metadata; SQL cascades do not delete stored bytes. Account deletion likewise needs explicit file cleanup.

The later Day 3 increment implements login and token verification. Uploads, live retrieval, Gemini generation, grading, rewards, and persisted learning progress remain future work. The frontend remains the clearly labelled design prototype. User preference is Gemini for the AI increment; embedding model/dimensions remain undecided. Essential release checks remain open.

## Initial preparation checks (superseded by the validation report)

- `npm install --save-dev --save-exact supabase`: CLI 2.122.0 installed; package audit reported zero vulnerabilities.
- `npx supabase init --yes` and `npx supabase --version`: local config initialized, version verified. Initial sandbox attempt could not create the CLI cache; elevated local initialization succeeded. No login/link/hosted writes.
- PostgreSQL parser: migration and pgTAP file parsed successfully.
- Backend pytest: six tests passed, including SQL parsing and secret-redaction checks. One existing Starlette TestClient deprecation warning remains.
- Python `pip check`: no broken requirements.
- At initial preparation, Docker and psql were unavailable and runtime tests had not run. The later rollback-only PostgreSQL rehearsal is documented in DATABASE_VALIDATION.md; Storage HTTP tests remain pending.

Official references: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage policies](https://supabase.com/docs/guides/storage/security/access-control), [database testing](https://supabase.com/docs/guides/database/testing), [migration workflow](https://supabase.com/docs/guides/local-development/database-migrations).

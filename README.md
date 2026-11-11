# GeminiNotebook

An authenticated document learning workspace built on the existing React/TypeScript,
FastAPI, Supabase Auth/Storage/Postgres, and Gemini integrations.

The active interface includes notebooks and sources, an illustrated expedition
map, a lesson reader, cited answers, and study tools for the selected document.
Historical design screenshots are in [docs/design](docs/design/README.md).

## Run locally (Windows PowerShell)

Configure `backend/.env` from `backend/.env.example`:

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for remote identity verification.
- `SUPABASE_SECRET_KEY`: a **server secret**, not a publishable key. Keep it server-side.
- `DATABASE_URL`: direct PostgreSQL or shared **session pooler**, with URI-encoded
  password and TLS (`sslmode=require`). Transaction poolers are unsuitable because
  workers use session advisory locks.
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`.

Apply the ordered SQL migrations under `supabase/migrations` to your Supabase
project. Existing QuestLearn records are preserved. The notebook migration has
been applied to the connected development project.

Install the declared backend dependencies, then start the API and worker in
separate terminals from the repository root:

```powershell
backend/.venv/Scripts/python -m pip install -e './backend[dev]'
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

```powershell
backend/.venv/Scripts/python backend/workers/notebooks.py
```

Configure `frontend/.env` with public values only:
`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Then:

```powershell
cd frontend
npm ci
npm run dev
```

Open [the workspace](http://127.0.0.1:5173). The worker must remain running;
uploads persist as queued until a worker is available. Restart the API and worker
after changing backend configuration. Production requires a process supervisor
for both services and SPA fallback for frontend routes; no deployment is included.

## Processing and persistence

- PDF and UTF-8 TXT: up to 10 MB; PDF up to 100 pages. No 12,000-character
  document rejection or silent document truncation. All extracted passages are
  indexed. Scanned PDFs require external OCR; blank/image pages are explicitly
  reported, and PDFs with no readable text fail with an OCR explanation.
- Private original files, page-aware extracted chunks, 768-dimensional embeddings,
  processing checkpoints, study guides, conversation turns, and reviewed-source
  progress are saved in Supabase. Login on another device loads the same records.
- One database-coordinated worker slot across all worker instances. Jobs run in
  killable subprocesses, with a configurable deadline (default 15 minutes), up to
  three attempts, backoff, cancellation, expiring leases, and token fencing.
  Committed embeddings and guide sections are reused after interruption. Extremely
  large documents can require manual retry after the attempt budget; no success
  is shown until every processing stage completes.
- The UI shows completed/total passages during indexing. Upload, parsing, queued
  work, and generation use indeterminate indicators. No invented percentage.
- Learning plans process consecutive batches of passages and combine them into
  four chapters: introduction, main topics, worked examples, and review.
- Generate study tools for a ready source to get a cited mind map, flashcards,
  and a final quiz. These tools are available while that source is open.
- Questions use up to four selected ready documents and the existing owner-scoped
  hybrid search. A bounded retrieved context is used for each answer; this is
  evidence selection, not truncation of stored documents. Recent conversation
  history helps interpret follow-ups but is not treated as factual evidence.
- Gemini returns source IDs; the server rejects unknown IDs or unsupported
  citation-free answers. Click a citation to inspect its actual stored passage
  and open the original PDF page. Citation existence is verified mechanically;
  semantic correctness still requires human judgment.
- Notebook deletion tombstones the notebook and cancels jobs before deleting
  Storage objects. If Storage fails, metadata remains and deletion can be retried.

## Verification

```powershell
backend/.venv/Scripts/python -m pytest backend/tests -q
cd frontend
npm test
npm run build
npx playwright test
```

Browser tests explicitly mock the API; they test UI behavior and responsive
layout, not provider availability. Real Supabase tests create two temporary,
confirmed test accounts without sending email, and clean up their own files and
accounts. Enable these deliberately:

```powershell
$env:NOTEBOOK_INTEGRATION='1'
$env:NOTEBOOK_LIVE_GEMINI='1'
backend/.venv/Scripts/python -m pytest backend/tests/test_notebook_integration.py -q
```

The live fixture uses two real documents and a bounded number of Gemini requests.
The legacy comparison script runs one old RAG request (24-call maximum) and three
new provider requests:

```powershell
backend/.venv/Scripts/python backend/scripts/evaluate_notebook_retrieval.py
```

With the API, worker and frontend running, the unmocked browser check is:

```powershell
backend/.venv/Scripts/python backend/scripts/browser_notebook_smoke.py
```

It creates a disposable account, uploads a real PDF, makes four Gemini requests,
checks citations and refresh persistence, then removes its own test data.

See [architecture inspection](docs/GEMININOTEBOOK.md) and
[retrieval fixture results](docs/notebook-retrieval-evaluation.json).
The old RAGAnything implementation is retained: its graph construction is unused
by its `naive` query mode, but a small fixture is not proof of broad equivalence.
No graph workflow or dependency has been deleted on that assumption.

## Boundaries

The app supports private document study. The reviewed-source state contributes
to account XP, and trail stamps are saved in the current browser.
The application is intended for a small workspace; large notebook histories are
currently loaded in full and should be paginated before large-scale rollout.

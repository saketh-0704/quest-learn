# RAG-Anything compatibility and installation

RAG-Anything powers QuestLearn's signed-in study-text explanations through an isolated Gemini worker. It does not implement our authentication, per-user ownership checks, learning paths, quiz grading, or XP rules. Its LightRAG storage is separate from the existing Supabase hybrid retrieval schema.

## Compatibility findings

- The local Python 3.12 runtime meets the upstream Python requirement.
- The resolved release is RAG-Anything 1.4.4 with LightRAG 1.4.16 and MinerU 3.4.5.
- A dry run in the existing API environment proposed downgrading Starlette 1.10.0 to 0.52.1 and WebSockets 17.3 to 16.1.1. Do not install this stack into the main API environment.
- Install it into `.local/raganything/.venv` under the project instead. This directory is ignored by source control. An isolated installation proves package compatibility, not application integration or answer quality.
- MinerU adds a substantial parser/ML dependency stack. Model weights and language/embedding/vision providers are separate runtime requirements.

## Reproduce the isolated installation

Installation verified on 4 November 2026:

- RAG-Anything 1.4.4 imports successfully.
- MinerU CLI reports 3.4.5.
- `pip check` reports no broken requirements in both the isolated environment and the existing API environment.
- `backend/requirements-raganything.lock` pins all 136 installed distributions.
- Real text insertion, embedding retrieval, and Gemini answers were verified with a synthetic passage. The mocked-provider regression also checks that retrieved source text reaches the answer prompt. PDF parsing, OCR, persistent documents, and live multi-user browser flows remain unverified.

From the project root in PowerShell:

```powershell
backend/.venv/Scripts/python -m venv .local/raganything/.venv
.local/raganything/.venv/Scripts/python -m pip install -r backend/requirements-raganything.lock
.local/raganything/.venv/Scripts/python -m pip check
.local/raganything/.venv/Scripts/python -c "from raganything import RAGAnything, RAGAnythingConfig; print('RAG-Anything import OK')"
.local/raganything/.venv/Scripts/mineru --version
```

The input dependency is recorded in `backend/requirements-raganything.in`. The lock captures the tested isolated Windows/Python 3.12 environment. Do not merge it with `requirements-dev.lock`.

## Use the text integration

1. Put `GEMINI_API_KEY` in `backend/.env` locally; never use a frontend/VITE variable for it.
2. Defaults are `GEMINI_MODEL=gemini-3.5-flash-lite` and `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` with normalized 768-dimensional vectors. Older Flash-Lite models rejected this new account at generation time despite returning model metadata successfully.
3. Restart the API, sign in, and open `/understand`. Paste at least 40 characters and ask a question.
4. The authenticated `POST /api/learning/understand` validates inputs and starts the isolated interpreter. Each request indexes only its supplied text in a unique temporary directory, retrieves relevant chunks, generates an explanation, and removes its index after process exit. No saved learning history is created.

Text and questions are sent to Google Gemini on submission. Requests consume provider quota and may incur costs. The worker caps adapter invocations at 24; SDK-internal retries may add HTTP requests. One request per API process runs at a time; excess requests return 429. The default deadline is 180 seconds, with worker termination and temporary-file cleanup on timeout. Do not increase the timeout beyond the frontend's 195-second deadline without updating both.

Credentials stay in the worker environment, not command-line arguments or API responses. Raw worker logs are suppressed. Errors return actionable retry/configuration messages without provider details or submitted text. Browser cancellation stops waiting; it does not guarantee an already-started provider call is cancelled.

This is a local text-understanding integration, not the completed document backend. Persistent owner-scoped storage, durable queues, upload parsing/OCR, production memory limits and per-user spending limits remain separate work. Temporary local cleanup does not control Google's data retention.

## Verification

- Frontend: 28 tests pass; production build passes (existing large-chunk warning).
- Backend: 27 focused auth, health, validation, timeout and isolation checks pass.
- `backend/tests/rag_worker_smoke.py`: real RAG pipeline with mocked Gemini; asserts retrieved context is included.
- Live synthetic passage: Gemini correctly answered **three books for fourteen days**, citing the supplied text.
- No broad answer-quality or live two-user browser acceptance claim.

Upstream: https://github.com/HKUDS/RAG-Anything (MIT).
Model documentation: https://aistudio.google.com/docs/models/gemini-3.5-flash-lite.


## Automatic document lessons

`POST /api/learning/document` accepts authenticated PDF/TXT uploads (base64 file, filename, goal, difficulty). The isolated worker extracts UTF-8/PDF text, indexes it with RAG-Anything and generates three validated Gemini lessons: introduction, main concepts, and worked examples. Source text is returned for review and document questions. The browser opens `/workspace` automatically on success; an indeterminate progress bar covers the whole operation. Failures retain the file and goal for retry.

Limits: 10 MB, 100 PDF pages, at least 40 readable characters; no OCR or password-protected PDFs. Document text is not silently truncated. The deadline is 180 seconds, with one active worker per API process. Empty PDF pages are disclosed when other pages have readable text. Temporary indexes are deleted after completion. Lessons and extracted text are held only in browser memory and reset on refresh/sign-out. No durable document storage or queue is implemented. The knowledge check remains a general study-skills quiz. Production parser memory limits and per-user spending limits remain work before public deployment.


Document integration verification: 24 frontend unit tests, 31 focused backend checks and four desktop/mobile browser checks pass. Browser tests use mocked authentication/provider responses. Isolated worker checks cover real PDF/TXT extraction, malformed/scanned/binary/oversized inputs and complete long responses. A live synthetic TXT generated all three lessons successfully. RAG now retrieves evidence only; the final Gemini call uses a structured response schema, avoiding the installed LightRAG version's long-response truncation. Awesome catalog integration, reader, sync tooling and unused Markdown dependency have been removed.

The 12,000-character source-text cap is removed from extraction, response validation, follow-up questions and the text editor. File size (10 MB), PDF page/complexity, worker deadline and provider-call budgets still apply. Transport messages are bounded by bytes (64 MiB for text/worker responses), not the former character count. Longer files can still exceed processing time or provider quota.

# Day 1 verification

Implemented: frontend workspace and routing, responsive Tailwind styling, real API health request with timeout/cancellation/retry, typed FastAPI response, explicit CORS origins, environment examples, dependency manifests/lockfiles, setup/deployment instructions, and the ten-module/fourteen-day checklist.

Checks actually run:
- `npm install`: 120 packages installed; audit reported zero vulnerabilities.
- `npm test`: 3 frontend tests passed (contract, failure/retry, malformed response).
- `npm run build`: TypeScript and Vite production build passed.
- `backend/.venv/Scripts/python -m pytest backend/tests -q`: 3 backend tests passed (contract, CORS, unavailable routes).
- `backend/.venv/Scripts/python -m pip check`: no broken requirements.
- Temporary Uvicorn process on 127.0.0.1:8019 and real HTTP GET /api/health: passed; process stopped afterward.

Environment observations: sandbox registry access and Python venv bootstrap failed; elevated installs succeeded. Sandbox backend TestClient stalled; elevated tests passed in 0.63 seconds. Sandbox Uvicorn smoke check could not start; elevated smoke check passed. Python dependency resolution via pip-tools did not complete promptly and was stopped; requirements-dev.lock instead records the successfully installed environment using pip freeze, excluding the editable project. This lock targets Windows/Python 3.12 and is not a verified Linux deployment lock.

Known warning: the installed Starlette emits a deprecation warning for its httpx TestClient adapter. Tests pass; review its supported replacement at the next dependency update.

Not verified: browser visual rendering, Supabase, OpenAI, data isolation, any learning workflow, production deployment. No migrations, paid services, or deployments were run. No credentials are required for this increment.

Next: Day 2 SQL schema, grants/RLS and private storage policies, keeping quiz answer keys inaccessible to browser database clients. Review migration execution separately; destructive operations need explicit approval.

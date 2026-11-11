# Project structure

The frontend remains an illustrative learning prototype. Its quest state lives for one browser session and resets on refresh. The API exposes public liveness and protected account verification; database retrieval remains a separate service with its existing tests and migrations.

```text
frontend/src/
  app/                  Application shell, navigation, route composition
  components/           Shared UI primitives and render error boundary
  config/               Validated public environment configuration
  features/
    quests/
      components/       Setup form, lesson tutor, knowledge quiz
      model/            Quest types, illustrative content, input validation
      pages/            Route screens
      state/            Pure reducer, progress selectors, session provider
    auth/               Account screens, session provider, protected-route guard
    sound/              Audio provider lifecycle and separate toggle UI
    system/             API connection screen and request lifecycle hook
    world/              Map, dialog, scenery, celebration, HUD
  hooks/                Reusable browser hooks
  services/api/         Shared HTTP client and endpoint-specific services
  test/                 Test environment setup
backend/app/
  api/router.py         API prefix and feature router registration
  api/routes/           Thin HTTP route handlers
  schemas/              Public request/response contracts
  retrieval/            Existing retrieval models and business service
  auth/                 Verified-user dependency backed by Supabase Auth
  config.py             Typed environment settings
  main.py               App factory, middleware, shared error handling
```

## Boundaries and naming

Use PascalCase for React components, camelCase for TypeScript functions and values, `use` prefixes for hooks, and snake_case for Python modules and functions. Keep HTTP calls in endpoint services, business rules in model/reducer modules, and transient form or animation state close to its component. Production source must not import the archived design alternatives in `docs/design/`.

`QuestSessionProvider` owns shared state through `questReducer`. Create, lesson completion, mission selection, and quiz completion are explicit actions. Creating a quest clears previous answers, rewards, source visibility, and celebrations together. Selectors calculate XP from the first completed attempt; practice attempts cannot award it again. The reducer rejects incomplete submissions, duplicate submissions, and locked missions. Quiz grading remains illustrative client-side behavior, not a production security boundary.

The sound provider and API-health hook own their effects and cleanup. UI components consume their controls rather than managing network or audio lifecycles.

## API extension

Keep `/api/health` backward compatible. Add each feature's request/response models under `backend/app/schemas/`, a router under `api/routes/`, and register it in `api/router.py`. Route handlers validate HTTP contracts and delegate business work to services; services should not depend on UI or HTTP request objects. Add only implemented endpoints.

On the frontend, add endpoint modules next to `services/api/health.ts`. Call `requestJson` for common timeouts, caller cancellation, HTTP status errors, network failures, and malformed JSON handling. Validate the returned `unknown` data at the endpoint boundary before exposing typed values. `ApiError.status` allows future screens to distinguish errors such as unauthorized requests or unavailable services. Server errors log details on the backend and return a generic response to clients; FastAPI retains its normal validation and HTTP-error responses.

## Environment

Copy the existing `.env.example` files into local `.env` files. Vite reads public `VITE_API_BASE_URL`; `config/environment.ts` validates its URL and defines the HTTP timeout. Browser variables must never contain secrets. Backend settings resolve `backend/.env` relative to the configuration module, so loading no longer depends on the shell directory. Environment values override the file. No credentials are embedded in source.

## Checks

From the repository root:

```powershell
npm test --prefix frontend
npm run build --prefix frontend
npm run format:check --prefix frontend
npm run test:e2e --prefix frontend
backend/.venv/Scripts/python -m pytest backend/tests
```

Use `npm run format --prefix frontend` for consistent formatting. The production build rejects unused TypeScript imports, locals, and parameters. Browser screenshots are written to ignored Playwright test output instead of overwriting design reference images. Existing design source snapshots are intentionally retained as reference artifacts, not duplicate runtime implementations.

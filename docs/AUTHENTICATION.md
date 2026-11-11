# Accounts and protected API access

Implemented 30 October 2026. The browser uses the pinned Supabase JavaScript client with a public project URL/key. The FastAPI server verifies bearer tokens through that project's Auth `/user` endpoint before returning account data. Privileged credentials are not needed for this increment.

## User flow

- `/signup`: email/password registration, password confirmation, and a confirmation-email notice when Supabase does not return a session.
- `/login`: password login with error handling; successful login opens `/account`.
- `/account`: protected route; shows the identity returned by the protected backend endpoint and supports local-session logout.
- Session restoration, automatic refresh, and cross-tab Auth changes use the Supabase SDK. A stale restoration cannot overwrite a later sign-out event. Subscriptions and HTTP requests are cleaned up on unmount.
- The learning preview remains public and illustrative. Its state is reset when account identity changes, so an earlier account's preview state is not carried into the next session. Production document, lesson, quiz, reward, and progress workflows are still future increments.

## Backend boundary

`GET /api/auth/me` uses `VerifiedUser` from `app/auth/dependencies.py`. Missing, malformed, forged, expired, or rejected bearer credentials receive 401. Provider/network/configuration failures receive 503 rather than granting access. The response is limited to verified user ID/email and uses `Cache-Control: no-store`.

The backend never accepts identity from a browser query parameter or `user_metadata`, never treats a decoded token as verified, and never substitutes a service key for an invalid user token. Future protected routes must depend on `VerifiedUser` and use its ID for ownership checks.

Verification uses a shared HTTP client with a five-second timeout and bounded connections. Every protected request contacts Auth; token-result caching is not introduced here. Logout revokes the current refresh session and clears browser state. As with Supabase access tokens generally, a copied access token can remain valid until expiry; strict immediate revocation for future sensitive operations would additionally require session validation.

## Configuration

Local `.env` files are configured with the connected project's public credentials and remain ignored by version control. `.env.example` files describe the settings for other checkouts. No server secret or database password was retrieved or added.

Start the API and frontend in separate terminals:

```powershell
# From the repository root
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
# From the repository root, in another terminal
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173/login`. The account page requires the API to be running. The preview works independently.

### Hosted email confirmation URLs

Email signup is enabled and email confirmation is required in the connected project. Configure Authentication → URL Configuration:

- Site URL: `http://127.0.0.1:5173`
- Redirect URLs: `http://127.0.0.1:5173/account`, `http://localhost:5173/account`

After the user corrected and saved dashboard settings on 30 October 2026, public verification-endpoint probes with deliberately invalid tokens confirmed HTTP 303 redirects for all three cases:

- No redirect supplied: `http://127.0.0.1:5173` (configured Site URL).
- Requested `http://127.0.0.1:5173/account`: returned that same URL.
- Requested `http://localhost:5173/account`: returned that same URL.

The Site URL and both account callbacks are verified. Probes sent no email and changed no account. A successful confirmation-email round trip remains user-driven and was not tested by sending real email.

## Verification evidence

- 59 backend tests passed, including remote identity validation, forged-token rejection, denial of anonymous/service identities, timeout handling, and resistance to client-supplied user IDs.
- 20 frontend tests passed, including login, logout, email confirmation UI, password matching, session restoration, subscription cleanup, and stale-session race protection.
- Production TypeScript/Vite build and formatting checks passed. All four existing desktop/mobile browser journeys also passed after the account integration.
- A live smoke test used two temporary confirmed test accounts. Actual Supabase password login returned real tokens; the local API verified each identity; each token could read only its own document record through the Data API. Missing/forged tokens received 401.
- A real headless browser logged in, loaded the verified account, restored it after refresh, logged out, and was redirected when reopening the protected route. Mobile overflow and browser exceptions were checked. Signup confirmation UI used intercepted delivery so tests sent no mail.
- Both synthetic accounts, their document metadata, and their sessions were deleted afterward; an independent query confirmed zero remaining test rows. Temporary local test servers/browser processes were stopped.

## Database state

The installed migrations are `20261029180340_learning_foundation`, `20261029180349_hybrid_retrieval`, and `20261030042455_restrict_rls_event_trigger`. Local filenames match hosted history to prevent accidental duplicate application. All 16 app tables have RLS enabled; the study-material bucket is private; browser access to the private schema/search function is denied.

The third migration removes browser execution grants from the hosted internal RLS event trigger. The security advisor now reports only four informational notices for private tables with no browser policies; that default-deny behavior is intentional. See [advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

References: [Supabase user verification](https://supabase.com/docs/reference/javascript/auth-getuser), [Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [local-session logout](https://supabase.com/docs/reference/javascript/auth-signout), and [email redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).


## Sign-in before app access

All app routes now require a restored authenticated session before their screens mount. Login and signup remain public. Guests opening the dashboard, upload page, workspace or library are redirected to login; no file selector is presented beforehand. Successful login returns to an allowlisted in-app destination, preserving its query/hash and the destination across login/signup switching. Sign-out removes access immediately, and the existing user-keyed quest state prevents a different account inheriting the prior session's in-memory lessons. The API independently verifies identity before document processing.

This access gate does not add durable storage. Uploaded files and retrieval indexes are temporary, and generated lessons/progress remain session-only until an owner-scoped persistence workflow is implemented.

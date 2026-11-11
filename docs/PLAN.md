# MVP execution checklist

Scope: one React/FastAPI application; no microservices. Day 1 and the frontend prototype are implemented. Day 2 migrations are installed after 52 passing pgTAP assertions. Day 3 account code and live login/API isolation checks pass; the base Site URL and both account redirect URLs are verified. A real confirmation-email round trip remains to be tested by the user. See DATABASE_VALIDATION.md and AUTHENTICATION.md. No deployment or paid service use authorized.

## Ten modules

| Module | Milestones | Status |
|---|---|---|
| 1 Frontend | Day 1 shell; Days 3–12 complete workflows | Shell implemented |
| 2 Backend API | Day 1 health and API connection | Foundation implemented |
| 3 Authentication and permissions | Day 3 verified Supabase tokens, ownership tests | Implemented and live-tested; default Site URL/email round trip pending |
| 4 Database and private storage | Day 2 migrations, grants, RLS, private bucket | Installed; RLS/private bucket verified |
| 5 Document processing | Day 4 validation, extraction, idempotent chunking, states | Pending |
| 6 AI and RAG | Days 5–7 embeddings, scoped retrieval, validated citations | Hybrid retrieval code/migration prepared; SQL runtime validated; provider/API/chat integration pending |
| 7 Learning activities | Days 8–10 outlines, summaries, protected quiz keys, scoring | Pending |
| 8 Gamification | Day 11 transactional XP ledger, levels, badges | Pending |
| 9 Progress and revision | Day 12 first-attempt statistics and data thresholds | Pending |
| 10 Testing and deployment | Tests each increment; Days 13–14 full verification | Day 1 tests added; deployment pending approval |

## Daily checkpoints

- [x] Day 1: inspect empty repository, scaffold, health endpoint, API connection, basic tests.
- [x] Day 2 validation: both migrations executed in rollback-only rehearsals; 32 access-policy and 20 hybrid retrieval assertions passed.
- [x] Day 2 provisioning: installed migrations and verified all 16 tables, RLS, private storage bucket, and restricted search grants. Local CLI lint and Storage HTTP checks remain separate pending checks.
- [x] Day 3 implementation: registration/login/logout UI, session handling, server token verification, automated and live two-user isolation tests.
- [x] Day 3 configuration: verified the hosted Site URL and both local account redirect URLs using invalid-token probes.
- [ ] Complete a user-driven confirmation-email round trip.
- [ ] Day 4: PDF/TXT limits, safe paths, extraction, chunk metadata, retry and failure states.
- [ ] Day 5: hybrid retrieval implementation prepared (cosine + keyword + RRF); SQL ranking and access tests pass; compatible live embeddings, ingestion and live Python adapter verification pending.
- [ ] Day 6: grounded chat, bounded history, citation validation, abstention, saved history.
- [ ] Day 7: document-chat workflow and AI-quality tests.
- [ ] Day 8: AI-labelled topic outlines, lessons, and whole-document summary coverage.
- [ ] Day 9: validated five-question quizzes with private answers and evidence links.
- [ ] Day 10: deterministic submission, saved feedback and practice repeats.
- [ ] Day 11: XP ledger, transaction constraints, concurrency tests, badges.
- [ ] Day 12: progress, first-attempt topic accuracy, revision below 50% after five answers.
- [ ] Day 13: deployment with approval, end-to-end and security evaluation.
- [ ] Day 14: bug fixes, documentation, demo and final verification; no new features.

## Assumptions and release gates

- Working name: QuestLearn. Local development uses Node 24 and Python 3.12.
- Credentials will be configured locally, never pasted into chat. No integrations are simulated in the real application.
- Authentication, ownership, citation integrity, hidden answer keys, deterministic scoring and transactional rewards are mandatory before release.
- API health is public process liveness only, not dependency readiness.
- Future in-process document tasks must have bounded concurrency and documented restart limitations; they are not a durable queue.
- Backend acceptance checks pass for health, the database foundation, and account-token verification; later feature checks remain pending; the interactive frontend uses explicitly labelled prototype data. Scanned PDF OCR, multi-document chat, web browsing, voice, agents, and other listed stretch features remain out of scope.

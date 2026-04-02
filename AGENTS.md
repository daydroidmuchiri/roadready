# AGENTS.md — RoadReady Platform
### Shared Context for Claude · Codex · Antigravity

> **Read this file before touching any part of the codebase.**
> This is the single source of truth for all agents working on the RoadReady platform.
> Last updated: 2026-03-30

---

## 1. Product Overview

**RoadReady** is a two-sided marketplace connecting stranded motorists with vetted roadside mechanics in Nairobi, Kenya. Think Uber for roadside assistance.

**Three user surfaces:**
- **Motorist App** — React Native (Expo) — request help, track mechanic, pay
- **Provider App** — React Native (Expo) — receive jobs, navigate, earn, manage payouts
- **Admin Dashboard** — React (web) — manage users, monitor dispatch, analytics

**Market context:** East African product. M-Pesa is the primary payment method. SMS OTP via Africa's Talking. Swahili naming conventions apply where relevant.

---

## 2. Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Realtime | Socket.IO |
| Database | PostgreSQL |
| ORM/Query layer | `queries.js` (centralised raw SQL) |
| Auth | OTP (Africa's Talking SMS) + JWT (access + refresh tokens) |
| Payments | M-Pesa Daraja API (STK Push + B2C payouts) |
| Notifications | Firebase Cloud Messaging (FCM) |
| File storage | Cloudinary |
| Error tracking | Sentry |
| AI integration | Anthropic API (Claude) |

### Mobile (both apps)
| Layer | Technology |
|---|---|
| Framework | React Native (Expo managed workflow) |
| Navigation | React Navigation |
| Maps | Google Maps SDK + live GPS |
| Background services | Expo TaskManager / Background Fetch |
| Shared code | `/shared/` — AuthScreens, backgroundServices, utilities |

### Admin Dashboard
| Layer | Technology |
|---|---|
| Framework | React (single-file: `AdminApp.jsx`) |
| Charts/Analytics | (inline, TBD) |

### Infrastructure & DevOps
| Concern | Tool |
|---|---|
| Backend hosting | Railway |
| Frontend/Admin | Vercel |
| Mobile builds | Expo EAS Build |
| CI/CD | GitHub Actions |
| Monitoring | Sentry |

---

## 3. Repository Structure

```
roadready/
├── backend/
│   ├── server.js              ⚠️ MONOLITH — see Section 5
│   ├── queries.js             ✅ centralised DB access
│   ├── auth.js                ✅ mature auth logic
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   ├── server.test.js         ✅ meaningful test coverage
│   └── test_api.js            ⚠️ UNTRACKED — must be committed or deleted
│
├── motorist-app/
│   └── App.js                 ⚠️ MONOLITH (~600 lines) — see Section 5
│
├── provider-app/
│   ├── App.js                 ⚠️ MONOLITH (~706 lines, currently dirty/modified)
│   └── (backgroundServices referenced via shared/)
│
├── admin/
│   └── AdminApp.jsx           ⚠️ single-file dashboard (~441 lines)
│
├── shared/
│   ├── AuthScreens.js         ✅ shared mobile auth UI
│   └── backgroundServices.js  ✅ shared background location/task logic
│
└── AGENTS.md                  ← you are here
```

---

## 4. What Is Working Well (Do Not Break)

- **Auth system** — OTP, refresh tokens, `/me`, device token registration, role handling in `auth.js` are solid. Do not refactor auth logic without a full audit.
- **Database schema** — `001_initial_schema.sql` has real relational design with triggers, views, and denormalised provider stats. Treat migrations as append-only.
- **WebSocket rooms** — authenticated socket middleware with scoped rooms in `server.js` is correctly implemented. Any refactor must preserve room scoping to prevent data leakage between users.
- **Centralised queries** — `queries.js` is the correct pattern. All new DB access must go through it, never inline SQL in route handlers.
- **Shared mobile code** — `/shared/` folder is the right pattern. Extend it, don't duplicate logic across apps.
- **Test coverage** — `server.test.js` has meaningful OTP and API flow tests. All refactors must keep tests green.

---

## 5. Known Issues & Risks (Priority Order)

### 🔴 Critical

| # | Issue | Location | Risk |
|---|---|---|---|
| C1 | `server.js` is a monolith — routing, dispatch, payments, AI, sockets, and startup all in one file | `backend/server.js` | Increasing regression risk with every change |
| C2 | Duplicate `/health` routes | `server.js` lines ~91 and ~135 | Silent ops failure — Railway health checks may hit the wrong one |
| C3 | Migrations run after server start | `server.js` line ~660 | Traffic can arrive before schema is ready; data corruption risk |
| C4 | `test_api.js` is untracked | `backend/test_api.js` | Unknown test logic outside version control |
| C5 | `provider-app/App.js` is currently dirty (modified, uncommitted) | `provider-app/App.js` | Changes could be lost; conflicts likely in any merge |

### 🟡 High

| # | Issue | Location | Risk |
|---|---|---|---|
| H1 | `motorist/App.js` is a ~600 line monolith | `motorist-app/App.js` | Hard to feature-work and prone to regression |
| H2 | `provider/App.js` is a ~706 line monolith | `provider-app/App.js` | Most complex app surface, highest regression risk |
| H3 | WebSocket data leakage — verify room isolation is fully sealed | `server.js` socket section | Motorist A could receive Motorist B's real-time updates |
| H4 | M-Pesa callback handling is inside `server.js` | `server.js` payment section | Daraja callbacks have their own error surface and retry logic; needs isolation |

### 🟢 Low / Hygiene

| # | Issue | Location | Risk |
|---|---|---|---|
| L1 | README still describes some features as "future work" that are already implemented | `README.md` | Team and agent confusion |
| L2 | Large logs and build artifacts committed to repo root | `/` | Repo bloat, slow clones |
| L3 | Empty ghost directories at Windows-style paths | `/D:/roadready/...` | Likely generated artifact; safe to delete |
| L4 | `AdminApp.jsx` is a single-file dashboard | `admin/AdminApp.jsx` | Low priority but will become a problem at scale |

---

## 6. Refactor Plan

Work in this sequence. Do not skip ahead — each step stabilises the foundation for the next.

### Phase 1 — Stabilise (do first, no new features)

**1.1 — Fix C4: Commit or delete `test_api.js`**
- If it has real test logic → commit it to `backend/`
- If it's scratch/throwaway → delete it

**1.2 — Fix C5: Commit dirty `provider-app/App.js`**
- Commit current state before any refactor begins
- Message: `chore: commit current provider app state before refactor`

**1.3 — Fix C2: Deduplicate `/health` routes**
- Keep one `/health` route at the top of `server.js`
- Remove the second occurrence entirely

**1.4 — Fix C3: Move migrations out of server start**
- Extract migration runner to a standalone script: `backend/scripts/migrate.js`
- Run it as a pre-start step in Railway: `npm run migrate && npm start`
- Never block the HTTP server on migration completion

### Phase 2 — Split `server.js`

Target structure after split:

```
backend/
├── server.js              — app init, middleware, startup only (~100 lines)
├── routes/
│   ├── auth.routes.js
│   ├── job.routes.js
│   ├── payment.routes.js
│   ├── provider.routes.js
│   ├── admin.routes.js
│   └── health.routes.js
├── services/
│   ├── dispatch.service.js   — job matching + assignment logic
│   ├── mpesa.service.js      — Daraja STK push + B2C + callbacks
│   ├── socket.service.js     — Socket.IO setup + room management
│   ├── ai.service.js         — Claude API integration
│   └── notification.service.js — FCM push logic
├── middleware/
│   ├── auth.middleware.js
│   └── socket.middleware.js
├── queries.js               — unchanged, keep centralised
└── auth.js                  — unchanged
```

**Agent rule:** Split by extracting — do not rewrite logic during the split. Move code as-is, confirm tests pass, then refactor behaviour in a separate pass.

### Phase 3 — Split Mobile Apps

**3.1 — Provider App first** (most complex, most risk)

Target structure:
```
provider-app/
├── App.js                 — navigation shell only
├── screens/
│   ├── OnboardingScreen.js
│   ├── DashboardScreen.js
│   ├── JobScreen.js
│   ├── NavigationScreen.js
│   └── PayoutsScreen.js
├── components/            — shared UI components
└── hooks/                 — custom hooks (location, socket, etc.)
```

**3.2 — Motorist App second** (simpler flow)

Target structure:
```
motorist-app/
├── App.js                 — navigation shell only
├── screens/
│   ├── HomeScreen.js
│   ├── RequestScreen.js
│   ├── TrackingScreen.js
│   └── PaymentScreen.js
└── components/
```

### Phase 4 — Test Expansion

Priority areas with no or thin coverage:
- Dispatch retry logic
- M-Pesa STK push → callback → job confirmation flow
- Socket room isolation (no cross-user data leakage)
- B2C payout flow
- Refresh token rotation

### Phase 5 — Docs & Hygiene

- Reconcile README with actual implementation
- Delete ghost directories and committed logs
- Tighten `.gitignore` for logs, build outputs, `.expo/`
- Update deployment docs to reflect Railway + Vercel + EAS Build setup

---

## 7. Conventions & Constraints

### General
- All new files use **camelCase** naming (e.g., `dispatch.service.js`)
- Screen components use **PascalCase** (e.g., `DashboardScreen.js`)
- No inline SQL — all queries go through `queries.js`
- No hardcoded credentials — all secrets via environment variables
- No `console.log` in production paths — use Sentry or structured logging

### M-Pesa / Payments
- M-Pesa Daraja integration targets the **Kenyan production environment**
- STK Push amounts are in **KES (Kenyan Shillings)**
- Phone numbers must be normalised to `2547XXXXXXXX` format before any Daraja call
- B2C payouts require a separate initiator credential — never share with STK push config
- All Daraja callbacks must be idempotent — the same callback may be received multiple times

### Africa's Talking / SMS
- OTP SMS via Africa's Talking
- Sender ID is configured at the AT account level — do not hardcode
- OTPs expire in 5 minutes — enforce server-side, not client-side

### Realtime / Sockets
- Every socket connection must be authenticated before joining any room
- Room naming convention: `job:{jobId}`, `motorist:{userId}`, `provider:{userId}`
- Never broadcast to a room from outside `socket.service.js` (after split)
- Verify room isolation: a motorist must never receive events scoped to another motorist

### Mobile
- Both apps target **Expo managed workflow** — do not eject without a clear reason
- Background location uses `Expo TaskManager` — do not replace with bare RN APIs
- Google Maps API key must be scoped per app (motorist vs provider) in `app.json`

### Database
- Migrations are **append-only** — never modify a committed migration file
- New schema changes = new numbered migration file
- Always test migrations on a local Postgres instance before pushing to Railway

---

## 8. Environment Variables (Required)

The following env vars must be set in all environments. Do not add default values for secrets in code.

```
# Database
DATABASE_URL

# Auth
JWT_SECRET
JWT_REFRESH_SECRET

# M-Pesa Daraja
MPESA_CONSUMER_KEY
MPESA_CONSUMER_SECRET
MPESA_SHORTCODE
MPESA_PASSKEY
MPESA_B2C_INITIATOR_NAME
MPESA_B2C_SECURITY_CREDENTIAL
MPESA_CALLBACK_URL

# Africa's Talking
AT_API_KEY
AT_USERNAME

# Firebase
FCM_SERVER_KEY

# Cloudinary
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET

# Sentry
SENTRY_DSN

# Anthropic (AI)
ANTHROPIC_API_KEY

# App
NODE_ENV
PORT
```

---

## 9. Agent Responsibilities & Rules

### Claude
- Architecture review, logic correctness, security analysis, API design
- Cross-checks Codex and Antigravity output for correctness and regressions
- Owns the refactor plan sequencing — does not skip phases
- Flags any proposed change that touches auth, sockets, or M-Pesa callbacks for explicit review

### Codex
- Code generation, refactoring, boilerplate extraction
- Must run `server.test.js` after any backend change and confirm green
- Cross-checks Claude's architectural suggestions for implementation accuracy
- Raises conflicts or ambiguities in this document rather than making unilateral decisions

### Antigravity
- Code consistency, style enforcement, dead code detection
- Cross-checks both agents for drift from conventions in Section 7
- Flags any new file that doesn't follow naming conventions or structure defined in Section 6

### All Agents — Hard Rules
1. **Never rewrite logic during a structural split.** Move first, refactor behaviour separately.
2. **Never commit to `main` directly.** All changes via feature branches + PR.
3. **Never modify `001_initial_schema.sql`.** Append new migrations only.
4. **Never add inline SQL outside `queries.js`.**
5. **Always check this file for context before starting a task.** If something here is stale or wrong, flag it — don't silently work around it.

---

## 10. Current State Summary (as of 2026-03-30)

| Surface | State | Blocker |
|---|---|---|
| Backend | Modular, production-ready | None |
| Motorist App | Split into screens/hooks | None |
| Provider App | Split into screens/hooks/components | None |
| Admin Dashboard | Single-file, functional | Low priority |
| Tests | Full coverage (38 core + advanced suite) | None |
| Docs | Reconciled with implementation | None |

The refactor is complete. All 5 phases have been executed. The platform is modular, tested, and documented. Future work should focus on the Admin Dashboard split and expanding the advanced test suite as new features are added.

---

*This document is maintained by the RoadReady engineering team. Any agent that identifies stale or incorrect information in this file should flag it immediately rather than working around it.*

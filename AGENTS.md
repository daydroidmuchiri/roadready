# AGENTS.md - RoadReady Platform
### Shared Context for Claude, Codex, and Antigravity

> Read this file before touching any part of the codebase.
> This is the single source of truth for agents working on the RoadReady platform.
> Last updated: 2026-04-02

---

## 1. Product Overview

RoadReady is a two-sided marketplace connecting stranded motorists with vetted roadside mechanics in Nairobi, Kenya.

User surfaces:
- Motorist App - React Native (Expo)
- Provider App - React Native (Expo)
- Admin Dashboard - React web app

Market context:
- M-Pesa is the primary payment method
- OTP is sent through Africa's Talking
- Swahili and Kenyan phone-number conventions matter

---

## 2. Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Realtime | Socket.IO |
| Database | PostgreSQL |
| Query layer | `backend/db/queries.js` |
| Auth | OTP + JWT access/refresh |
| Payments | M-Pesa Daraja STK Push + B2C |
| Notifications | Firebase Cloud Messaging |
| File storage | Cloudinary |
| Error tracking | Sentry |
| AI | Anthropic API |

### Mobile
| Layer | Technology |
|---|---|
| Framework | React Native (Expo managed workflow) |
| Navigation | React Navigation |
| Maps | Google Maps SDK + GPS |
| Background work | Expo TaskManager / Background Fetch |
| Shared code | `shared/` |

### Admin
| Layer | Technology |
|---|---|
| Framework | React |
| Structure | `AdminApp.jsx` shell + `pages/` + `components/` |

---

## 3. Repository Structure

```text
roadready/
|- backend/
|  |- db/
|  |- middleware/
|  |- notifications/
|  |- routes/
|  |- services/
|  |- auth.js
|  |- errors.js
|  |- sentry.js
|  |- server.js
|  |- server.test.js
|  `- server.test.advanced.js
|- motorist-app/
|  |- hooks/
|  |- screens/
|  `- App.js
|- provider-app/
|  |- components/
|  |- hooks/
|  |- screens/
|  `- App.js
|- admin/
|  `- src/
|     |- components/
|     |- pages/
|     |- api.js
|     |- theme.js
|     `- AdminApp.jsx
|- shared/
|  |- AuthScreens.js
|  `- backgroundServices.js
`- AGENTS.md
```

---

## 4. What Is Working Well

- Auth is mature. Preserve OTP, refresh-token, `/me`, and device-token flows unless you are intentionally auditing auth.
- Database access belongs in `backend/db/queries.js`. Do not add inline SQL in routes or services.
- Socket room scoping must stay intact. Room naming is `job:{jobId}`, `motorist:{userId}`, `provider:{userId}`.
- Shared mobile logic belongs in `shared/`, not duplicated across the two apps.
- Migrations are append-only. Never modify `backend/db/migrations/001_initial_schema.sql`.

---

## 5. Current State

### Backend
- `backend/server.js` is now a startup shell that mounts middleware and routers
- HTTP endpoints are split across `backend/routes/`
- Dispatch, sockets, payments, and AI orchestration are split into `backend/services/`
- Migrations run through `backend/db/migrate.js`, and `npm start` executes migrations before the server starts

### Mobile
- Motorist app is split into screens and hooks
- Provider app is split into screens, hooks, and components

### Admin
- Admin dashboard is split into a shell plus `pages/`, `components/`, `api.js`, and `theme.js`

### Testing
- Core and advanced backend suites exist in `backend/server.test.js` and `backend/server.test.advanced.js`
- Tests require a reachable PostgreSQL test database. If `TEST_DATABASE_URL` or local Postgres is unavailable, the suite will fail before route assertions run

---

## 6. Open Risks

### High
| # | Issue | Location | Risk |
|---|---|---|---|
| H1 | Backend test execution still depends on external Postgres availability | `backend/server.test.js`, `backend/server.test.advanced.js` | CI/local verification can fail for environmental reasons before app regressions are surfaced |
| H2 | Socket isolation remains a high-stakes area and should be regression-tested on every socket refactor | `backend/services/socket.service.js` | Cross-user realtime leakage |
| H3 | Payment callback behavior must remain idempotent | `backend/routes/payment.routes.js`, payment service | Duplicate Daraja callbacks can double-process state |

### Medium
| # | Issue | Location | Risk |
|---|---|---|---|
| M1 | Generated logs and scratch artifacts may still exist locally | repo root, `backend/` | Repo clutter and operator confusion |
| M2 | Advanced backend tests rely on mocks plus live DB state | backend tests | Good logic coverage, weaker deployment fidelity |

---

## 7. Conventions & Constraints

### General
- New non-component files use camelCase naming
- Screen components use PascalCase naming
- No inline SQL outside `backend/db/queries.js`
- No hardcoded credentials
- Prefer structured logging over `console.log` in production paths

### Payments
- Daraja targets Kenyan production assumptions
- Amounts are in KES
- Normalize phone numbers to `2547XXXXXXXX`
- B2C credentials stay separate from STK credentials
- Callbacks must be idempotent

### Realtime
- Every socket must authenticate before joining rooms
- Do not emit broad broadcasts that bypass scoped room targeting
- After the split, keep room management centralized in the socket service

### Mobile
- Stay on Expo managed workflow unless explicitly approved otherwise
- Background location continues to use Expo TaskManager
- Keep app-specific maps keys separate per app config

### Database
- Migrations are append-only
- New schema changes require a new numbered migration
- Validate migrations against a real local Postgres instance before pushing

---

## 8. Environment Variables

Required backend variables:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
MPESA_CONSUMER_KEY
MPESA_CONSUMER_SECRET
MPESA_SHORTCODE
MPESA_PASSKEY
MPESA_B2C_INITIATOR_NAME
MPESA_B2C_SECURITY_CREDENTIAL
MPESA_CALLBACK_URL
AT_API_KEY
AT_USERNAME
FCM_SERVER_KEY
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
SENTRY_DSN
ANTHROPIC_API_KEY
NODE_ENV
PORT
```

---

## 9. Agent Rules

### All agents
1. Never rewrite logic during a structural split unless the task explicitly includes behavior changes.
2. Never commit directly to `main`.
3. Never modify `backend/db/migrations/001_initial_schema.sql`.
4. Never add inline SQL outside `backend/db/queries.js`.
5. If this file is stale, update or flag it instead of silently working around it.

### Codex
- Run backend tests after backend changes when a test database is available
- If tests cannot run because Postgres is unavailable, say so explicitly in the handoff
- Cross-check implementation details against this document before refactors

### Claude
- Owns architecture review, correctness, and security scrutiny
- Explicitly review auth, sockets, and M-Pesa callback changes

### Antigravity
- Enforce naming, structure, and dead-code hygiene
- Flag drift from the conventions in Section 7

---

## 10. Current Summary

| Surface | State | Blocker |
|---|---|---|
| Backend | Modular routes/services split completed | Runtime verification depends on Postgres availability |
| Motorist App | Split into screens/hooks | None known |
| Provider App | Split into screens/hooks/components | None known |
| Admin Dashboard | Split into shell/pages/components | None known |
| Tests | Core and advanced suites present | Requires reachable Postgres test DB |
| Docs | Reconciled to current structure | Keep updated as structure changes |

If you find the code and this document disagree, treat that as a project issue and resolve it directly.

# RoadReady

On-demand roadside assistance for Nairobi, Kenya.

RoadReady is a two-sided marketplace connecting motorists with vetted roadside providers. The repo includes:

- `backend/` - Node.js + Express API with PostgreSQL, Socket.IO, OTP auth, M-Pesa, payouts, analytics, uploads, and AI endpoints
- `motorist-app/` - Expo app for motorists
- `provider-app/` - Expo app for providers
- `admin/` - React web dashboard for operations
- `shared/` - mobile shared auth and background-service code

## Architecture

```text
roadready/
|- backend/
|  |- db/
|  |- middleware/
|  |- notifications/
|  |- routes/
|  |- services/
|  `- server.js
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
`- shared/
```

## Backend

### Setup

```bash
cd backend
npm install
```

### Environment

Create `backend/.env` with the required variables:

```bash
DATABASE_URL=
DATABASE_SSL=false
JWT_SECRET=
JWT_REFRESH_SECRET=
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_B2C_INITIATOR_NAME=
MPESA_B2C_SECURITY_CREDENTIAL=
MPESA_CALLBACK_URL=
AT_API_KEY=
AT_USERNAME=
FCM_SERVER_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SENTRY_DSN=
ANTHROPIC_API_KEY=
NODE_ENV=development
PORT=3001
```

### Scripts

```bash
npm run dev
npm run migrate
npm run db:status
npm run db:reset
npm start
```

### Backend structure

- `server.js` handles app bootstrap, shared middleware, router mounting, and startup only
- `routes/` owns HTTP route registration
- `services/` owns dispatch, sockets, payments, and AI orchestration
- `db/queries.js` is the central query layer
- `auth.js` and `routes/auth.js` remain the auth backbone

### Testing

Backend tests require a reachable PostgreSQL database.

```bash
cd backend
set TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/roadready_test
npx jest --runInBand --forceExit
```

Notes:

- `SMS_DRY_RUN=true` is used by the test suite so OTP codes are returned in responses
- Set `DATABASE_SSL=true` when pointing development or test runs at Railway/Postgres instances that require TLS
- On Windows or sandboxed environments, `--runInBand` is more reliable than Jest worker processes

## Admin Dashboard

```bash
cd admin
npm install
npm start
```

The admin app is split into `pages/`, `components/`, `api.js`, and `theme.js`, with `AdminApp.jsx` acting as the shell.

## Mobile Apps

### Motorist app

```bash
cd motorist-app
npm install
npx expo start
```

### Provider app

```bash
cd provider-app
npm install
npx expo start
```

Both apps use Expo managed workflow and share auth/background helpers from `shared/`.

## Realtime conventions

- `job:{jobId}`
- `motorist:{userId}`
- `provider:{userId}`

Socket authentication and room joining are centralized in the backend socket service.

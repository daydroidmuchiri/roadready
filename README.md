# RoadReady — Full Stack Platform

On-demand roadside assistance. Kenya's answer to the Uber for breakdowns.

## Architecture
```
roadready/
├── backend/                    Node.js/Express API
│   ├── routes/                 Route handlers
│   ├── services/               Business logic (dispatch, M-Pesa, sockets, AI)
│   ├── middleware/             Auth and rate limiting
│   ├── db/                     Migrations and query layer
│   └── server.js               App entry point
├── motorist-app/               React Native (Expo) — motorist surface
│   ├── screens/                Screen components
│   └── hooks/                  Custom hooks
├── provider-app/               React Native (Expo) — provider surface
│   ├── screens/                Screen components
│   ├── hooks/                  Custom hooks
│   └── components/             Shared UI components
├── admin/                      React web dashboard
└── shared/                     Shared mobile utilities
```

---

## 1. Backend API

### Setup
```bash
cd backend
npm install
```

### Environment variables
Create `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...          # Get from console.anthropic.com
JWT_SECRET=your-long-secret-here
PORT=3001

# M-Pesa (Safaricom Daraja)
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=174379
MPESA_PASSKEY=...
MPESA_CALLBACK_URL=https://yourdomain.com/api/payments/mpesa/callback
```

### Run
```bash
npm run dev        # Development (nodemon)
npm start          # Production
```

### Key endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register motorist or provider |
| POST | /api/auth/login | Login |
| GET  | /api/services | List all services & prices |
| POST | /api/jobs | Create a new job |
| GET  | /api/jobs | List jobs (filtered by role) |
| PATCH | /api/jobs/:id/status | Update job status |
| GET  | /api/providers | List all providers |
| PATCH | /api/providers/location | Update provider GPS location |
| POST | /api/payments/mpesa | Initiate M-Pesa STK push |
| POST | /api/ai/diagnose | AI breakdown diagnosis (Claude) |
| POST | /api/ai/dispatch | AI dispatch assistant (Claude) |

### WebSocket events
| Event | Direction | Payload |
|-------|-----------|---------|
| new_job | Server → Clients | Job object |
| job_matched | Server → Clients | { jobId, provider } |
| job_updated | Server → Clients | Job object |
| provider_location | Both ways | { providerId, location } |
| payment_confirmed | Server → Clients | { jobId, ref } |

### Production database (PostgreSQL)
Replace the in-memory `db` object with these tables:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  role VARCHAR(20) DEFAULT 'motorist', -- motorist | provider | admin
  rating DECIMAL(2,1) DEFAULT 0,
  skills TEXT[],
  status VARCHAR(20) DEFAULT 'offline', -- available | on_job | offline
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE jobs (
  id VARCHAR(10) PRIMARY KEY,
  motorist_id UUID REFERENCES users(id),
  provider_id UUID REFERENCES users(id),
  service VARCHAR(50) NOT NULL,
  price INTEGER NOT NULL,
  commission INTEGER NOT NULL,
  status VARCHAR(30) DEFAULT 'searching',
  address TEXT,
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  payment_ref VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  matched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(10) REFERENCES jobs(id),
  rater_id UUID REFERENCES users(id),
  rated_id UUID REFERENCES users(id),
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 2. Admin Dashboard (React)

### Setup
```bash
cd admin
npx create-react-app . --template cra-template
npm install socket.io-client recharts
```

### Environment
```
REACT_APP_API_URL=http://localhost:3001
REACT_APP_MAPS_KEY=your-google-maps-api-key
```

### Add to src/App.js
```js
import AdminApp from './AdminApp';
export default function App() { return <AdminApp />; }
```

### Run
```bash
npm start          # http://localhost:3000
```

### Deploy
```bash
npm run build
# Deploy /build folder to Vercel, Netlify, or S3+CloudFront
```

---

## 3. Motorist App (React Native + Expo)

### Setup
```bash
cd motorist-app
npx create-expo-app . --template blank
npm install @react-native-async-storage/async-storage socket.io-client
```

### Environment
Create `app.config.js`:
```js
export default {
  expo: {
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001',
      googleMapsKey: process.env.EXPO_PUBLIC_MAPS_KEY,
    }
  }
};
```

### Replace App.js with motorist-app/App.js

### Run
```bash
npx expo start
```

### Build for production
```bash
eas build --platform android   # APK / AAB
eas build --platform ios       # IPA
```

---

## 4. Provider App (React Native + Expo)

Same setup as motorist app but use `provider-app/App.js` as the entry point.

---

## M-Pesa Integration (Production)

Replace the mock payment in `server.js` with real Daraja API calls:

```js
// Step 1: Get OAuth token
const token = await getMpesaToken(CONSUMER_KEY, CONSUMER_SECRET);

// Step 2: STK Push
const response = await fetch('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    BusinessShortCode: SHORTCODE,
    Password: Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64'),
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: job.price,
    PartyA: phone,    // Customer phone
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: CALLBACK_URL,
    AccountReference: job.id,
    TransactionDesc: `RoadReady - ${job.service}`,
  })
});

// Step 3: Handle callback at POST /api/payments/mpesa/callback
app.post('/api/payments/mpesa/callback', (req, res) => {
  const { Body: { stkCallback: { ResultCode, CheckoutRequestID } } } = req.body;
  if (ResultCode === 0) {
    // Payment successful — update job status
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
```

---

## Deployment

### Backend — Railway
The backend deploys automatically to Railway on push to `main`.
Set the following environment variables in Railway:
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

### Admin Dashboard — Vercel
The admin dashboard deploys automatically to Vercel on push to `main`.

### Mobile Apps — Expo EAS Build
Both motorist and provider apps build via EAS on push to `main`.
Build profiles: development, preview, production.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js, Express |
| Real-time | Socket.IO |
| Database | PostgreSQL |
| Authentication | JWT + bcrypt |
| AI Features | Claude API (claude-sonnet-4-20250514) |
| Payments | Safaricom M-Pesa Daraja API |
| Maps | Google Maps Platform |
| Admin Frontend | React |
| Mobile Apps | React Native (Expo) |
| Hosting | AWS / Railway / Render |

---

## Feature Roadmap

- [x] Job creation and dispatch
- [x] Provider matching algorithm (distance + rating score)
- [x] Real-time GPS tracking via WebSockets
- [x] M-Pesa payment integration
- [x] AI breakdown diagnosis (Claude)
- [x] AI dispatch assistant (Claude)
- [x] Provider onboarding flow
- [x] Ratings and reviews
- [x] Push notifications (Expo + FCM)
- [ ] Surge pricing engine
- [ ] Insurance company white-label API
- [ ] Fleet management portal
- [ ] Parts supplier integration
- [ ] USSD fallback for feature phones
- [ ] Predictive maintenance alerts

---

© 2025 RoadReady Ltd. Nairobi, Kenya. Confidential.

# RoadReady — Deployment Runbook

**Time to complete first deployment: ~2 hours**
**Stack: Railway (API) · Vercel (Admin) · EAS Build (Mobile)**

---

## Prerequisites

Install these tools before starting:

```bash
npm install -g @railway/cli vercel eas-cli
```

---

## Part 1 — Backend API on Railway

### Step 1: Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `roadready` repository
4. Set the **Root Directory** to `backend`
5. Railway auto-detects Node.js — confirm it sees `package.json`

### Step 2: Add a PostgreSQL database

1. In your Railway project, click **+ New → Database → PostgreSQL**
2. Railway creates the database and automatically sets `DATABASE_URL` in your service
3. No manual URL copying needed — Railway links them automatically

### Step 3: Set environment variables

In Railway → your service → **Variables**, add each of these:

```
NODE_ENV                    = production
JWT_SECRET                  = <generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
ANTHROPIC_API_KEY           = sk-ant-...
GOOGLE_MAPS_SERVER_KEY      = AIza...
FIREBASE_SERVICE_ACCOUNT_JSON = {"type":"service_account",...}
AT_USERNAME                 = <your Africa's Talking username>
AT_API_KEY                  = <your Africa's Talking API key>
AT_SENDER_ID                = RoadReady
SMS_DRY_RUN                 = false
CLIENT_ORIGIN               = https://roadready-admin.vercel.app
```

> **JWT_SECRET**: Run this in your terminal to generate a secure secret:
> `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### Step 4: Run database migrations

Railway runs `npm run migrate && npm start` automatically (from `Procfile`).
On first deploy, the migration creates all tables from scratch.

To run migrations manually:
```bash
# Install Railway CLI and link your project
railway login
railway link <your-project-id>

# Run migrations
railway run npm run migrate

# Check migration status
railway run npm run db:status
```

### Step 5: Verify the deployment

```bash
curl https://roadready-api.railway.app/health
# Expected: {"status":"ok","db":"connected","timestamp":"..."}
```

Your Railway URL format: `https://<service-name>.railway.app`

Find it in Railway → your service → **Settings → Domains**.

### Step 6: Set your custom domain (optional)

1. Railway → Settings → Domains → **+ Custom Domain**
2. Add: `api.roadready.co.ke`
3. Add the CNAME record to your DNS:
   ```
   CNAME  api  <your-railway-subdomain>.railway.app
   ```

---

## Part 2 — Admin Dashboard on Vercel

### Step 1: Create a Vercel project

```bash
cd admin

# Login to Vercel
vercel login

# Create the project (first time only)
vercel

# Follow prompts:
#   Set up and deploy? → Y
#   Which scope?       → your team/personal account
#   Link to existing?  → N (create new)
#   Project name?      → roadready-admin
#   Directory?         → ./
#   Override settings? → N
```

### Step 2: Set environment variables

```bash
vercel env add REACT_APP_API_URL
# Value: https://roadready-api.railway.app

vercel env add REACT_APP_MAPS_KEY
# Value: your Google Maps API key
```

Or set them in the Vercel dashboard: Project → Settings → Environment Variables.

### Step 3: Deploy

```bash
# Deploy to production
vercel --prod

# Deploy to preview (for testing)
vercel
```

### Step 4: Verify

Open your Vercel URL (e.g. `https://roadready-admin.vercel.app`).
The admin dashboard should load and connect to the Railway API.

---

## Part 3 — Mobile Apps via EAS Build

### Step 1: Create an Expo account

1. Go to [expo.dev](https://expo.dev) and sign in
2. Create a new organisation: `roadready`
3. Run `eas login` in your terminal

### Step 2: Register the apps

```bash
# Motorist app
cd motorist-app
eas init
# Follow prompts — creates the app on expo.dev

# Provider app
cd ../provider-app
eas init
```

Note the **Project ID** shown — add it to `app.json` in `extra.eas.projectId`.

### Step 3: Configure Google Maps for Android

1. Download `google-services.json` from Firebase Console
   - Firebase → Project Settings → Your apps → Android → Download
2. Place it in `motorist-app/google-services.json`
3. Also place a copy in `provider-app/google-services.json`
4. Add to `.gitignore` — never commit this file

For iOS: download `GoogleService-Info.plist` and place in each app folder.

### Step 4: Build for internal testing

This creates an APK you can install directly on Android phones — no app store needed.

```bash
# Build motorist app (Android APK)
cd motorist-app
eas build --platform android --profile preview

# Build provider app (Android APK)
cd ../provider-app
eas build --platform android --profile preview
```

EAS will:
1. Upload your code to Expo's build servers
2. Build the APK (takes 10–15 minutes)
3. Email you a download link
4. Show the build in your Expo dashboard

**Share the APK link with your first test providers and drivers.**
They install it directly — no Play Store account needed for internal testing.

### Step 5: Build for production (Play Store / App Store)

```bash
# Android (AAB format for Play Store)
eas build --platform android --profile production

# iOS (requires Apple Developer account — $99/year)
eas build --platform ios --profile production
```

### Step 6: Submit to stores

```bash
# Google Play (after getting first production build)
eas submit --platform android --profile production

# Apple App Store
eas submit --platform ios --profile production
```

> **For Kenya market**: Start with Google Play — Android is >85% of the Kenyan smartphone market.
> Apple App Store can come later. The internal APK from Step 4 is enough to validate with your first users.

---

## Part 4 — GitHub CI/CD Setup

### Step 1: Push code to GitHub

```bash
cd roadready
git init
git add .
git commit -m "Initial RoadReady platform"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/roadready.git
git push -u origin main
```

### Step 2: Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add each of these:

| Secret name | Where to find it |
|---|---|
| `RAILWAY_TOKEN` | railway.app → Account Settings → Tokens |
| `RAILWAY_SERVICE_ID` | Railway → your service → Settings → Service ID |
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel → Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | Vercel → your project → Settings → General |
| `EXPO_TOKEN` | expo.dev → Account Settings → Access Tokens |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

### Step 3: Verify CI runs

Push a small commit to `main` and watch the Actions tab.
On every push to `main`:
1. Tests run against a fresh PostgreSQL container
2. Backend deploys to Railway
3. Admin deploys to Vercel
4. Mobile builds are triggered on EAS

---

## Part 5 — Environment Summary

After completing all steps, your environments look like this:

```
PRODUCTION
  API:    https://api.roadready.co.ke   (Railway)
  Admin:  https://admin.roadready.co.ke (Vercel)
  DB:     Railway PostgreSQL (managed, auto-backups)
  Mobile: Play Store + App Store

STAGING
  API:    https://roadready-api-staging.railway.app
  Admin:  https://roadready-admin-staging.vercel.app
  DB:     Separate Railway PostgreSQL instance

DEVELOPMENT
  API:    http://localhost:3001
  Admin:  http://localhost:3000
  DB:     Local PostgreSQL
  Mobile: Expo Go app (scan QR code)
```

---

## Monitoring & Logs

### View live logs

```bash
# Railway (backend logs)
railway logs --tail

# Or in Railway dashboard → your service → Deployments → View Logs
```

### Set up uptime monitoring (free)

1. Go to [uptimerobot.com](https://uptimerobot.com) (free tier)
2. Add a new monitor: HTTP(s)
3. URL: `https://api.roadready.co.ke/health`
4. Interval: every 5 minutes
5. Alert contact: your phone number or email
6. You'll get an SMS when the API goes down

### Database backups

Railway PostgreSQL automatically creates daily backups and retains 7 days.
To export manually:

```bash
railway run pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

---

## Post-Deployment Checklist

Run through this after every production deployment:

- [ ] `GET /health` returns `{"status":"ok","db":"connected"}`
- [ ] OTP send works (test with your own number)
- [ ] OTP verify works and returns a JWT
- [ ] Create a test job via the API
- [ ] Admin dashboard loads and shows the job
- [ ] Push notification received on test device
- [ ] Payment flow completes (M-Pesa sandbox)
- [ ] Provider location updates visible on admin map

---

## Rollback Procedure

If a bad deployment goes out:

```bash
# Railway: redeploy the previous version
# Railway dashboard → your service → Deployments → click previous → Redeploy

# Or via CLI:
railway rollback
```

For database migrations that need rolling back — see `db/migrate.js --reset` (dev only).
In production, always write forward-compatible migrations, never `DROP` or destructive changes.

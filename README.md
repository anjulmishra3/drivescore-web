# DriveScore — Web App (v0)

Phone-only driving-behaviour scoring. This is **v0** from the design doc: everything
that doesn't need continuous background sensor capture — calibration, short foreground
trips, and viewing scores/trends. Long screen-off commutes are deferred to the native
Android app (v1).

No OBD hardware required — scoring uses the phone's own GPS + accelerometer + gyroscope.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Supabase** — Postgres + Auth (email/password), Row Level Security
- **Recharts** — trend chart

## Features

| Page | What it does |
|---|---|
| `/signup`, `/login` | Supabase email/password auth |
| `/onboarding` | Phone-sensor getting-started guide |
| `/calibrate` | Live foreground drive — validates GPS/accel/gyro availability & orientation |
| `/trip` | "Quick trip" recorder → scored on finish |
| `/dashboard` | Overall score, sub-scores, weekly trend, trip history |
| `/settings` | Profile, vehicle, notification & privacy prefs |

Sensor capture (`src/lib/useTripRecorder.ts`) handles the iOS `requestPermission()`
gesture requirement, `watchPosition`, and `devicemotion`/`deviceorientation`.
Scoring (`src/lib/scoring.ts`) is a **v0 heuristic** — a deliberate stand-in for the
future cloud pipeline. It turns the sensor stream into the canonical score shape that
v1 will reuse via the same `POST /api/trips` contract.

## Setup

1. **Create a Supabase project** (https://supabase.com).
2. **Apply the schema**: run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.
3. **Environment**: copy `.env.example` to `.env.local` and fill in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...   # server-only
   ```
4. **Run**:
   ```bash
   npm install
   npm run dev
   ```
   App runs on http://localhost:8090.

## Notes

- The sensor APIs require **HTTPS** (a secure context). `localhost` counts as secure for
  desktop testing, but to test on a real phone you need HTTPS — use a tunnel
  (e.g. `ngrok`) or deploy to Vercel.
- The `devices` table exists in the schema as future-proofing for OBD support but nothing
  in v0 surfaces it.
- "Load demo data" on an empty dashboard seeds ~18 trips so you can see the trends UI.

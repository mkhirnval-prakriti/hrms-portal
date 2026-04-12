# Prakriti Herbs — HRMS Portal

Enterprise HRMS: employees, attendance, payroll, leaves, documents, and notices.

**Stack:** React + Vite (`client/`) → production build in **`dist/app/`** (standard; override with env `STATIC_APP_DIR`), **Express** (`server.js`, `src/`), **SQLite** (`data/hrms.sqlite` by default).

**API from the browser:** leave **`VITE_API_BASE_URL`** empty for same-origin (Replit / one server). Set to full origin (e.g. `https://api.example.com`) only if the API is on another host.

---

## Features

- **Attendance:** GPS, face capture, fingerprint, office geofence, kiosk
- **Dashboard:** staff status, insights
- **Employees:** directory, roles, shifts
- **Leaves:** apply / approve workflows
- **Payroll:** monthly entries and reports
- **Documents:** upload / verification
- **Notices:** broadcast to staff
- **Auth:** login (ID + password), JWT; OTP for forgot-password only

---

## Quick start (local)

1. Copy env templates: `cp .env.example .env` (optional: `client/.env.example` → `client/.env`)
2. Install: `npm install` (installs `client/` via `postinstall`)
3. **Dev (two terminals):**
   - `node server.js` — API (default **5000**)
   - `cd client && npm run dev` — Vite at **5173** (proxy to API; set `VITE_API_PORT` if API port differs)
   - Open **http://localhost:5173/app/**
4. **Production-style (one process):** `npm run build && npm start` → **http://localhost:5000/app/** (or `PORT`)

## Health & smoke test

```bash
curl -s http://localhost:5000/health
curl -s http://localhost:5000/api/health
npm run verify   # requires server running on PORT
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default **5000**) |
| `HOST` | Bind address (default **0.0.0.0**) |
| `NODE_ENV` | `development` / `production` |
| `SESSION_SECRET` | Required when `NODE_ENV=production` |
| `JWT_SECRET` | Optional; falls back to `SESSION_SECRET` |
| `DB_PATH` | SQLite file (default `./data/hrms.sqlite`) |
| `ALLOWED_ORIGINS` | Optional CORS: comma-separated origins, or `*`. Empty = same-origin only |
| `CORS_STRICT` | Set `1` to skip auto localhost dev origins when `ALLOWED_ORIGINS` is set |
| `STATIC_APP_DIR` | Optional absolute path to SPA files (default **`dist/app`**) |
| `VITE_API_BASE_URL` | Client build: empty = same origin; else full API origin (no `/api` suffix) |
| `VITE_API_PORT` | Dev proxy target (default **5000**) |

Secrets must not be committed — see **`.env.example`**.

## Build output

`npm run build` runs the Vite production build. Output directory: **`dist/app/`** at the repo root (`client/vite.config.ts` → `outDir`). Express serves this folder at **`/app`** (configurable via **`STATIC_APP_DIR`**). The `dist/` folder is gitignored — run **`npm run build`** on the server (Replit deployment does this).

## Replit / deployment

1. Set secrets: `SESSION_SECRET`, optionally `JWT_SECRET`
2. Run: `npm install && npm run build && npm start` (see **`.replit`**)
3. Replit injects `PORT` automatically

**`replit.nix`:** not required — pure Node.js + npm dependencies; Nix channel is set in **`.replit`**.

## API

JSON routes: **`/api/*`**. The SPA uses relative **`/api/...`** (same origin in production).

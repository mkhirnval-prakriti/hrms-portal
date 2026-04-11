# Deploy HRMS (GitHub + Render)

## Stack

- **Backend:** Node.js + Express (`server.js`, `src/api.js`)
- **Database:** SQLite (file `data/hrms.sqlite` locally, or `DB_PATH=/data/hrms.sqlite` on Render with a persistent disk)
- **Auth:** Cookie sessions (portal UI) + **JWT** (`Authorization: Bearer`) for APIs and mobile clients
- **MongoDB:** Not used. The app is production-ready on SQLite; optional `MONGO_URI` in Render is unused unless you add a separate integration.

## API base URL

- **Recommended:** `https://YOUR-SERVICE.onrender.com/api/...`
- **Aliases (no `/api` prefix):** same routes as below, e.g. `POST /login`, `GET /attendance`, `GET /reports` (see `server.js`).

### Mandatory endpoints (also under `/api`)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/login` or `/api/login` | Returns `{ token, user, ... }` |
| POST | `/attendance/checkin` | JSON body `{ lat, lng }` (GPS may be required by branch fence) |
| POST | `/attendance/checkout` | Same |
| GET | `/attendance` | Query: `userId`, `from`, `to`, `status` (RBAC applies) |
| GET | `/employees` | Simplified list (`admin` / `staff` roles) |
| POST | `/employees` | `{ name, password, role: admin\|staff, email?, mobile?, department? }` |
| GET | `/logs` | Super Admin only; read-only audit trail |
| GET | `/reports` | JSON with export URLs (CSV/XLSX need `export:read` where applicable) |

Existing portal routes remain: `/api/auth/login`, `/api/auth/me`, `/api/attendance/punch`, etc.

## Environment variables (Render)

Set in **Web Service → Environment**:

| Key | Required | Description |
|-----|----------|-------------|
| `PORT` | auto | Render sets this |
| `NODE_ENV` | yes | `production` |
| `SESSION_SECRET` | yes | Random string (cookie sessions) |
| `JWT_SECRET` | yes | Random string (JWT signing; must match across instances) |
| `DB_PATH` | recommended | `/data/hrms.sqlite` with a **persistent disk** |
| `INTEGRATION_SECRET` | optional | Google OAuth token encryption |
| `MONGO_URI` | optional | **Not used** by current code |

**Build command:** `npm install`  
**Start command:** `npm start`

See `render.yaml` for a blueprint (adjust plan/region/disk as needed).

## GitHub push (run on your machine)

Replace `YOUR_USER` and `YOUR_REPO` with your GitHub details.

```bash
git init
git add .
git commit -m "HRMS full system"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

If the repo already exists empty, the push creates `main`. Use a [Personal Access Token](https://github.com/settings/tokens) as the password when prompted.

## Render: connect GitHub

1. **New → Web Service** → connect the repository.
2. Use **Root Directory** empty (repo root).
3. Add environment variables from the table above.
4. **Disk:** add a disk, mount `/data`, set `DB_PATH=/data/hrms.sqlite` (paid instances support disks; on Free tier use ephemeral storage or external DB later).
5. Deploy. Your **live URL** is shown on the service dashboard, e.g. `https://hrms-portal-xxxx.onrender.com`.

## Health checks

- `GET /health`
- `GET /api/health`

## Post-deploy

- Open `https://YOUR-SERVICE.onrender.com/portal/#/login`
- Set `GOOGLE_OAUTH_REDIRECT_URI` to `https://YOUR-SERVICE.onrender.com/api/integrations/google/oauth/callback` if using Google Sheets.

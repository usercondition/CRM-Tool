# CRM Tool

A lightweight CRM to track **clients** and **orders**. Runs locally or online on [Render](https://render.com) with optional PostgreSQL storage and password protection.

**Repository:** [github.com/usercondition/CRM-Tool](https://github.com/usercondition/CRM-Tool)

## Quick start (local)

```bash
git clone https://github.com/usercondition/CRM-Tool.git
cd CRM-Tool
npm install
node server.js
```

Open **http://localhost:3847**

Without `DATABASE_URL`, data is stored in `data/store.json`. Without `CRM_PASSWORD`, login is disabled.

## Features

- **Dashboard** — open orders, overdue count, pipeline by status
- **Clients & orders** — full CRUD, Kanban, search and filters
- **CSV export** — download clients or orders from the Orders / Clients screens
- **Password login** — enable with `CRM_PASSWORD` (required for public hosting)
- **PostgreSQL** — persistent storage when `DATABASE_URL` is set (auto on Render)

## Deploy on Render (online)

1. Repo is at [usercondition/CRM-Tool](https://github.com/usercondition/CRM-Tool).
2. In Render: **New → Blueprint** → select the repo → deploy.
3. The blueprint creates a **web service** and a **free PostgreSQL database** linked via `DATABASE_URL`.
4. In the web service **Environment**, add:
   - `CRM_PASSWORD` = a strong password you will use to sign in
5. Redeploy if needed, then open your Render URL and sign in.

### After deploy checklist

- [ ] Set `CRM_PASSWORD` in Render environment
- [ ] Sign in at your public URL
- [ ] Add a real client and order — confirm they survive a redeploy (PostgreSQL)
- [ ] Use **Export CSV** to back up data periodically

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `CRM_PASSWORD` | Yes (production) | Single shared login password |
| `CRM_SESSION_SECRET` | No | Cookie signing secret (defaults to `CRM_PASSWORD`) |
| `DATABASE_URL` | No (yes on Render) | PostgreSQL connection string |
| `PORT` | No | Server port (Render sets automatically) |

See `.env.example` for local development.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/auth/status` | Login state |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/export/clients.csv` | Export clients |
| GET | `/api/export/orders.csv` | Export orders |
| GET | `/api/dashboard` | Summary stats |
| GET/POST | `/api/clients` | List or create clients |
| GET/PUT/DELETE | `/api/clients/:id` | Single client |
| GET/POST | `/api/orders` | List or create orders |
| GET/PUT/DELETE | `/api/orders/:id` | Single order |

## Roadmap

- [x] Persistent PostgreSQL on Render
- [x] Password login
- [x] CSV export
- [ ] PWA install prompt + app icons
- [ ] Desktop/mobile app shell (Tauri / Capacitor)
- [ ] Multi-user accounts (optional)

## Order workflow

Status: `New` → `In Progress` → `Shipped` → `Delivered`

Payment: `Unpaid`, `Partial`, `Paid`, `Refunded`

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

- **Dashboard** — today/week strip, pipeline value, payment snapshot, 14-day due calendar, 90-day revenue chart, client health, stale orders, overdue/unpaid lists, activity feed, quick filter actions
- **Global search** — find clients and orders from the header (name, order ID, tags, invoice/PO)
- **Saved views** — save order filter combinations from the Orders sidebar
- **Clients & orders** — full CRUD, Kanban, search and filters (Open / Overdue / Unpaid / Stale)
- **Order fields** — tags (`rush`, `repeat`, `warranty` presets), invoice #, PO #
- **Order detail** — activity timeline, quick status advance, mark paid, add notes
- **Client detail** — contact summary and full order history per client
- **CSV export** — includes tags, invoice, and PO columns
- **Daily digest** — preview in app; email via SMTP + `CRM_DIGEST_EMAIL`
- **PWA** — installable with offline static caching (`manifest` + service worker)
- **Browser notifications** — optional alert when overdue orders exist (after permission)
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
- [ ] Hard refresh after deploys (`Ctrl+Shift+R`)

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `CRM_PASSWORD` | Yes (production) | Single shared login password |
| `CRM_SESSION_SECRET` | No | Cookie signing secret (defaults to `CRM_PASSWORD`) |
| `DATABASE_URL` | No (yes on Render) | PostgreSQL connection string |
| `CRM_DIGEST_EMAIL` | No | Default recipient for digest emails |
| `SMTP_*` | No | SMTP settings to send digest email |
| `STALE_ORDER_DAYS` | No | Days without activity before an order is stale (default 7) |
| `PORT` | No | Server port (Render sets automatically) |

See `.env.example` for local development.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/auth/status` | Login state |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/meta` | Status lists, tag presets, storage mode |
| GET | `/api/dashboard` | Analytics dashboard payload |
| GET | `/api/search?q=` | Global search |
| GET/PUT | `/api/settings` | App settings (digest email) |
| GET/POST | `/api/saved-views` | List or create saved order views |
| DELETE | `/api/saved-views/:id` | Delete a saved view |
| GET | `/api/digest/preview` | Plain-text daily digest |
| POST | `/api/digest/send` | Send digest email (requires SMTP) |
| GET | `/api/export/clients.csv` | Export clients |
| GET | `/api/export/orders.csv` | Export orders |
| GET/POST | `/api/clients` | List or create clients |
| GET/PUT/DELETE | `/api/clients/:id` | Single client |
| GET | `/api/clients/:id?detail=1` | Client with order list |
| GET/POST | `/api/orders` | List or create orders |
| GET/PUT/DELETE | `/api/orders/:id` | Single order |
| GET/POST | `/api/orders/:id/activity` | Order timeline / add note |
| PATCH | `/api/orders/:id/quick` | Quick status / payment update |

## Order workflow

Status: `New` → `In Progress` → `Shipped` → `Delivered`

Payment: `Unpaid`, `Partial`, `Paid`, `Refunded`

Tag presets: `rush`, `repeat`, `warranty` (comma-separated custom tags also supported)

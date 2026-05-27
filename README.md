# CRM Tool

A lightweight CRM to track **clients** and **orders**. Runs locally or online from a single Node.js server with JSON file storage.

**Repository:** [github.com/usercondition/CRM-Tool](https://github.com/usercondition/CRM-Tool)

## Quick start (local)

```bash
git clone https://github.com/usercondition/CRM-Tool.git
cd CRM-Tool
node server.js
```

Open **http://localhost:3847**

Optional: `PORT=4000 node server.js`

## Features

- **Dashboard** — open orders, overdue count, pipeline by status, recent activity
- **Clients** — name, email, phone, address, notes; rollups for open orders and value
- **Orders** — Kanban by status, searchable table, due dates, payment status, overdue flags
- **CRUD** — add, edit, and delete clients and orders in the browser

## Host online (recommended: Render)

GitHub stores the code; it does **not** run the Node server. To make the app accessible on the web:

1. Push this repo to [usercondition/CRM-Tool](https://github.com/usercondition/CRM-Tool) (see below if empty).
2. Sign up at [Render](https://render.com) and connect your GitHub account.
3. **New → Blueprint** → select **CRM-Tool** → deploy using the included `render.yaml`.
4. Render gives you a public URL like `https://crm-tool.onrender.com`.

Alternative hosts that run Node.js: [Railway](https://railway.app), [Fly.io](https://fly.io), or any VPS.

### Data on free hosting

On Render’s free plan, the filesystem is **ephemeral** — data may reset when the service redeploys or restarts. For real production use:

- Add a [Render persistent disk](https://render.com/docs/disks), or
- Move storage to a database (SQLite/Turso/Postgres) in a later update.

Back up `data/store.json` regularly when self-hosting locally.

## Push code to GitHub

From this folder:

```bash
git init
git add .
git commit -m "Initial CRM tool — clients, orders, dashboard"
git branch -M main
git remote add origin https://github.com/usercondition/CRM-Tool.git
git push -u origin main
```

If the remote already has commits, use `git pull origin main --rebase` first, then push.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check (for hosting) |
| GET | `/api/dashboard` | Summary stats |
| GET/POST | `/api/clients` | List or create clients |
| GET/PUT/DELETE | `/api/clients/:id` | Single client |
| GET/POST | `/api/orders` | List or create orders (`?clientId=&status=`) |
| GET/PUT/DELETE | `/api/orders/:id` | Single order |

## Order workflow

Status: `New` → `In Progress` → `Shipped` → `Delivered`

Payment: `Unpaid`, `Partial`, `Paid`, `Refunded`

## Roadmap

- [ ] Persistent cloud database for production hosting
- [ ] Optional login for multi-user access
- [ ] Export to CSV
- [ ] Packaged desktop/mobile app (e.g. Tauri or PWA) once the web version is stable

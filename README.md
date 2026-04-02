# Otic Apartments Portal

Otic Apartments Portal is a small Node/Express app for running a tenant portal and a simple admin dashboard from the same codebase.

The tenant side is meant for day-to-day self-service. Tenants can check their balance, view transactions, read notices, submit payment confirmations, raise maintenance issues, access documents, send messages, review lease details, and submit vacating notices.

The admin side is for property operations. Admin users can create tenants, review payment submissions, manage maintenance tickets, send messages, upload shared documents, review move-out notices, apply billing values, and keep an eye on the overall portfolio summary.

It is not trying to be a huge property-management platform. It is closer to a focused internal tool for a small apartment setup.

## What the project uses

- Node.js
- Express
- PostgreSQL on Render for deployment
- SQLite with `better-sqlite3` as the local fallback
- Vanilla HTML, CSS, and JavaScript on the frontend
- `multer` for document uploads

## Main features

- Tenant login with first name and account number
- Admin login with a cookie-based session
- Tenant dashboard for rent status, arrears, transactions, and lease info
- Payment confirmation flow with M-PESA-style payment details
- Maintenance ticket submission and admin review
- Tenant/admin messaging
- Shared document uploads for tenants
- Vacating notice workflow
- Encrypted local backup generation

## Running it locally

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

If PowerShell gives you trouble with `npm start`, use:

```bash
npm.cmd start
```

You can also use:

```bash
.\start.cmd
```

3. Open the app in your browser:

```text
http://localhost:3000
```

If port `3000` is already taken, the server will try the next available port and print the correct URL in the terminal.

## Admin access

Admin login page:

```text
http://localhost:3000/secure-admin/login
```

Admin dashboard:

```text
http://localhost:3000/secure-admin
```

Local development defaults:

- Username: `admin`
- Password: `admin123`

Those defaults are only meant for local work. In production, set your own values through environment variables.

## Fresh database behavior

This project starts empty on purpose. There is no demo tenant preloaded.

On a fresh database, the usual flow is:

1. Sign in to the admin dashboard
2. Create one or more tenant accounts
3. Log in to the tenant portal using the tenant's first name and account number

## Useful scripts

- `npm start` - start the server
- `npm run reset:data` - wipe the database, admin settings, backups, and uploads
- `npm run migrate:sqlite-to-postgres` - copy data from a local SQLite file into the configured Postgres database
- `npm run check:syntax` - run a basic syntax check
- `npm run validate` - run the project validation script

`npm run reset:data` is destructive, so use it carefully.

## Environment variables

Copy `.env.example` and update it for your environment.

Current variables:

- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `APP_TIME_ZONE`
- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `BACKUP_SECRET`
- `SQLITE_DB_PATH`
- `DB_PATH`
- `BACKUP_DIR`
- `UPLOAD_DIR`

Important notes:

- In production, the server will refuse to start unless `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `BACKUP_SECRET` are set.
- `DATABASE_URL` is the main production database setting and is what the Render deployment should use.
- `APP_TIME_ZONE` controls date-based reminders and billing alerts. It defaults to `Africa/Nairobi`.
- `SQLITE_DB_PATH` is optional and is only used by the one-time migration script when you want to import an existing SQLite file into Postgres.
- `DB_PATH` is still available for local SQLite fallback.
- `BACKUP_DIR` should also be persistent.
- `UPLOAD_DIR` should also be persistent so shared files survive restarts and redeploys.

## Deployment notes

This is a stateful Node app. It now uses Render Postgres for deployed data and still writes uploaded files to disk, so it needs a host that supports:

- a long-running web service
- persistent storage
- environment variables
- a managed PostgreSQL database

Good fits:

- a VPS running Node directly
- Docker on a VPS
- a platform like Render with Postgres plus persistent disk support

Poor fits:

- static hosting
- serverless-only setups with ephemeral storage

The repo includes both a `Dockerfile` and a `render.yaml` file.

### Render note

The included Render setup now provisions a free Render Postgres database for application data. That removes the old problem where tenant records disappeared because the app was writing to local SQLite on an ephemeral filesystem.

On Render Free:

- the service may spin down when idle
- uploaded files are not durable
- backups written to local disk are not durable

If you want to keep real tenant data, use persistent storage on a paid plan or move the database and file storage to services designed for that.

### One-time data migration

If you already have useful data in a local SQLite file and want to move it into Render Postgres, use:

```bash
npm run migrate:sqlite-to-postgres
```

By default, the migration reads from `data.sqlite`. If your SQLite file lives somewhere else, set `SQLITE_DB_PATH` first.

If the deployed admin page opens but shows no tenant data, that usually means the Render app is connected to Postgres while your existing records are still only in local SQLite.

From your own machine:

1. Copy the Render Postgres external database URL from the Render dashboard.
2. Point `DATABASE_URL` to that external URL.
3. Run the migration against your local SQLite file.

PowerShell example:

```powershell
$env:DATABASE_URL="postgresql://user:password@host:5432/database"
$env:SQLITE_DB_PATH=".\data.sqlite"
npm run migrate:sqlite-to-postgres
```

If you run the migration from inside Render instead, use the internal connection string there. After the migration completes, refresh `/secure-admin`.

## Security and data notes

- Tenant account numbers are stored as hashes, not plain text
- Admin access uses a cookie session
- In production, the admin cookie is marked `Secure`
- Local database backups are encrypted with AES-256-GCM before being written to disk

## Health check

The app exposes:

```text
/api/health
```

If you are deploying behind a platform health check, this is the route to use.

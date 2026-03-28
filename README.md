# Otic Apartments Portal

Otic Apartments Portal is a small Node/Express app for running a tenant portal and a simple admin dashboard from the same codebase.

The tenant side is meant for day-to-day self-service. Tenants can check their balance, view transactions, read notices, submit payment confirmations, raise maintenance issues, access documents, send messages, review lease details, and submit vacating notices.

The admin side is for property operations. Admin users can create tenants, review payment submissions, manage maintenance tickets, send messages, upload shared documents, review move-out notices, apply billing values, and keep an eye on the overall portfolio summary.

It is not trying to be a huge property-management platform. It is closer to a focused internal tool for a small apartment setup.

## What the project uses

- Node.js
- Express
- SQLite with `better-sqlite3`
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
- `npm run check:syntax` - run a basic syntax check
- `npm run validate` - run the project validation script

`npm run reset:data` is destructive, so use it carefully.

## Environment variables

Copy `.env.example` and update it for your environment.

Current variables:

- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `BACKUP_SECRET`
- `DB_PATH`
- `BACKUP_DIR`
- `UPLOAD_DIR`

Important notes:

- In production, the server will refuse to start unless `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `BACKUP_SECRET` are set.
- `DB_PATH` should point to persistent storage if you are deploying this for real use.
- `BACKUP_DIR` should also be persistent.
- `UPLOAD_DIR` should also be persistent so shared files survive restarts and redeploys.

## Deployment notes

This is a stateful Node app. It uses SQLite and also writes files to disk, so it needs a host that supports:

- a long-running web service
- persistent storage
- environment variables
- a single running instance if you keep SQLite as the main database

Good fits:

- a VPS running Node directly
- Docker on a VPS
- a platform like Render with persistent disk support

Poor fits:

- static hosting
- serverless-only setups with ephemeral storage

The repo includes both a `Dockerfile` and a `render.yaml` file.

### Render note

The included Render setup is fine for previewing the app online, but the free tier is not a good long-term home for tenant data.

On Render Free:

- the service may spin down when idle
- local SQLite data is not durable
- uploaded files are not durable
- backups written to local disk are not durable

If you want to keep real tenant data, use persistent storage on a paid plan or move the database and file storage to services designed for that.

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

# Otic Apartments Portal

This project is a tenant portal and admin console built with Express and SQLite.

It includes:
- a tenant-facing portal for payments, messages, alerts, maintenance, notices, leases, documents, and profile updates
- a separate admin login and admin console for tenant management and operations

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

If PowerShell blocks `npm start`, use:

```bash
npm.cmd start
```

Or:

```bash
.\start.cmd
```

3. Open the app:

```text
http://localhost:3000
```

If port `3000` is busy, the server automatically starts on the next free port and prints the correct URL in the terminal.

## Empty by default

The app no longer seeds a demo tenant or demo records.

On a fresh database:
- the tenant portal starts empty
- you log into admin first
- you create real tenant accounts from the admin console

Admin login:

```text
http://localhost:3000/secure-admin/login
```

Admin console:

```text
http://localhost:3000/secure-admin
```

Local development defaults:
- Username: `admin`
- Password: `admin123`

For public deployment, set real values with environment variables before starting the app.

## Reset all data

To wipe the current database records, admin settings, backups, and uploads:

```bash
npm run reset:data
```

This is destructive.

## Production environment variables

Copy `.env.example` and set at least these values for internet deployment:

- `NODE_ENV=production`
- `PORT`
- `APP_BASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `BACKUP_SECRET`
- `DB_PATH`
- `BACKUP_DIR`
- `UPLOAD_DIR`

Notes:
- In production, the server refuses to start unless `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `BACKUP_SECRET` are set.
- `DB_PATH` should point to a persistent disk location.
- `BACKUP_DIR` should also be on persistent storage.
- `UPLOAD_DIR` should also be on persistent storage so shared documents remain available after restarts.

## Internet deployment

This app is a long-running Node server with a writable SQLite database.

That means the host must support:
- a persistent disk or persistent filesystem
- a long-running web service
- environment variables
- one running instance only if SQLite remains the main database

Good fits:
- a VPS running Node directly
- Docker on a VPS
- a PaaS that supports persistent disks, such as Render

Poor fits:
- static-only hosts
- serverless-only hosts with ephemeral storage

## Render deployment

A Render Blueprint file is included at:

```text
render.yaml
```

It currently configures:
- one Node web service on the `free` plan
- temporary local paths for `DB_PATH`, `BACKUP_DIR`, and `UPLOAD_DIR`
- `/api/health` as the health check
- one app instance

Suggested deploy flow:

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Let Render read `render.yaml`.
4. Provide values for `APP_BASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` during setup.
5. After the first deploy, connect your custom domain in Render and update `APP_BASE_URL` to that exact HTTPS URL.

The included blueprint assumes the `frankfurt` region as a reasonable default for East Africa, but you can change that before the first deploy if you prefer another region.

### Important: Render Free limitations

This current free setup is suitable for previewing the live pages on the internet, but not for durable tenant data.

- The service can spin down after idle time.
- Local SQLite data, uploaded files, and generated backups are not durable on Render Free.
- Any restart or redeploy can reset the local database and uploads.
- This means you should treat the free deployment as a public preview or temporary demo environment.

When you upgrade later, move back to a paid Render service with a persistent disk, or migrate to a hosted database and object storage.

## Docker

A production `Dockerfile` is included.

Build:

```bash
docker build -t otic-apartments .
```

Run:

```bash
docker run -p 3000:3000 ^
  -e NODE_ENV=production ^
  -e APP_BASE_URL=https://your-domain.example.com ^
  -e ADMIN_USERNAME=your-admin ^
  -e ADMIN_PASSWORD=your-strong-password ^
  -e BACKUP_SECRET=your-long-random-secret ^
  -e DB_PATH=/data/data.sqlite ^
  -e BACKUP_DIR=/data/backups ^
  -e UPLOAD_DIR=/data/uploads ^
  -v otic_data:/data ^
  otic-apartments
```

## Database files

By default, the app uses:

```text
data.sqlite
```

Related WAL files may also appear:
- `data.sqlite-shm`
- `data.sqlite-wal`

You can override the database location with `DB_PATH`.

## Security notes

- Tenant authentication uses `first_name` plus `account_number`
- Admin authentication uses a cookie-based session
- In production, the admin cookie is marked `Secure`
- Encrypted local backups are written to the configured backup folder

## Health check

The app exposes:

```text
/api/health
```

Use this as the health check path on your hosting platform.

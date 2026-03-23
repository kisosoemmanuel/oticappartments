# Otic Apartments Portal

This project is a tenant portal and admin console built with Express and SQLite.

Current release channel: `0.1.0-beta.1`

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

It configures:
- one Node web service
- one persistent disk mounted at `/opt/render/project/src/storage`
- `DB_PATH`, `BACKUP_DIR`, and `UPLOAD_DIR` on that disk
- `/api/health` as the health check
- one app instance, which is the safe setup while the app uses SQLite

Suggested deploy flow:

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Let Render read `render.yaml`.
4. Provide values for `APP_BASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` during setup.
5. After the first deploy, connect your custom domain in Render and update `APP_BASE_URL` to that exact HTTPS URL.

The included blueprint assumes the `frankfurt` region as a reasonable default for East Africa, but you can change that before the first deploy if you prefer another region.

## Beta release workflow

This project can now be run as a live beta while we continue shipping updates.

- Use `main` as the live beta branch.
- Build changes in feature branches, then open pull requests into `main`.
- GitHub Actions now runs the validation suite automatically for pushes and pull requests.
- Render should deploy from `main` after merges.
- Tag beta versions in Git as `v0.1.0-beta.x`.
- Pushing a `v*` tag creates a GitHub release automatically.

Detailed steps are in:

```text
docs/beta-release.md
```

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

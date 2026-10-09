# OTIC Apartments Admin System

This project is the admin and property-management system for OTIC Apartments. It is designed for property managers and administrators working with the OTIC 1 and OTIC 2 property portfolios. The app is intentionally focused on the admin side only; there is no public tenant portal exposed to the browser.

The application is meant to help a property admin do the following:

- review the portfolio overview
- manage tenant records
- check tenant balances, arrears, and credit
- view finance and payment summaries
- generate a property report using arithmetic calculations
- upload and preview shared property documents
- secure admin access with restricted property-level visibility

## What is included

- Node.js + Express backend
- SQLite database for local work, with Postgres support for deployment
- admin-only authentication and secure sessions
- hashed admin passwords using bcrypt
- OTIC-specific property scopes for super admin and property admins
- simple static frontend with vanilla HTML, CSS, and JavaScript
- file upload support for shared documents
- 404 and 500 error page screens
- environment-based configuration for production secrets

## Security notes

This project is built with the following security controls:

- admin passwords are hashed before storage
- app-level headers are set to reduce common web attacks
- the API is restricted to admin-only routes
- property admins are locked to their assigned property
- secrets and API-related configuration are kept in environment variables, not in source code
- the repository ignores `.env` files and local database files

## User roles

The app supports three admin accounts:

- superadmin / otic12
- adminotic1 / oticruiru
- adminotic2 / oticbondo

Rules:

- Super admin sees the full portfolio and can access both OTIC properties.
- Adminotic1 is restricted to OTIC 1.
- Adminotic2 is restricted to OTIC 2.
- Overview access is reserved for the super admin.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm start
```

3. Open the login page:

```text
http://localhost:3000/secure-admin/login
```

4. Sign in with one of the seeded admin accounts.

## Important files

- [server.js](server.js) — Express server, routes, admin checks, and route guards
- [admin.html](admin.html) — OTIC admin dashboard UI
- [admin-login.html](admin-login.html) — login screen
- [db.js](db.js) — database entry point
- [db-sqlite.js](db-sqlite.js) — local SQLite implementation
- [db-postgres.js](db-postgres.js) — Postgres implementation
- [.env.example](.env.example) — example environment configuration
- [404.html](404.html) — not-found page
- [500.html](500.html) — server error page

## Dashboard behavior

The dashboard includes:

- overview metrics for the selected property or portfolio
- tenant directory with search and status filters
- tenant detail drawer with per-tenant information
- totals for tenants, arrears, credit, and outstanding balances
- shared document upload and preview panel
- generated finance and occupancy report with arithmetic calculations
- notes panels for admin guidance and current operational context
- loading states and error messaging for user feedback

## Reports and arithmetic

The report screen calculates values directly from the current data set, including:

- expected collection
- collected cash
- total arrears
- outstanding balance
- collection rate
- occupancy rate

The values are calculated in code and displayed on the report page so each admin can generate a current report at any time.

## Document upload

Documents can be uploaded from the Documents tab. The app stores the file and exposes the result in the document list. A preview is shown when the file type is supported. If the file type is not previewable, the admin can still open the file via the available link.

## Testing and validation

Run the validation script:

```bash
npm run validate
```

This checks the app lifecycle and validates the main flows, including login, admin session, document upload, and overview access.

## Environment variables

Copy [.env.example](.env.example) and fill in the real values for the environment where you deploy.

Required values normally include:

- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`
- `APP_TIME_ZONE`
- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `BACKUP_SECRET`
- `DB_PATH`
- `BACKUP_DIR`
- `UPLOAD_DIR`

Do not commit real secrets to git. Keep them in a local `.env` file or your deployment secret manager.

## Deployment

This app is designed for a persistent Node environment. For deployment, use a service that supports:

- a long-running web process
- persistent file storage for uploads
- a managed Postgres database if you are not using SQLite locally
- environment variables for credentials and secrets

## Notes

- Use `.env` for secrets and local settings.
- Backups and uploads are stored under the configured directories and should be kept persistent.
- The project currently uses a simple, readable structure with minimal complexity so the admin flow stays easy to follow and maintain.

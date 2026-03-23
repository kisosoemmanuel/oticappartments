# Beta Release Workflow

This app is ready to ship as a live beta while we continue delivering updates.

## Recommended setup

- `main` is the live beta branch.
- Every change goes through a short-lived feature branch.
- GitHub Actions runs validation on pushes and pull requests.
- Pushing a `v*` tag creates a GitHub release automatically.
- Render deploys from `main` after a successful merge.

## Suggested day-to-day flow

1. Create a branch:

```bash
git checkout -b feat/your-change
```

2. Make the change and validate locally:

```bash
npm run validate
```

3. Push the branch and open a pull request into `main`.

4. Wait for the `Validate And Release` GitHub Action to pass.

5. Merge into `main`.

6. Render auto-deploys the new beta build from `main`.

## Versioning

Use beta tags while the product is still stabilizing:

- `v0.1.0-beta.1`
- `v0.1.0-beta.2`
- `v0.1.0-beta.3`

When you are ready for the next beta version:

```bash
npm run version:beta
npm run validate
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release next beta"
git push origin main
git tag v0.1.0-beta.2
git push origin v0.1.0-beta.2
```

The tag push creates the GitHub release automatically.

## Future updates

For normal product updates after beta is live:

1. Branch from `main`.
2. Build the feature or fix.
3. Run `npm run validate` locally.
4. Push the branch and open a pull request.
5. Merge into `main` after validation passes.
6. Let Render deploy the new beta update automatically.

For urgent production fixes:

1. Branch from the latest `main`.
2. Make the hotfix.
3. Run `npm run validate`.
4. Merge back into `main`.
5. Tag a new beta if the change is release-worthy.

## Live update notes

- Keep `DB_PATH`, `BACKUP_DIR`, and `UPLOAD_DIR` on Render's persistent disk.
- Keep the app at one running instance while it uses SQLite.
- Before schema or billing changes, trigger a backup and note the release version.
- Prefer small frequent updates instead of large batch releases.
- Keep a short note in `CHANGELOG.md` for every beta tag.

## Before each beta deploy

- Confirm the repo is clean.
- Run `npm run validate`.
- Review any database-impacting changes.
- Confirm the Render environment variables are still correct.
- Merge to `main`.
- Push a new `v*` tag if you want a formal beta release entry.

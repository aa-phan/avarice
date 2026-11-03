---
last_mapped_commit: 41879bed6e93c1c65cce57e3120db26dae739e5c
last_mapped_at: 2026-11-02
---
# External Integrations

**Analysis Date:** 2026-11-02

## APIs & External Services

**Not detected.** No SDK imports, HTTP clients, or API endpoints were found in `src/` or `test/`. `package.json` declares no dependencies.

## Data Storage

**Databases:**
- Not detected. No database driver, ORM, connection string, or schema files.

**File Storage:**
- Local filesystem only (no file-handling code in tracked sources).

**Caching:**
- None.

## Authentication & Identity

**Auth Provider:**
- Not detected. No auth library, token handling, or session middleware. The `sessions` feature (`src/features/sessions/`) contains only a typed handler stub and no auth logic.

## Monitoring & Observability

**Error Tracking:**
- None.

**Logs:**
- No logging framework; no logging calls found in tracked sources.

## CI/CD & Deployment

**Hosting:**
- Not detected. No deployment configuration, Dockerfile, or platform manifest.

**CI Pipeline:**
- GitHub Actions - `.github/workflows/ci.yml`
  - Trigger: `on: [push]`
  - Runner: `ubuntu-latest`
  - Steps: `actions/checkout@v4`, then `npm test`
  - Known issue: `package.json` has no `test` script, so `npm test` will fail.

## Environment Configuration

**Required env vars:**
- None referenced by tracked source or CI config.

**Secrets location:**
- Not applicable. `.env` is git-ignored (`.gitignore`); its contents were not read and no secrets were found in tracked files.

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

---

*Integration audit: 2026-11-02*

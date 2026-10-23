# Accounts and guest columns

The site opens in guest mode. Login is a separate sidebar action. The first admin is `vuductho.th@gmail.com`; this admin creates Staff usernames, resets their passwords, and locks/unlocks accounts. Staff see full data but cannot manage accounts or guest policy. No public signup or automatic admin assignment exists.

Accounts, hashed passwords, session hashes, guest policy, and account audit events live in Cloudflare D1 (`componetlife-db`). Passwords use native scrypt N=16384, r=8, p=5 with a unique salt; plaintext passwords are never stored. Sessions expire after 8 hours, use a Secure/HttpOnly/SameSite cookie, and are revoked on password resets or account locks. Login attempts are throttled in D1. Back up D1 independently from Excel sources.

## First setup

Run `./Initialize-ComponentLifeAccounts.ps1` in PowerShell. Enter the admin password twice in the masked prompt (minimum 10 characters). This applies migrations to D1, inserts the admin only if absent, configures a read-only publish verification secret on Cloudflare, and saves a private verifier file outside public assets. It does **not** deploy the new application code. Existing admins are never silently reset. A previously existing admin must use their existing password.

Then Publish from Inspection Tool. Publish refuses to deploy the new account-enabled Worker before setup is complete. Do not remove the Worker or `run_worker_first` binding: these enforce data permissions, including direct static JSON/download URLs. Cloudflare preview deployments using production D1 must have the same secrets and policy enforcement.

## Guest policy

Admin opens `+` on either Inspection table, or Account → Cột hiển thị cho khách. Changes persist to D1 with conflict detection; guests receive them on next page load. Guest access is restricted to Inspection and IQC. Hidden fields are removed from server responses, not merely hidden with CSS. Raw business data and Excel sources are denied to guests by default. Guest Excel download/export can only be enabled when every record/detail column is visible, since source files contain all fields. PDF access is separately configurable. No NG value is rewritten to OK.

Local development with authentication uses `npx wrangler dev --local` and a **local** D1 migration/fixture admin. The old PowerShell static server cannot authenticate D1 accounts; it falls back to restricted guest UI. Never add a localhost admin bypass. Do not commit `.cloud-publish`, `.wrangler`, SQL containing account hashes, or verifier tokens.

Publish verification uses its private bearer only on the exact configured HTTPS origin. Same-origin redirects (including `index.html` → `/`) are followed with a bounded hop count; cross-origin redirects are rejected before credentials can be forwarded. Temporary 404/network failures are retried per file with bounded backoff, while hashes still must match. It cannot call admin APIs. No passwords, salts, session tokens, or verification secret are part of the public asset allowlist.

Missing-result diagnostics remain in the desktop Inspection Tool. Publish only counts nonblank Actual measurements; numeric zero, real NG results, and invalid nonblank values are retained. All-blank reports remain pending, and original Excel files are not modified by this filter.

## Validation

`node --test tests/accounts.test.cjs tests/verify-cloud.test.cjs` runs account/policy/authorization checks in local workerd with D1, plus credential-scoped publish verification. `tests/publish.test.cjs` covers deployment failures and asset hashes. `tests/inspection-publish-missing.tests.ps1` checks the desktop-only missing-result boundary. Rendered QA used bundled Playwright with Edge because Browser plugin was not available: guest entry, separate login, admin column persistence, username creation, logout, Staff restrictions, mobile and dark mode; no JavaScript runtime errors were observed. Live login still requires the user to Publish this code; creating the D1 admin does not update the web UI.

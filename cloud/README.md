# Accounts and guest columns

The site opens in guest mode. Login is a separate sidebar action. The first admin is `vuductho.th@gmail.com`; this admin creates Staff usernames, resets passwords, locks/unlocks accounts, and permanently deletes Staff accounts. Only admins grant or revoke tabs and configure each account's allowed inspection fields. Staff can use the features in their assigned tabs, including the Inspection `+` picker, within their granted data permissions. No public signup or automatic admin assignment exists.

Accounts, hashed passwords, session hashes, guest policy, and account audit events live in Cloudflare D1 (`componetlife-db`). Passwords use native scrypt N=16384, r=8, p=5 with a unique salt; plaintext passwords are never stored. Sessions expire after 8 hours, use a Secure/HttpOnly/SameSite cookie, and are revoked on password resets or account locks. Login attempts are throttled in D1. Back up D1 independently from Excel sources.

## First setup

Run `./Initialize-ComponentLifeAccounts.ps1` in PowerShell. Enter the admin password twice in the masked prompt (minimum 10 characters). This applies migrations to D1, inserts the admin only if absent, configures a read-only publish verification secret on Cloudflare, and saves a private verifier file outside public assets. It does **not** deploy the new application code. Existing admins are never silently reset. A previously existing admin must use their existing password.

Then Publish from Inspection Tool. Publish refuses to deploy the new account-enabled Worker before setup is complete. Do not remove the Worker or `run_worker_first` binding: these enforce data permissions, including direct static JSON/download URLs. Cloudflare preview deployments using production D1 must have the same secrets and policy enforcement.

## Guest policy

Admin opens Account → Cột hiển thị cho khách, or `+` → Thiết lập cho khách. Changes persist to D1 with conflict detection; guests receive them on next page load. Guest access is restricted to Inspection and IQC. Hidden fields are removed from server responses, not merely hidden with CSS. Raw business data and Excel sources are denied to guests by default. Guest Excel download/export can only be enabled when every record/detail column is visible, since source files contain all fields. PDF access is separately configurable. No NG value is rewritten to OK.

## Account permissions

Apply migration `0002_permissions.sql` before publishing the account permissions upgrade. It adds a separate D1 table, preserving the existing account schema. Admin → Quản lý tài khoản → Phân quyền selects tabs and the inspection field/download policy for one username. The editor can copy the guest field configuration. Policies use version checks to prevent overwriting concurrent changes. Existing accounts without a stored policy retain their prior full access until the admin configures them. New API-created users without explicit tab grants receive no tabs; the creation form explicitly offers Inspection and IQC as initial selections.

Tab permissions are enforced on the server: Inspection JSON and downloads require the Inspection tab; standalone IQC resources require IQC access; shared dashboard datasets require at least one dashboard tab. The dashboard tabs share their underlying datasets. An account with no tabs can sign in, change its password or log out, and sees an access notice. Staff cannot call account-management or permission-write APIs. Admin accounts cannot be deleted through the UI/API.

Inspection `+` lets authenticated users show/hide only fields permitted by admin. Personal visibility choices stay in the browser and never expand server permissions. They reset to the admin default when the account policy version changes. Admin access grants, field limits, and guest defaults remain in D1. Excel sources contain full measurements, so source download/export requires the complete field grant; hiding fields through personal preferences does not remove an existing grant.

Permanent deletion requires typing the exact username. The user row, password hash, access policy and all sessions are deleted together, invalidating logged-in clients. Audit events retain actor/target IDs and action names, without password material. Recreating the same username generates a new account ID and cannot revive old sessions or grants.

Local development with authentication uses `npx wrangler dev --local` and a **local** D1 migration/fixture admin. The old PowerShell static server cannot authenticate D1 accounts; it falls back to restricted guest UI. Never add a localhost admin bypass. Do not commit `.cloud-publish`, `.wrangler`, SQL containing account hashes, or verifier tokens.

Publish verification uses its private bearer only on the exact configured HTTPS origin. Same-origin redirects (including `index.html` → `/`) are followed with a bounded hop count; cross-origin redirects are rejected before credentials can be forwarded. Temporary 404/network failures are retried per file with bounded backoff, while hashes still must match. It cannot call admin APIs. No passwords, salts, session tokens, or verification secret are part of the public asset allowlist.

Missing-result diagnostics remain in the desktop Inspection Tool. Publish only counts nonblank Actual measurements; numeric zero, real NG results, and invalid nonblank values are retained. All-blank reports remain pending, and original Excel files are not modified by this filter.

## Validation

`node --test tests/accounts.test.cjs tests/verify-cloud.test.cjs` runs account/policy/authorization checks in local workerd with D1, plus credential-scoped publish verification. `tests/publish.test.cjs` covers deployment failures and asset hashes. `tests/inspection-publish-missing.tests.ps1` checks the desktop-only missing-result boundary. Rendered QA used bundled Playwright with Edge because Browser plugin was not available: guest entry, separate login, admin column persistence, username creation, logout, Staff restrictions, mobile and dark mode; no JavaScript runtime errors were observed. Live login still requires the user to Publish this code; creating the D1 admin does not update the web UI.

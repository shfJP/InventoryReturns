# Manager Equipment Collection Portal

Lightweight manager-facing web UI to view equipment assigned to direct/indirect reports, mark items as collected, and track collection events with IT notifications and close-out.

---

## Handoff documentation

If you're onboarding to this codebase or handing off to a client, start here:

| Document | Purpose |
|----------|---------|
| **[DELIVERABLE_Software_Description_and_Integrations.md](./DELIVERABLE_Software_Description_and_Integrations.md)** | Full deliverable description: how the software maps to the original project outline, all integrations (database, ref tab, AD/Entra, notifications, auth), data model, deployment, and suggested next steps. Use this as the main handoff reference. |
| **[API_CONNECTIONS.md](./API_CONNECTIONS.md)** | Condensed reference for every external connection: env vars, Reftab HMAC + `/assets` contract, notifications, and auth. |
| **[.env.example](./.env.example)** | Template for all environment variables. Copy to `.env` and fill in values for local or deployed environments. |

The deliverable document also describes capabilities outside the web UI (APIs, data, and integration points) for integration or future clients.

---

## Is it ready to run? (API, Coolify, Docker)

**API & app:** Yes. The Next.js app and all API routes (`/api/me`, `/api/staff`, `/api/equipment`, `/api/collect`, `/api/collection`, `/api/closeout`) are implemented and run as soon as the app starts.

**Coolify / Nixpacks:** Yes. The repo includes `nixpacks.toml`; Coolify can build with Nixpacks (or use the Dockerfile). Build runs `npm ci`, `prisma generate`, `npm run build`; start runs `sh start.sh`, which pushes the Prisma schema and starts the background sync worker. Set all env vars from `.env.example` in Coolify.

**Docker:** Yes. The `Dockerfile` builds a standalone image and runs `sh start.sh`. Use **PostgreSQL** (`DATABASE_URL=postgresql://...`). The startup script runs `prisma db push` when the DB is available.

### Coolify / production: env vars for pilot auth and “Mark collected”

Server-side routes (`/api/collect`, `/api/staff`, `/api/equipment`, etc.) resolve the current manager from environment variables, **not** from the browser login screen. If these don’t match rows in your `User` table, the API returns 401/403/404 and the staff page will show an error banner after you click **Mark collected**.

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Must point to a DB where `prisma db push` (and ideally seed or your AD sync) has run so `User` rows exist. |
| `MANAGER_EMPLOYEE_IDS` | Yes (pilot) | Comma-separated employee IDs allowed as managers (e.g. `EMP001,EMP002`). Each ID should exist in `User.employeeId`. |
| `CURRENT_USER_EMPLOYEE_ID` | No | If set, that user is the “logged in” manager for all API calls. Must be one of `MANAGER_EMPLOYEE_IDS` and must exist in the DB. If unset, the **first** value in `MANAGER_EMPLOYEE_IDS` is used. |

**Checklist:** In Coolify, set `MANAGER_EMPLOYEE_IDS` (and optionally `CURRENT_USER_EMPLOYEE_ID`) to IDs that actually exist in your deployed database. Default seed uses `EMP001`–`EMP025`; production AD sync should use your real IDs.

---

## With env files set — what can it do?

Once you set env vars (from `.env.example`) and run the app with a migrated (and optionally seeded) database:

| What you configure | What works |
|--------------------|------------|
| **Minimum:** `DATABASE_URL` + `MANAGER_EMPLOYEE_IDS` (and you’ve run `prisma db push` + `db:seed`) | App runs. Manager can log in (pilot: first manager in list or `CURRENT_USER_EMPLOYEE_ID`). Staff list (from DB), equipment from **seed/cache only**, mark collected, collection log, close-out. **No** IT notifications (call fails quietly); **no** live ref tab. |
| **+ Reftab:** `REF_TAB_API_URL` (default `https://www.reftab.com/api`), `REF_TAB_API_PUBLIC_KEY`, `REF_TAB_API_SECRET_KEY` | Everything above, plus equipment is **merged from Reftab** via `GET /assets` (HMAC auth). Optional field mapping env vars — see [API_CONNECTIONS.md](./API_CONNECTIONS.md). If Reftab is not configured or returns nothing, cached/seed equipment still shows. |
| **+ Notifications:** `NOTIFICATION_PROVIDER` + one of `WEBHOOK_URL` / `TEAMS_WEBHOOK_URL` / SMTP vars | When a manager marks an item collected, **IT is notified** (webhook POST, Teams message, or email). Collection event is still stored even if the notification fails. |
| **+ `APP_BASE_URL`** | Links in notifications point to this URL (e.g. collection page). |
| **+ `CURRENT_USER_EMPLOYEE_ID`** (pilot) | Override which manager is “logged in” for testing (must be in `MANAGER_EMPLOYEE_IDS`). |

**Summary:** With **only** database + manager list + seed data, the app already does: manager dashboard (staff + equipment from DB), staff detail, mark collected, collection history, and close-out. Adding **Reftab** public/secret keys (see [Reftab API docs](https://www.reftab.com/api-docs)) turns on live equipment from **`GET /assets`**; adding notification env vars turns on IT alerts. No code changes required—just env and one-time DB setup.

---

## Quick start

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL to PostgreSQL
npm install
npx prisma db push
npm run db:seed
npm run dev
```

If `npm install` fails with ENOTEMPTY, remove `node_modules` and run `npm install` again.

Open http://localhost:3000. Pilot auth uses `CURRENT_USER_EMPLOYEE_ID` (or first entry in `MANAGER_EMPLOYEE_IDS`). Seed creates manager `EMP001` (Alice) with reports EMP003–EMP005 and sample equipment.

---

## API connections required

### 1) **Database**

- **What:** PostgreSQL.
- **Env:** `DATABASE_URL`
  - Example: `postgresql://user:pass@host:5432/dbname?schema=public`
- **Usage:** Users (AD/Entra sync), equipment cache, collection events. No external API; app owns the DB.

---

### 2) **Reftab API (equipment source)**

- **What:** [Reftab](https://www.reftab.com/api-docs) asset management API. Create keys under **Settings → API Keys**.
- **Auth:** **Public + secret key pair** with **HMAC-SHA256** (`Authorization: RT {public}:{token}`, header `x-rt-date`). Matches Reftab’s [Postman](https://www.reftab.com/faq/postman-reftab-api) instructions and [ReftabNode](https://github.com/Reftab/ReftabNode).
- **How the portal uses it:** `GET {REF_TAB_API_URL}/assets?limit=…` (Reftab Cloud default base `https://www.reftab.com/api`), then keeps assets whose assignee field matches each report’s `User.employeeId`.
- **Env:** `REF_TAB_API_PUBLIC_KEY`, `REF_TAB_API_SECRET_KEY`, optional URL, limits, and field mapping — see [API_CONNECTIONS.md](./API_CONNECTIONS.md).
- **Legacy:** If only `REF_TAB_API_KEY` is set, the app calls a **custom** Bearer `/assignments?employee_id=` gateway (not the live Reftab cloud API).
- **Usage:** Merged with DB-cached equipment in the manager UI. If Reftab keys are unset, only DB cache is used (e.g. seed data).

---

### 3) **Active Directory / Entra (manager hierarchy)**

- **What:** Source of users and manager chain (who reports to whom).
- **How (today):** No live AD/Entra API is called by the app. Users and manager links are stored in the app DB and must be **synced from AD/Entra** (e.g. scheduled job or script that writes to the `User` table).
- **Required fields to sync:**  
  `employee_id` (or UPN/samAccountName as stable id), `display_name`, `email`, `manager` (reference to another user’s `employee_id`). Set `is_manager` if they have direct reports.
- **Pilot:** Seed script fills sample users; for production you need a sync process that updates `User` (and optionally `last_synced_at`) from your directory.

---

### 4) **IT notifications (when an item is marked collected)**

Exactly one channel is used, driven by `NOTIFICATION_PROVIDER` and the corresponding env vars.

| Provider   | Env vars | Purpose |
|-----------|----------|--------|
| **webhook** | `WEBHOOK_URL` | POST JSON to URL (e.g. n8n, Zapier). Default if set. |
| **teams**   | `TEAMS_WEBHOOK_URL` | Microsoft Teams incoming webhook. |
| **email**   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATION_EMAIL_TO` | SMTP (e.g. O365) to notify IT. |

- **Payload (webhook):**  
  `event`, `assetTag`, `serial`, `employeeId`, `employeeName`, `markedByManagerId`, `markedByManagerName`, `notes`, `markedAt`, `eventId`, `message`, `link` (portal collection page).
- **Usage:** Called automatically when a manager marks an item as collected.

---

### 5) **Authentication (pilot vs production)**

- **Pilot:** No SSO. Current user is determined by:
  - `CURRENT_USER_EMPLOYEE_ID` if set, else
  - First value in `MANAGER_EMPLOYEE_IDS`.
  Only users in `MANAGER_EMPLOYEE_IDS` are treated as managers. No external auth API.
- **Production:** Replace this with your org SSO (e.g. Entra/OIDC). After login, set the app’s “current user” from the token (e.g. `oid` or `email` mapped to `User.employeeId` / UPN). No new “API” beyond your existing IdP.

---

## Summary table

| Connection        | Type        | Required for pilot? | Env / config |
|------------------|-------------|----------------------|--------------|
| Database         | Internal DB | Yes                  | `DATABASE_URL` |
| Reftab           | HTTP API    | No (use seed data)   | `REF_TAB_API_URL`, `REF_TAB_API_PUBLIC_KEY`, `REF_TAB_API_SECRET_KEY` (+ optional field envs) |
| AD/Entra         | Sync → DB   | No (use seed)        | Your sync job + `User` table |
| IT notification  | Webhook/Teams/Email | Yes (to alert IT) | `NOTIFICATION_PROVIDER` + `WEBHOOK_URL` or `TEAMS_WEBHOOK_URL` or SMTP vars |
| Auth             | Env / later SSO | Yes (env)        | `CURRENT_USER_EMPLOYEE_ID`, `MANAGER_EMPLOYEE_IDS` |

---

## Deployment (Coolify / Nixpacks)

- **Build:** Nixpacks (or Docker) uses `npm ci`, `prisma generate`, `npm run build`. The build does **not** need an existing database.
- **Start:** The startup script (`start.sh`) **automatically** runs `prisma db push` (creates/syncs tables) and seeds pilot data (if the User table is empty) before starting Next.js. No manual DB setup is needed.
- **Env:** Set all variables from `.env.example` in Coolify (or your platform). For production, set `DATABASE_URL` to a Postgres URL.
- **Database:** Set `DATABASE_URL` to the internal PostgreSQL connection string from Coolify. This deployment no longer defaults to SQLite.

---

## Scripts

- `npm run dev` – dev server
- `npm run build` – Prisma generate + Next build
- `npm run db:push` – push schema (no migrations)
- `npm run db:seed` – seed users + equipment
- `npm run db:studio` – Prisma Studio

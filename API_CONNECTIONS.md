# API Connections Required

After deployment, wire these via **environment variables** (see `.env.example`).

---

## 1. Database

| Env | Description |
|-----|-------------|
| `DATABASE_URL` | Target PostgreSQL owned by this app, for example `postgresql://user:pass@host:5432/dbname?schema=public`. |

The app uses this DB for the replicated directory snapshot, users, equipment cache, and collection logs.

---

## 2. Reftab API (equipment source)

Official docs: [Reftab API documentation](https://www.reftab.com/api-docs).  
Authentication and signing: [How to use Postman with Reftab’s API](https://www.reftab.com/faq/postman-reftab-api) (same HMAC scheme this app uses).  
Example Node client from Reftab: [ReftabNode on GitHub](https://github.com/Reftab/ReftabNode).

### How this app integrates

Reftab does **not** use a simple Bearer token on `/assignments`. It uses **public + secret API keys** and **HMAC-SHA256** signing on each request (`Authorization: RT {publicKey}:{signature}`, plus `x-rt-date`). The portal:

1. Calls **`GET {REF_TAB_API_URL}/assets?limit={N}`** once per equipment load (for the manager’s report scope).
2. Parses the JSON array of assets and keeps rows where the assignee field matches a report’s `User.employeeId` (case-insensitive for strings).
3. Maps each row to your internal equipment shape (`asset_tag`, `serial`, `model`, `assigned_to_employee_id`).

If **both** `REF_TAB_API_PUBLIC_KEY` and `REF_TAB_API_SECRET_KEY` are set, this native Reftab flow runs. If **only** `REF_TAB_API_KEY` is set (legacy), the app instead calls a **custom proxy** shape: `GET …/assignments?employee_id=` with `Authorization: Bearer …` (not the live Reftab cloud API).

### Environment variables

| Env | Description |
|-----|-------------|
| `REF_TAB_API_URL` | API base URL. Reftab Cloud default: `https://www.reftab.com/api` (no trailing slash required). |
| `REF_TAB_API_PUBLIC_KEY` | Public key from Reftab **Settings → API Keys → Create API Key**. |
| `REF_TAB_API_SECRET_KEY` | Secret key for the same key pair. |
| `REF_TAB_ASSETS_LIMIT` | Optional. Default `500`. Max assets returned per request (`?limit=`). Raise if you have more assets; if you exceed Reftab’s max per call, add pagination later (see Reftab docs). |
| `REF_TAB_ASSIGNEE_FIELD` | Optional. Default `loanee`. Dot-path to the field on each asset that should match **this app’s `User.employeeId`** (e.g. `loanee`, `loanee.email`). Tenant-specific — confirm from a sample `GET /assets` response in [api-docs](https://www.reftab.com/api-docs) or Postman. |
| `REF_TAB_ASSET_TAG_FIELD` | Optional. Default `id` (Reftab’s asset id, e.g. tag). |
| `REF_TAB_SERIAL_FIELD` | Optional. Default `serial`. |
| `REF_TAB_MODEL_FIELD` | Optional. Default `title`. |
| `REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD` | Optional. Default `Service Tag`. Category custom field name sent in `details` when creating an asset from NinjaOne. Uses the trimmed serial number, falling back to the asset tag when the serial is blank or missing. Set empty to omit it for categories without this field. |
| `REF_TAB_CREATE_ASSET_EXPRESS_CODE_FIELD` | Optional. Default `Express Code`. Category custom field name sent in `details` for Dell Express Service Codes. Calculated by converting a 5- or 7-character alphanumeric service tag from base 36 to decimal. Other serial formats are omitted. Set empty to disable this calculation for non-Dell inventory. |
| `REF_TAB_API_KEY` | **Legacy only.** Bearer auth for a **custom** gateway; not used when public/secret keys are set. |

Reftab asset creation accepts category custom fields in the `details` object,
keyed by their field names. For example, laptop `FRXN7Y2` is sent with
`"details": { "Service Tag": "FRXN7Y2", "Express Code": "34340832506" }`.
The asset barcode is sent as `aid` and the selected category as numeric `cid`.
Creation must return the requested asset ID before the app attempts a loan.
The same trimmed serial (or asset tag fallback) supplies both values. Express
Code calculation assumes matching 5- or 7-character identifiers are Dell service
tags; it does not confirm the manufacturer. The selected category must include
each field; Reftab ignores custom fields that do not belong to the category.

### Identity alignment

The value read from `REF_TAB_ASSIGNEE_FIELD` (e.g. email, employee number, or object resolved to `email` / `id`) must match how you populate **`User.employeeId`** in the portal (from AD/Entra sync). If Reftab stores email and your directory uses employee numbers, either sync the same canonical id into both systems or point `REF_TAB_ASSIGNEE_FIELD` at a field that matches your `User.employeeId`.

If Reftab env vars are not set (or keys missing), the app uses only **DB-cached** equipment (e.g. seed data).

---

## 3. Employee directory PostgreSQL

When `DIRECTORY_DATABASE_URL` is set, the lifecycle database is the authoritative source for employee activity and manager hierarchy. Microsoft Graph is used as the sync fallback only when this URL is absent; Entra SSO is independent and can remain enabled.

| Env | Default | Description |
|-----|---------|-------------|
| `DIRECTORY_DATABASE_URL` | empty | PostgreSQL connection URL for a **read-only** lifecycle database account. Treat it as a secret. |
| `DIRECTORY_DATABASE_SCHEMA` | `paycom` | Source schema. Must be a simple PostgreSQL identifier. |
| `DIRECTORY_EMPLOYEE_STATE_TABLE` | `paycom_employee_state` | Source table. Must be a simple PostgreSQL identifier. |
| `DIRECTORY_SOURCE_NAME` | `paycom` | Source marker written onto target `User` rows. |
| `DIRECTORY_DIVISION_COLUMN` | `division_desc` | Source column copied into `DirectoryEmployeeState.division` and `User.division`. Set to an empty value to disable it for a custom source. Must be a simple identifier. |
| `DIRECTORY_DEPARTMENT_COLUMN` | `department_desc` | Source column copied into `DirectoryEmployeeState.department` and `User.department`. Set to an empty value to disable it for a custom source. Must be a simple identifier. |
| `DIRECTORY_SUBDIVISION_COLUMN` | `sub_division_desc` | Source column copied into `DirectoryEmployeeState.subdivision` and `User.subdivision`. Set to an empty value to disable it for a custom source. Must be a simple identifier. |
| `DIRECTORY_SYNC_MIN_ROWS` | `100` | Safety floor. A smaller canonical result aborts before stale target rows are deleted. Set this near the expected lower bound in production. |
| `DIRECTORY_SYNC_BATCH_SIZE` | `500` | Target upsert batch size, clamped to 50–1000. |
| `DIRECTORY_SYNC_INTERVAL_MINUTES` | `720` | Scheduled directory interval. When explicitly set, this overrides an older value saved in Settings. |
| `DIRECTORY_SYNC_SCHEDULE_ENABLED` | `false` | Set `true` to keep the database-backed directory schedule running independently of the shared cron toggle. |

The source query uses:

- `source_person_key`
- `employee_code`
- `employee_name`
- `work_email`
- `supervisor_primary_code`
- `employee_status`
- `state_status`
- `termination_date`
- `last_paycom_sync_at`

The standard Paycom organization columns are selected by default. The sync
excludes `MERGED_DUPLICATE`, selects one canonical row per trimmed employee
code, and treats the newest `last_paycom_sync_at` observation as authoritative.
Lifecycle state and source key are deterministic tie-breakers when timestamps
match. The target sync refreshes `DirectoryEmployeeState`, upserts `User`,
rebuilds manager relationships, marks stale directory users inactive, and
creates unresolved equipment-collection records when an employee transitions
inactive. Entra SSO identity lookup is case-insensitive across employee ID, UPN,
and email and prefers the active, recently synced directory row, which bridges
legacy UPN-based users to lifecycle employee codes. If the database source is
configured but the target snapshot is empty, the worker performs one bootstrap
sync at container startup even when normal startup sync is disabled.

Recommended source grants:

```sql
GRANT CONNECT ON DATABASE lifecycle TO inventory_returns_directory_ro;
GRANT USAGE ON SCHEMA paycom TO inventory_returns_directory_ro;
GRANT SELECT ON TABLE paycom.paycom_employee_state TO inventory_returns_directory_ro;
```

Do not grant target-table write permissions or use the lifecycle database owner credential in the application.

---

## 4. IT notifications (on “mark collected”)

Set **one** of the following.

| Provider | Env vars |
|----------|----------|
| **webhook** | `NOTIFICATION_PROVIDER=webhook`, `WEBHOOK_URL=https://...` |
| **Teams** | `NOTIFICATION_PROVIDER=teams`, `TEAMS_WEBHOOK_URL=https://...` |
| **email** | `NOTIFICATION_PROVIDER=email`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATION_EMAIL_TO` |

Optional: `APP_BASE_URL` for links in notifications.

---

### Delivery tracking and retry

Every collection event records the notification state (`PENDING`, `SENT`, or
`FAILED`), the email message ID/provider reference when available, and a bounded
error message. A failed alert does not roll back collection. IT/admin users can
retry it from the collection log through
`POST /api/collection/retry-notification`.

---

## 5. NinjaOne (device/owner evidence)

| Env | Default | Description |
|-----|---------|-------------|
| `NINJAONE_BASE_URL` | `https://app.ninjarmm.com` | NinjaOne tenant/API base. |
| `NINJAONE_CLIENT_ID` | empty | API Services OAuth client ID. |
| `NINJAONE_CLIENT_SECRET` | empty | API Services OAuth client secret. |
| `NINJAONE_SCOPE` | `monitoring` | OAuth scopes. Optional NinjaOne decommissioning requires `monitoring management` and Management authorized on the OAuth client. |
| `NINJAONE_PAGE_SIZE` | `500` | Device list page size. |
| `NINJAONE_ENRICH_DEVICE_DETAILS` | `true` | Fetch details/custom fields/last-user evidence. |
| `NINJAONE_ENRICH_CONCURRENCY` | `5` | Concurrency for detail enrichment. |
| `OWNER_RECONCILIATION_CACHE_MINUTES` | `240` | Cache lifetime for the expensive Reftab/NinjaOne comparison. |
| `RECONCILIATION_DEFER_HOURS` | `24` | Time before a deferred review returns to the queue. |

The reconciliation page displays device identity matching separately from owner
support. Owner support uses distinct timestamped sessions observed through
`GET /api/v2/device/{id}/last-logged-on-user` during syncs. Repeated snapshots
of the same user and `logonTime` do not add logins. This is an observed sample:
sessions between syncs can be missed, and historical OS logins are not fetched
from NinjaOne's activity stream. Existing cached snapshots can supply one
baseline session; history grows after deploying the schema and running sync.
Keep `NINJAONE_ENRICH_DEVICE_DETAILS=true` to collect evidence.

The rolling 30-day signal includes login count, share of all observed sessions,
distinct UTC login days, last login, competing users, collection start, and last
successful check. Unknown, ambiguous, and machine-local accounts stay in the
denominator without being attributed to a directory user. Strong support
requires at least 5 proposed-owner sessions across 3 days, at least 80% share,
and a login within 7 days. Moderate support requires 3 sessions across 2 days,
60% share, and a login within 7 days. Competing usage or a proposed owner absent
for over 7 days weakens the signal once 3 sessions exist. Checks older than
48 hours are stale. Signals are review heuristics, not ownership probabilities.
Raw session observations are retained for 90 days; deleted devices cascade their
observations. Audit evidence snapshots are retained with their review records.

Yes/No/Unsure/Defer remains a human decision. No/Unsure creates a correction
request. Yes performs the configured Reftab owner change. The same page has a
searchable, paginated audit table of ownership changes, asset creation, and review
decisions, restricted to reconciliation users. Each entry records the actor,
previous/proposed owners, outcome, notes, and the evidence used in mismatch
reviews. Attempts are saved before Reftab calls; partial writes, timeouts, or a
local save failure after a successful external write are flagged for review.

### Decommissioning inactive hardware

On `/admin/owner-reconciliation`, equipment missing from Reftab has a
**Decommission** option when NinjaOne explicitly reports it offline and its
actual `lastContact` is more than one calendar year old. An unknown last-contact
date, an online device, or activity within the last year prevents the action.
`lastUpdate` is not used as proof of device inactivity. Owner resolution is not
required for decommissioning. The server rechecks the live device before creation.

Choose a category. Reftab must already contain one accessible status label named
**Decommissioned**. The app checks `GET /assets/{aid}` for absence, creates an
unassigned asset using `aid`, `cid`, `statid`, and `notes`, and reads it back to
verify the identity, status, and complete notes. The actual **Asset Notes**
include the UTC date/time, authenticated reviewer's name, employee ID and email,
last contact, workflow reference, and exact reason:
`This device has not been online in over 1 year`. Required Service Tag and
applicable Dell Express Code custom fields use the same mapping as ordinary
asset creation. Existing Reftab assets are never overwritten by this flow.

After creation, the dialog links to Reftab and requires the reviewer to visually
confirm the correct device, status label, and Asset Notes. The reviewer can keep
it in NinjaOne, review later, or request NinjaOne decommissioning. Removal
rechecks Reftab, live inactivity, and the saved NinjaOne UID, then calls
`POST /api/v2/device/{id}/decommission`. Enable the OAuth client's Management
scope and set `NINJAONE_SCOPE="monitoring management"` to make that option
available. NinjaOne decommissioning removes active management; a record may
remain in its decommissioned view.

`HardwareDecommission` retains the actor, asset, notes, confirmation and removal
states independently of synced assignments and devices. The saved, paginated
review table survives refreshes; these records keep unassigned decommissioned
assets out of the missing-equipment queue. Attempts and outcomes also appear in
the reconciliation audit log. Unique reservations and atomic claims prevent
duplicate submissions. A timeout or partial write requires **Check status**
instead of automatically repeating a write. Status checks can recover verified
Reftab creation or a live NinjaOne `DECOMMISSIONED` result. A missing/forbidden
read cannot be interpreted as successful removal.
An interrupted request remains pending and must be checked before retrying.

Deployment requires the new `ReconciliationAudit` and `NinjaOneLoginObservation`
tables and device coverage fields (`prisma db push`, already run by `start.sh`).
Startup also runs `scripts/backfill-reconciliation-audit.ts`, an idempotent import
of existing review decisions labeled historical. Earlier asset creations or
failed requests without stored decisions cannot be reconstructed.

---

## 6. Snowflake organization snapshot

| Env | Default | Description |
|-----|---------|-------------|
| `SNOWFLAKE_SYNC_ENABLED` | `false` | Enables independent startup and interval publishing. |
| `SNOWFLAKE_SYNC_INTERVAL_MINUTES` | `720` | Publish interval (minimum 60 minutes). |
| `SNOWFLAKE_ACCOUNT` | empty | Snowflake account identifier. |
| `SNOWFLAKE_USERNAME` | empty | Service-account username. |
| `SNOWFLAKE_PASSWORD` | empty | Service-account password. |
| `SNOWFLAKE_WAREHOUSE` | empty | Warehouse used by the sync. |
| `SNOWFLAKE_DATABASE` | empty | Target database. |
| `SNOWFLAKE_SCHEMA` | empty | Target schema. |
| `SNOWFLAKE_ROLE` | empty | Optional execution role. |
| `SNOWFLAKE_INVENTORY_TABLE` | `INVENTORY_ORGANIZATION_SNAPSHOT` | Target table name. |

The worker creates the snapshot table if needed, replaces rows whose source is
`inventory-returns`, and writes subdivision-level employee, asset, purchase,
replacement, and book-value totals in one transaction. The manual admin sync is
`POST /api/admin/sync-snowflake`. Use a least-privilege service role with usage
on the warehouse/database/schema and create/delete/insert access on only the
target table/schema as appropriate.

`SNOWFLAKE_SYNC_ENABLED` is independent of `AUTO_SYNC_ON_STARTUP` and
`SYNC_CRON_ENABLED`. A real Snowflake account is required to validate network,
role, warehouse, and bulk-bind behavior.

---

## 7. Auth, roles, and pilot access

| Env | Description |
|-----|-------------|
| `MANAGER_EMPLOYEE_IDS` | Comma-separated pilot identities. The first ID is the login fallback; manager/report scope still comes from the directory hierarchy. |
| `CURRENT_USER_EMPLOYEE_ID` | Use this existing user as the current pilot identity. Omit in production when using SSO. |
| `PILOT_MODE_ENABLED` | Set `true` to apply the whole-portal pilot allowlist. |
| `PILOT_EMPLOYEE_IDS` | Comma-separated employee IDs allowed during the pilot. A configured pilot with an empty list fails closed. |
| `ADMIN_GROUP_IDS` / `ADMIN_EMPLOYEE_IDS` | Administrator capability. |
| `IT_GROUP_IDS` / `IT_EMPLOYEE_IDS` | IT collection close-out and operational correction management. |
| `RECONCILIATION_GROUP_IDS` / `RECONCILIATION_EMPLOYEE_IDS` | Reftab/NinjaOne ownership review. |
| `EXECUTIVE_GROUP_IDS` / `EXECUTIVE_EMPLOYEE_IDS` | Organization and financial analytics. |
| `ACCOUNT_SUPPORT_GROUP_IDS` / `ACCOUNT_SUPPORT_EMPLOYEE_IDS` | Management of the account-remediation queue. |
| `ALLOW_MANAGER_ADMIN_FALLBACK` | Development-only manager-to-admin compatibility. Ignored in production. |

API routes use these env vars (plus `DATABASE_URL` / `User` rows) to authorize
collection and related calls. **Coolify / production:** set
`MANAGER_EMPLOYEE_IDS` and optional `CURRENT_USER_EMPLOYEE_ID` to IDs that exist
in the deployed database, or pilot requests will fail with 401/403/404. See
[README.md](./README.md) (section *Coolify / production: env vars for pilot auth
and “Mark collected”*).

Production uses Entra/OIDC and maps employee ID/UPN/email to `User`. Configure
the Entra `groups` token claim and populate the group object-ID lists above.
Privileged capabilities fail closed in production when neither a matching group
nor employee-ID override is present.

---

## 8. Application-owned workflow configuration

These settings are stored in the target PostgreSQL `AppSetting` table and are
managed in the portal:

- **Admin → Return Workflow:** enabled/default recipient roles, designated
  recipient label, instructions, and required-location rule.
- **Admin → Rollout Readiness:** data review, workflow/security approval, pilot,
  training, communication, and launch sign-off checklist.
- **Sync settings:** startup/cron toggles and intervals for directory, Reftab,
  and NinjaOne.

Workflow queues (`CorrectionRequest`, `AccountRemediation`) and their audit
tables are also application-owned. The project intentionally uses
`prisma db push`; run it during deployment before starting the application.

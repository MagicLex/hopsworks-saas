# TODO

<<<<<<< HEAD
Last updated: 2026-06-11.
=======
Last updated: 2026-06-25.
>>>>>>> upstream/billing-update

Working board. "Shipped" lives in `git log`, not here. Items rot fast: anything older than ~30 days, prune or escalate.

## In progress

<<<<<<< HEAD
### Switch branch (`feat/lifecycle-webhook-receiver`) — merge when EE saas-augmentation deploys

- [ ] Configure clusters: `LIFECYCLE_WEBHOOK_URL` / `_SECRET` / `_CLUSTER_ID` settings + `HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET` in Vercel prod.
- [ ] Post-merge follow-ups from 2026-06-11 invariants audit (see below).

## Next

### From 2026-06-11 invariants audit
=======
### Metering backfill auto-recovery (#4, branch `billing-backfill` off `billing-update`)

The `billing-update` PR ships missed-hour *detection* (per-cluster `metering_watermark` + Slack alert). Auto-recovery is the remaining piece, isolated on its own branch because it rewrites billing-critical accumulation and must be validated against live OpenCost.

- [ ] Switch `collect-opencost` from "current in-progress hour" to "completed hours": at run time, process every completed hour in `(watermark, now]`, each with its own `window=${hourStart},${hourEnd}` and attributed to *its* date (so a gap across midnight does not land on the wrong day/month).
- [ ] Replace the intra-hour dedup (`isSameUtcHour`) with per-`(namespace, hour)` idempotency, keyed on the processed hour stamp stored in `project_breakdown`, so a failed watermark write cannot double-count.
- [ ] Storage snapshot stays current (no history); apply it per processed hour.
- [ ] Extract the accumulation into a pure function and unit-test (vitest) the idempotency and multi-hour math.
- [ ] STAGING VALIDATION (cannot be done locally, clusters unreachable): confirm `getOpenCostAllocations('${iso},${iso}')` (range window) works and returns the same shape as `window=1h`. Deploy to a Vercel preview hitting the staging cluster, run, check `usage_daily` deltas vs raw OpenCost.
- [ ] Accept the ~1h reporting delay (usage appears after the hour completes) as the cost of exactly-once + backfill.

## Next

### Billing control plane (PR `billing-update`, lands with the lifecycle-webhook PR)

- [ ] **Verify Stripe meter config** before trusting the storage fix: confirm `compute_credits` is priced at $0.35/credit and `storage_online_gb` / `storage_offline_gb` exist at $0.50 / $0.03. The code now sends compute-only credits + the storage meters; if the dashboard differs, storage billing is wrong.
- [ ] **Retroactive storage refund/credit**: storage was double-billed historically (credits included storage AND the storage meters fired). Quantify and credit affected paying accounts.
- [ ] **Coordinate the bookkeeper switch with Antonis** (hopsworks-as-a-service): read `applied_quota_tier`; add `small` (= current default, 6 CPU), `throttled`, `frozen` Kyverno policies; unknown/NULL → `frozen` (fail closed). `exempt` is the existing path. Inert until he ships.
- [ ] **Egress billing** (#3): captured as `network_egress_gb` (unbilled). To bill, configure OpenCost's network cost model (network-costs daemonset + OVH provider config) to isolate real internet egress from intra-cluster; billing the raw figure overcharges.
- [ ] **Prepaid**: kept manual (corporate invoice). Monthly `report-prepaid-usage` cron Slacks last month's usage. Revisit only if it should be automated.
- [ ] Apply migrations on each environment that needs them: `sql/012_billing_enforcement.sql`, `sql/013_metering_watermark.sql` (already applied to prod 2026-06-25).

### Billing chain hardening (closes INVARIANT I-14)

### Billing chain hardening (closes INVARIANT I-14)
>>>>>>> upstream/billing-update

- [ ] Standardize API errors: `handleApiError` used in only a handful of ~49 routes; 80+ ad-hoc `res.status(500)`. Sweep route-by-route.
- [ ] Promote a shared `getHopsworksCredentials(userId)` helper (private version exists in `src/lib/user-status.ts:37`) — the assignments→cluster→credentials block is inlined in 17 files. Same for a shared `supabaseAdmin` (46 module-level instantiations) and shared Stripe client (10).
- [ ] Reapers: downgrade-deadline suspension only fires when the user hits `/api/billing` (limbo users sleep forever) — move to a cron sweep. Purge resolved `health_check_failures` >30d and expired invites on a schedule instead of manually.
- [ ] `user_projects` inactive rows: define retention or keep forever deliberately.

### Doc cleanup (from 2026-05-08 audit)

- [ ] Fix broken cross-doc refs (5):
  - `docs/integrations/hubspot.md:45` → `docs/features/corporate-registration.md`
  - `docs/operations/deployment.md:104` → `docs/integrations/stripe.md`
  - `docs/operations/deployment.md:116` → `docs/integrations/hubspot.md`
  - `docs/operations/deployment.md:124` → `docs/integrations/resend.md`
  - `docs/features/corporate-registration.md:5` → `docs/integrations/hubspot.md`
- [ ] Renumber `docs/troubleshooting/known-issues.md` (currently has two §2).
- [ ] Refresh `docs/reference/hopsworks-api.md` (Last Updated: 2025-11-12, 175d stale).
- [ ] Trim resolved sections in `docs/troubleshooting/known-issues.md` (Project Namespace Mismatch, fixed 2025-01-21) and `docs/troubleshooting/investigations.md` (SSL WONT-FIX 2025-11-06, Team Member Project Tracking Removed 2025-11-05).
- [ ] Strip em-dashes from non-PHILOSOPHY docs: `agent-browser.md` (5), `known-issues.md` (5), `billing.md` (3).

### Future improvements (nice-to-have, not blocking)

- [ ] Storage guardrails: alert if `getOnlineStorageBatch` returns empty, to catch missing RonDB credentials before storage bills hit zero.
- [ ] Orphan namespace monitoring: log/alert when a namespace stays unresolved across runs.
- [ ] OpenCost collection mutex: per-cluster lock to prevent concurrent cron runs double-counting.
- [ ] `(namespace, hopsworks_cluster_id)` uniqueness on `user_projects` so duplicate project names across clusters do not overwrite each other.
- [ ] Hourly cross-check job: compare raw OpenCost totals vs `usage_daily` deltas.
- [ ] Stripe health tracking: store last `/api/billing/sync-stripe` payload per user for end-to-end audits.
- [ ] Failed-payment suspension policy: suspend after N failed attempts (currently no automatic suspension on payment failure, see `features/user-lifecycle.md:138`).
- [ ] Webhook idempotency log (closes INVARIANT I-8): dedup table keyed on Stripe `event.id`.

## Watching

- Vercel `undici` fetch does not support per-request HTTPS agents. SSL bypass stays global until either we migrate to `node-fetch@2` or Hopsworks ships real certs. See `docs/troubleshooting/investigations.md` SSL section.

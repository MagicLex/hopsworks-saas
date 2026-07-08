# TODO

Last updated: 2026-07-08.

Working board. "Shipped" lives in `git log`, not here. Items rot fast: anything older than ~30 days, prune or escalate.

Note: this file on `staging` is an assembly snapshot; the canonical board lives on the branch that lands the consolidated PR.

## In progress

### Onboarding rebuild (staging, 2026-07-08)

Server-resolved onboarding state machine shipped and E2E-validated on dev.run (signup, email verification, terms, free plan, cluster assignment on eu-west, zero 404s). Commits live on `origin/staging` (MagicLex) only.

- [ ] Fold the onboarding commits into the consolidated staging → master PR (supersedes PRs #8/#14).
- [ ] Postpaid path not E2E-tested (Stripe checkout in test mode): validate `needs_payment` → checkout → webhook → `assigning_cluster` → `ready`.
- [ ] Team invite flow still relays terms via sessionStorage (`accept-invite` → `joining`); recoverable now (a lost relay resolves to `needs_account`), migrate to the cookie relay later.

### Lifecycle webhook: staging validation live (2026-07-06)

eu-west (5.0.1, includes ee#2992) emits lifecycle events to the staging receiver. Validated end-to-end (user/project/member events, HTTP 200 in <15s).

- [ ] When the consolidated PR lands on master: point `lifecycle_webhook_url` at `https://run.hopsworks.ai/api/webhooks/hopsworks-lifecycle` (prod domain, no SSO, drop the bypass token) and rotate the secret to the production `HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET`.
- [ ] Then retire the poll: `cron/sync-projects` + login-time project-sync (keep `syncUserProjects()` on-demand before billing decisions, I-14, for a few weeks).

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

- [ ] Add `syncUserProjects()` before any project-count read in `src/pages/api/billing.ts` (2 sites: upgrade, downgrade).
- [ ] Add `syncUserProjects()` before any project-count read in `src/pages/api/webhooks/stripe.ts` (2 sites: subscription deleted, payment method detached).
- [ ] Wrap each `syncUserProjects()` call in try/catch and log; do not let a Hopsworks outage 500 the billing endpoint.
- [ ] Check the return value at all 4 call sites; on failure, log and route through `alertBillingFailure` in `webhooks/stripe.ts` (per `reviews.md` 2026-02-20 must-fix).
- [ ] Add try/catch back around the project-count query in `src/pages/api/usage.ts`.

### Code health (from 2026-06-11 invariants audit)

- [ ] Standardize API errors: `handleApiError` used in only a handful of ~49 routes; 80+ ad-hoc `res.status(500)`. Sweep route-by-route.
- [ ] Promote a shared `getHopsworksCredentials(userId)` helper (private version exists in `src/lib/user-status.ts:37`); the assignments→cluster→credentials block is inlined in 17 files. Same for a shared `supabaseAdmin` (46 module-level instantiations) and shared Stripe client (10).
- [ ] Reapers: downgrade-deadline suspension only fires when the user hits `/api/billing` (limbo users sleep forever); move to a cron sweep. Purge resolved `health_check_failures` >30d and expired invites on a schedule instead of manually.
- [ ] `user_projects` inactive rows: define retention or keep forever deliberately.

### Dashboard correctness

- [ ] Remove `numActiveProjects` from `src/pages/api/user/hopsworks-info.ts` response. We do not trust it (see I-2, `docs/troubleshooting/known-issues.md`).
- [ ] Add `projects: []` to the error-response path in `hopsworks-info.ts` so the dashboard does not crash on Hopsworks outage.

### Doc cleanup (remains from 2026-05-08 audit)

- [ ] Refresh `docs/reference/hopsworks-api.md` (Last Updated: 2025-11-12, stale; needs validation against a live cluster).
- [ ] Trim `docs/troubleshooting/investigations.md` §"Team Member Project Tracking Removed" (2025-11-05). Keep the SSL WONT-FIX section: INVARIANTS I-10 and the Watching list below reference it.

### Future improvements (nice-to-have, not blocking)

- [ ] Storage guardrails: alert if `getOnlineStorageBatch` returns empty, to catch missing RonDB credentials before storage bills hit zero.
- [ ] Orphan namespace monitoring: log/alert when a namespace stays unresolved across runs.
- [ ] OpenCost collection mutex: per-cluster lock to prevent concurrent cron runs double-counting.
- [ ] `(namespace, hopsworks_cluster_id)` uniqueness on `user_projects` so duplicate project names across clusters do not overwrite each other.
- [ ] Hourly cross-check job: compare raw OpenCost totals vs `usage_daily` deltas.
- [ ] Stripe health tracking: store last `/api/billing/sync-stripe` payload per user for end-to-end audits.
- [ ] Failed-payment suspension policy: suspend after N failed attempts (currently no automatic suspension on payment failure, see `features/user-lifecycle.md:138`).
- [ ] Webhook idempotency log (closes INVARIANT I-8): dedup table keyed on Stripe `event.id`.
- [ ] Consolidate migration directories: `sql/` (001-013) and `supabase/migrations/` (0000-0003) both receive new migrations; pick one convention and fold the other in.

## Watching

- `assignUserToCluster` corrects `maxNumProjects` with `!==` on already-assigned users (deliberate, for downgrades). Tension with the I-1 ratchet (`<` only): review whether the downgrade path can lock out users whose deleted projects still count.
- Hopsworks bug: `numActiveProjects` and `maxNumProjects` count created (not active). Ratchet workaround stays until the upstream fix lands. Track in `docs/troubleshooting/known-issues.md` §"Project Quota Counts Created, Not Active".
- Vercel `undici` fetch does not support per-request HTTPS agents. SSL bypass stays global until either we migrate to `node-fetch@2` or Hopsworks ships real certs. See `docs/troubleshooting/investigations.md` SSL section.

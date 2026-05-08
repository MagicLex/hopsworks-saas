# TODO

Last updated: 2026-05-08.

Working board. "Shipped" lives in `git log`, not here. Items rot fast: anything older than ~30 days, prune or escalate.

## In progress

_(none right now)_

## Next

### Billing chain hardening (closes INVARIANT I-14)

- [ ] Add `syncUserProjects()` before any project-count read in `src/pages/api/billing.ts` (2 sites: upgrade, downgrade).
- [ ] Add `syncUserProjects()` before any project-count read in `src/pages/api/webhooks/stripe.ts` (2 sites: subscription deleted, payment method detached).
- [ ] Wrap each `syncUserProjects()` call in try/catch and log; do not let a Hopsworks outage 500 the billing endpoint.
- [ ] Check the return value at all 4 call sites; on failure, log and route through `alertBillingFailure` in `webhooks/stripe.ts` (per `reviews.md` 2026-02-20 must-fix).
- [ ] Add try/catch back around the project-count query in `src/pages/api/usage.ts`.

### Dashboard correctness

- [ ] Remove `numActiveProjects` from `src/pages/api/user/hopsworks-info.ts` response. We do not trust it (see I-2, `docs/troubleshooting/known-issues.md`).
- [ ] Add `projects: []` to the error-response path in `hopsworks-info.ts` so the dashboard does not crash on Hopsworks outage.

### Project-quota tooling

- [ ] `fix-project-quotas` misses users whose deleted projects were never tracked (pre-tracking era). Either backfill `user_projects` from Hopsworks admin API, or extend the endpoint to query Hopsworks directly when our DB has zero deleted rows.

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

- Hopsworks bug: `numActiveProjects` and `maxNumProjects` count created (not active). Ratchet workaround stays until the upstream fix lands. Track in `docs/troubleshooting/known-issues.md:137`.
- Vercel `undici` fetch does not support per-request HTTPS agents. SSL bypass stays global until either we migrate to `node-fetch@2` or Hopsworks ships real certs. See `docs/troubleshooting/investigations.md` SSL section.

# TODO

Last updated: 2026-06-11.

Working board. "Shipped" lives in `git log`, not here. Items rot fast: anything older than ~30 days, prune or escalate.

## In progress

### Switch branch (`feat/lifecycle-webhook-receiver`) — merge when EE saas-augmentation deploys

- [ ] Configure clusters: `LIFECYCLE_WEBHOOK_URL` / `_SECRET` / `_CLUSTER_ID` settings + `HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET` in Vercel prod.
- [ ] Post-merge follow-ups from 2026-06-11 invariants audit (see below).

## Next

### From 2026-06-11 invariants audit

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

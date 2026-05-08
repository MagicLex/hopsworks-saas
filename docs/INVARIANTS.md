# Invariants

Architectural contracts. Verify before merging any significant change. Each item carries a check and a status: PASS, FAIL, or UNVERIFIED.

Audited: 2026-05-08.

## Quota and ratchet

### I-1. Every `maxNumProjects` write site uses a `<` guard
Hopsworks counts created projects, not active. Lowering the limit locks users out.
- **Check**: `rg 'maxNumProjects' src/ | rg -v '< (1|5|expectedMaxProjects)'` should return only reads, comments, and error logs (no `!==` or unconditional set).
- **Status**: PASS. All write sites in `cluster-assignment.ts`, `webhooks/stripe.ts`, `billing.ts`, `billing/setup-payment.ts` guard with `(hwUser.maxNumProjects ?? 0) < N`.

### I-2. Project counts come from synced `user_projects`, not Hopsworks API
- **Check**: `rg 'numActiveProjects|maxNumProjects' src/pages/api/billing.ts src/pages/api/usage.ts` shows no use of these fields for billing decisions.
- **Status**: PASS. `numActiveProjects` is no longer read for downgrade/suspension logic.

## User lifecycle

### I-3. Soft-deleted users get 403 on every user-facing endpoint
- **Check**: Every handler under `src/pages/api/{auth,billing,user,team}/*` calls a deleted-user guard before any DB mutation or response.
- **Status**: PASS for `sync-user.ts:93` (`deleted_at` check). Other endpoints rely on `requireUser` / billing guard. Verify when adding new user-facing routes.

### I-4. Account-owner suspension cascades to team members
- **Check**: `suspendUser()` in `src/lib/user-status.ts` updates owner status, then iterates team members and updates their Hopsworks status to `3`.
- **Status**: PASS. Covered by integration tests in `tests/`.

### I-5. Team members are created with `maxNumProjects: 0`
- **Check**: `rg 'maxNumProjects' src/lib/hopsworks-team.ts src/pages/api/team/join.ts`.
- **Status**: PASS at create time. Sync re-asserts on every login.

## Webhook and cron security

### I-6. Stripe webhook verifies signature before any state change
- **Check**: `rg -B2 -A2 'constructEvent' src/pages/api/webhooks/stripe.ts` shows the verification at the top of the handler, before any DB or Hopsworks call.
- **Status**: PASS.

### I-7. Cron endpoints require `CRON_SECRET` bearer
- **Check**: `rg 'CRON_SECRET' src/pages/api/usage/collect-opencost.ts src/pages/api/billing/sync-stripe.ts`.
- **Status**: PASS in both endpoints.

### I-8. Webhook handlers are idempotent
- **Check**: Re-delivering the same Stripe `event.id` does not duplicate side effects (no double `INSERT` into `usage_daily`, no second `UPDATE maxNumProjects`).
- **Status**: UNVERIFIED. No dedup table or `event.id` log in `webhooks/stripe.ts`. Stripe retries are idempotent in practice because state transitions use `<` guards and upserts, but a deliberate idempotency log would harden this.

## Secrets and TLS

### I-9. No secrets or Stripe IDs hardcoded in source
- **Check**: `rg "price_[A-Za-z0-9]{10,}|prod_[A-Za-z0-9]{10,}|sk_(live|test)_" src/`.
- **Status**: PASS (no hits).

### I-10. `NODE_TLS_REJECT_UNAUTHORIZED='0'` is scoped to Hopsworks libs only
- **Check**: `rg "NODE_TLS_REJECT_UNAUTHORIZED" src/`.
- **Status**: PASS. Only set in `src/lib/hopsworks-api.ts:10` and `src/lib/hopsworks-team.ts:8`. Documented WONT-FIX in `troubleshooting/investigations.md` because Vercel `undici` fetch does not support per-request agents.

## Data integrity

### I-11. `user_projects.namespace` is the hyphenated K8s form
- **Check**: SQL `select count(*) from user_projects where namespace like '%\_%' and namespace not like '%-%'` should return 0.
- **Status**: UNVERIFIED in this audit. Last fixed 2025-01-21 (see `known-issues.md` §3). Re-run query before any change to namespace handling.

### I-12. Team-member project access is in `project_member_roles`, not `user_projects`
- **Check**: `project-sync.ts` skips users where `account_owner_id IS NOT NULL`.
- **Status**: PASS. `src/lib/project-sync.ts` has the early return; team members are reconciled via `project_member_roles` only.

### I-13. Every active user has at most one cluster assignment
- **Check**: SQL `select user_id, count(*) from user_hopsworks_assignments group by user_id having count(*) > 1`.
- **Status**: UNVERIFIED in this audit. Run before any cluster-migration work.

## Billing chain

### I-14. `syncUserProjects()` runs before any project-count-dependent decision
- **Check**: Every code path that reads `user_projects` for billing/downgrade/suspension calls `syncUserProjects(userId)` first.
- **Status**: PARTIAL. Login (`sync-user.ts`) and admin tools call it. `billing.ts` and `webhooks/stripe.ts` do not yet (tracked in MEMORY pending work). FAIL until those four call sites are added.

### I-15. Stripe meter events sync runs daily without overlap
- **Check**: Cron schedule `0 3 * * *` in `vercel.json`; handler is short-running and re-entrant.
- **Status**: PASS. No mutex yet (tracked as future improvement in `features/billing.md:571`).

## How to use this file

- Before merging a PR that touches billing, auth, quotas, or webhooks: re-run the relevant checks. Update status if it changes.
- A FAIL or UNVERIFIED on a load-bearing invariant is a merge blocker, not a follow-up ticket.
- New invariants added here must include a runnable check, not aspirational prose.

# Engineering Principles

Non-negotiable rules. If a PR violates one, it does not merge.

## Source of truth, by domain

1. **Hopsworks owns project state.** Never use our DB cache to decide whether a project exists. Call `syncUserProjects()` before any billing, quota, downgrade, or suspension decision.
2. **Stripe owns invoices and subscriptions.** We feed metered usage; we do not compute amounts owed. The dashboard shows what Stripe says, not our prediction.
3. **Auth0 owns identity.** No password fields in our DB. No identity decisions made without an Auth0 session (or a verified webhook secret).

## Quota and billing

4. **Ratchet `maxNumProjects` with `<`, never `!==`.** Hopsworks counts created projects, not active ones. Every write site must guard with `if (current < desired) update(desired)`. Lowering it locks users out. See `docs/troubleshooting/known-issues.md`.
5. **Never trust `numActiveProjects` from the Hopsworks API for billing.** It includes deleted projects. Count from synced `user_projects` only.
6. **Sync before count.** Any code path that counts projects, users, or seats must call the sync helper first. Login-time cache is stale by the time a Stripe webhook fires.

## User lifecycle

7. **Soft-deleted users get 403 on every user-facing endpoint.** Including `sync-user`, `billing`, dashboard data, team APIs. Use the shared guard, do not reinvent the check per route.
8. **Account-owner suspension or deletion cascades to all team members.** No team-member should ever have access if the owner does not. The cascade is mandatory, not best-effort.
9. **Team members have `maxNumProjects: 0`.** Enforced at create time, re-asserted on every sync. Team members cannot create projects.

## Webhooks and crons

10. **Verify before mutating.** Stripe signature, Auth0 shared secret, cron `CRON_SECRET` bearer. No state change before verification passes.
11. **Idempotent handlers, always.** Stripe will retry. Cron may double-fire. Replaying a webhook must produce the same end state, never double-charge or duplicate-create.

## Code and infrastructure

12. **Auth0 SDK is pinned to v3.** Do not bump to v4 without a tracked migration. v4 breaks the session contract this app relies on.
13. **OpenCost is queried via `kubectl exec` only.** Never expose it externally, never proxy it through a public endpoint.
14. **`user_projects.namespace` is the hyphenated K8s form**, not the Hopsworks `project_name`. Do not use them interchangeably.
15. **Team-member project access lives in `project_member_roles`, not `user_projects`.** Project-sync skips team members on purpose. Do not "fix" this.
16. **No secrets in code.** Vercel env vars only. No trailing whitespace, no echo/printf piping into env config (it injects newlines).

## Tests and validation

17. **Integration tests hit a real Supabase, not mocks.** Mocked tests passed billing logic that broke in prod. Mocks lie about quotas.
18. **No hardcoded prices, IDs, or limits.** Read from `billing-rates.ts`, `stripe_products`, or env. If you find one, remove it in the same PR.

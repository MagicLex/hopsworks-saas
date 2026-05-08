# Operations Runbook

Production access, deploy, troubleshooting. Not architecture, what you need when things break.

## Access

| Resource | Where | Auth |
|----------|-------|------|
| Production app | https://run.hopsworks.ai | Auth0 (admin user with `is_admin=true`) |
| Admin panel | https://run.hopsworks.ai/admin47392 | Auth0 + DB `is_admin` flag |
| Vercel project | https://vercel.com (logicalclocks org) | SSO |
| Supabase | https://supabase.com → project `pahfsiosiuxdkiebepav` | SSO. Pooler conn string in MEMORY.md |
| Hopsworks UI admin | https://run.hopsworks.ai (admin login) | Ask Lex for credentials |
| Cluster `saas-de` (debug) | `kubectl` with debug kubeconfig | AWS Secrets Manager: `Production/OVH/SAAS-DE/Debug-KubeConfig` |
| Cluster `saas-de` (admin) | Emergency only | AWS Secrets Manager: `Production/OVH/SAAS-DE/ADMIN-KubeConfig` |
| Stripe dashboard | https://dashboard.stripe.com (live mode) | Per-user invite |
| HubSpot | https://app.hubspot.com | Per-user invite |
| Auth0 tenant | `dev-fur3a3gej0xmnk7f.eu.auth0.com` | Per-user invite |

**IP whitelist**: cluster API requires it. Add yours in OVH console → Managed Kubernetes → saas-de → APIServer Access. Without it, `kubectl` and OpenCost collection fail from your laptop.

Full cluster reference: `docs/operations/saas-cluster.md`.

## Deploy

- **Production**: `git push origin master` → Vercel deploys automatically. No manual step.
- **Preview**: every PR gets a Vercel preview URL with the same env config.
- **Cluster upgrades**: manual via GitHub Actions on `hopsworks-as-a-service` repo. During upgrades, Hopsworks API calls may fail temporarily; the app logs the failure and continues. Users may show inconsistent state until next sync.
- **Database migrations**: SQL files in `sql/` applied manually via Supabase SQL editor or `psql`. No automated migration runner. See `docs/operations/deployment.md`.
- **Rollback**: Vercel → Deployments → Promote a previous deployment. Database rollback is manual; check `sql/` for the inverse migration before promoting an old build.

## Cron schedule

| Job | Schedule | Endpoint | Auth |
|-----|----------|----------|------|
| OpenCost collection | hourly `0 * * * *` | `POST /api/usage/collect-opencost` | `CRON_SECRET` bearer |
| Stripe meter sync | daily `0 3 * * *` | `POST /api/billing/sync-stripe` | `CRON_SECRET` bearer |

Vercel cron is the fallback. Primary scheduler is Windmill (`https://auto.hops.io`). If both run, the handlers are re-entrant; usage rows upsert on `(user_id, date, hour)`.

## Troubleshooting

First reflex: **Vercel logs** (production runtime). Filter by route, search for `[error]` or the user's email.

| Symptom | First check | Doc |
|---------|-------------|-----|
| User signed up but no cluster | Vercel logs `[cluster-assignment]` for the user | `docs/troubleshooting/known-issues.md` |
| User suspended in DB, active in Hopsworks | Vercel logs `[suspendUser]` errors | `docs/features/user-lifecycle.md` |
| OpenCost returning zeros | `kubectl exec` reachability, OpenCost pod ready, kubeconfig in `hopsworks_clusters` | `docs/operations/opencost-collection.md` |
| Billing endpoint 500 | Hopsworks API down or `syncUserProjects` throwing | `docs/features/billing.md`, retry after Hopsworks recovers |
| User can create projects beyond plan | Ratchet was reset by some new write site without `<` guard | I-1 in `docs/INVARIANTS.md`, audit `rg maxNumProjects src/` |
| "Account type not provided" on user creation | Hopsworks admin API expects query params, not JSON body | `docs/troubleshooting/user-creation-workaround.md` |
| Stripe webhook 401 | Signature mismatch. Check `STRIPE_WEBHOOK_SECRET` in Vercel matches the endpoint secret in Stripe dashboard | `docs/architecture/security.md` |
| Auth0 callback "baseURL must be a valid uri" | Trailing newline in `AUTH0_BASE_URL` Vercel env var | `docs/troubleshooting/known-issues.md` §2 |
| All Hopsworks API calls failing | Cluster upgrade in progress or your IP not whitelisted | `docs/operations/saas-cluster.md` |

Detailed playbooks live in `docs/troubleshooting/`. Hopsworks DB direct query: `docs/troubleshooting/hopsworks-db-access.md`.

## Admin tools

| Action | Endpoint | Notes |
|--------|----------|-------|
| Bulk fix project quotas | `POST /api/admin/fix-project-quotas` | Idempotent. `{"dryRun": true}` to preview |
| List users with usage | `GET /api/admin/users` | Per-project breakdown |
| Manual user reactivation | Admin panel → user → reactivate | Triggers Hopsworks status reset |

## When in doubt

1. Read the Vercel logs.
2. Read the Hopsworks UI status (run.hopsworks.ai).
3. Read `docs/troubleshooting/known-issues.md` and `docs/troubleshooting/investigations.md`.
4. If still stuck, query Supabase directly with the pooler URL in MEMORY.md.

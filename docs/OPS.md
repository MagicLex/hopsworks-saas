# Operations Runbook

Production access, deploy, troubleshooting. Not architecture, what you need when things break.

## Access

| Resource | Where | Auth |
|----------|-------|------|
| Production app | https://run.hopsworks.ai | Auth0 (admin user with `is_admin=true`) |
| Staging app | https://dev.run.hopsworks.ai (branch `staging`) | Auth0, isolated DB. See `docs/DEPLOY_STAGING.md` |
| Admin panel | https://run.hopsworks.ai/admin47392 | Auth0 + DB `is_admin` flag |
| Vercel project | https://vercel.com (`magiclexs-projects/hopsworks-managed`) | SSO. CLI: `vercel env ls` |
| Supabase | https://supabase.com → project `pahfsiosiuxdkiebepav`. **Shared between prod and staging** (bridge testing). Pooler conn string in MEMORY.md | SSO |
| Hopsworks UI admin | https://run.hopsworks.ai (admin login) | Ask Lex for credentials |
| Cluster `saas-de` (debug) | `kubectl` with debug kubeconfig | AWS Secrets Manager: `Production/OVH/SAAS-DE/Debug-KubeConfig` |
| Cluster `saas-de` (admin) | Emergency only | AWS Secrets Manager: `Production/OVH/SAAS-DE/ADMIN-KubeConfig` |
| Cluster `saas-5-test` (Hopsworks 5.0, staging) | API `https://10.112.37.130`, K8s `10.112.37.10:6443` — both RFC1918, OVH VPN required | Kubeconfig in `hopsworks_clusters.kubeconfig` (row name `saas-5-test`, environment `staging`) |
| Stripe dashboard | https://dashboard.stripe.com (live mode) | Per-user invite |
| HubSpot | https://app.hubspot.com | Per-user invite |
| Auth0 tenant | `dev-fur3a3gej0xmnk7f.eu.auth0.com` | Per-user invite |

**IP whitelist**: cluster API requires it. Add yours in OVH console → Managed Kubernetes → saas-de → APIServer Access. Without it, `kubectl` and OpenCost collection fail from your laptop.

Full cluster reference: `docs/operations/saas-cluster.md`.

## Deploy

- **Production**: `git push origin master` → Vercel deploys automatically. No manual step.
- **Staging**: PR against `staging` branch → Vercel deploys to https://dev.run.hopsworks.ai. DB is **shared** with prod (writes affect real users), but auto-assignment routes new signups to the staging cluster row (`saas-5-test`). Stripe in TEST mode. Full setup: `docs/DEPLOY_STAGING.md`.
- **Preview (PR)**: every PR gets a Vercel preview URL with the staging env config.
- **Cluster upgrades**: manual via GitHub Actions on `hopsworks-as-a-service` repo. During upgrades, Hopsworks API calls may fail temporarily; the app logs the failure and continues. Users may show inconsistent state until next sync.
- **Database migrations**: numbered SQL files in `supabase/migrations/` (`0000_baseline_schema.sql` is the prod baseline dump). New schema changes go in `0002_*.sql` etc. Apply manually via `psql` or Supabase SQL editor — **before** deploying the matching code.
- **Rollback**: Vercel → Deployments → Promote a previous deployment. Database rollback is manual; check `supabase/migrations/` for the inverse migration before promoting an old build.

## Cron schedule

| Job | Schedule | Endpoint | Auth |
|-----|----------|----------|------|
| OpenCost collection | hourly `0 * * * *` | `POST /api/usage/collect-opencost` | `CRON_SECRET` bearer |
| Stripe meter sync | daily `0 3 * * *` | `POST /api/billing/sync-stripe` | `CRON_SECRET` bearer |
| Project sync | every 30min `*/30 * * * *` | `POST /api/cron/sync-projects` | `CRON_SECRET` bearer |
| Data integrity check | daily `0 6 * * *` | `POST /api/cron/check-data-integrity` | `CRON_SECRET` bearer |

Vercel cron is the fallback. Primary scheduler is Windmill (`https://auto.hops.io`). If both run, the handlers are re-entrant; usage rows upsert on `(user_id, date, hour)`.

All four routes fail-hard with `500` if `CRON_SECRET` is unset — no silent open access. Configured via `vercel env add CRON_SECRET <env>`.

## Internal-call auth

`/api/billing` calls `/api/alerts/downgrade` server-to-server. The callee gates on `INTERNAL_API_SECRET` (separate from `CRON_SECRET` so they rotate independently). Both secrets are configured per-environment in Vercel:

```
vercel env ls | grep -E "CRON_SECRET|INTERNAL_API_SECRET"
```

Production and Preview each have distinct values. To rotate:
```
echo "$(openssl rand -hex 32)" | vercel env add INTERNAL_API_SECRET production --force
```

## Hopsworks lifecycle webhook (inbound)

The cluster posts user/project/membership events to `POST /api/webhooks/hopsworks-lifecycle` (brief #3, receiver TBD). Body is signed `HMAC-SHA256(body, HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET)`, header `X-Hopsworks-Signature: sha256=<hex>`. The same secret value must be set:

- Cluster side: Hopsworks `Settings` key `LIFECYCLE_WEBHOOK_SECRET`
- SaaS side: Vercel env `HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET` (scopes `Preview` + `staging`; add `Production` once the prod cluster runs the matching backend build)

Rotate on both sides together; mismatched secrets surface as `401` from the receiver, retried by the cluster's outbox with exponential backoff (up to 24h).

## Environment-scoped cluster routing

Staging and production share the same Supabase, so `hopsworks_clusters.environment` (`'production' | 'staging'`, default `'production'`) decides where a new signup lands. The filter is applied at:

- `cluster-assignment.ts` — first-signup auto-assignment
- `usage/collect-opencost.ts` — OpenCost cron (prevents prod cron from `kubectl exec`ing against a staging kubeconfig)
- `cron/check-data-integrity.ts` — drift check + active-cluster count
- `admin/usage/check-opencost.ts` — admin debug

ID-keyed selects are unchanged; the user's `user_hopsworks_assignments` row already carries the right env via FK. Admin listing endpoints (`/api/admin/clusters`) intentionally show all envs.

Resolution helper: `src/lib/environment.ts` → reads `NEXT_PUBLIC_ENVIRONMENT`. Anything other than `staging` resolves to `production`.

**Re-assigning an existing user across envs is manual**: the auto-assignment short-circuits once an assignment row exists. Update `user_hopsworks_assignments.hopsworks_cluster_id` directly if you really need to move a user.

## Local dev mode (hybrid)

`npm run dev` is not a clean "local prod" nor "local staging" mode. It's a mix:

| Resource | Where local hits | Switch via |
|---|---|---|
| Supabase DB | **Always production** (shared with staging) | `POSTGRES_URL` / `SUPABASE_URL` in `.env.local` |
| Hopsworks cluster | Routed by env (`saas-5-test` if `NEXT_PUBLIC_ENVIRONMENT=staging`) | `NEXT_PUBLIC_ENVIRONMENT` in `.env.local` |
| Auth0 | Prod tenant (signup creates a real Auth0 user) | `AUTH0_*` vars |
| Stripe | Test mode | `stripe-config.ts` picks `STRIPE_TEST_*` over `STRIPE_*` |
| Resend / HubSpot / Windmill | Production | single key per service |

Visual cue: red sticky banner at the top of every page when `NEXT_PUBLIC_ENVIRONMENT !== 'production'` (`src/components/EnvironmentBanner.tsx`). No banner = banner not mounted, or `npm run dev` wasn't restarted after `.env.local` changes (Next.js reads it at startup only).

To test the staging cluster path locally:

1. Add `NEXT_PUBLIC_ENVIRONMENT=staging` and `HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET=<value>` to `.env.local`
2. Connect to OVH VPN (cluster API is RFC1918 — no public ingress)
3. Restart `npm run dev`
4. **Sign up with a fresh email**. Existing assignments are frozen; switching env doesn't move existing users.
5. Verify in Supabase:
   ```sql
   SELECT hc.name, hc.environment
   FROM user_hopsworks_assignments uha
   JOIN hopsworks_clusters hc ON hc.id = uha.hopsworks_cluster_id
   JOIN users u ON u.id = uha.user_id
   WHERE u.email = '<your fresh email>';
   ```
   Expected: `saas-5-test / staging`.

### Exposing the local SaaS for inbound webhooks (brief #3)

The Hopsworks lifecycle webhook fires **cluster → SaaS**. The staging cluster (`saas-5-test`, RFC1918) has egress internet, so it can reach a public URL — but it cannot reach your laptop's `localhost:3000` directly even on VPN (the VPN routes traffic *to* the cluster, not from it back to your `10.6.0.x` address).

A quick HTTPS tunnel solves it. Cloudflare's free `trycloudflare.com` quick tunnels need no signup and work in one command.

```bash
brew install cloudflared   # one-time
nohup cloudflared tunnel --url http://localhost:3000 --no-autoupdate \
  > /tmp/cf-saas.log 2>&1 &
echo $! > /tmp/cf-saas.pid
# Wait ~3-5s, then grab the URL:
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-saas.log | head -1
```

Configure the cluster (`hopsworks.variables` table or admin Settings UI) with:

| Setting | Value (local dev against `saas-5-test`) | Per env |
|---|---|---|
| `MANAGEMENT_MODE` | `SAAS_MANAGED` | Same on all SaaS clusters; blocks native auth (brief #6) |
| `SAAS_ENTRY_POINT_URL` | `http://localhost:3000` | Local dev. Prod: `https://run.hopsworks.ai`. Staging: `https://dev.run.hopsworks.ai` |
| `LIFECYCLE_WEBHOOK_URL` | `<cloudflared-url>/api/webhooks/hopsworks-lifecycle` | Local dev: tunnel. Prod/staging: the corresponding hosted SaaS URL |
| `LIFECYCLE_WEBHOOK_SECRET` | matches `HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET` in `.env.local` | Rotate on both sides together |
| `LIFECYCLE_WEBHOOK_CLUSTER_ID` | `saas-5-test` | Matches `hopsworks_clusters.name`; receiver uses it to find the right row |

Empty `LIFECYCLE_WEBHOOK_URL` disables the handler — handy when you're done tunneling.

Caveats:

- **URL is ephemeral**: every fresh `cloudflared` invocation gives a new hostname. Kill the tunnel (`kill $(cat /tmp/cf-saas.pid)`) and update the cluster setting whenever you re-tunnel.
- No IP whitelist. The HMAC signature (`X-Hopsworks-Signature: sha256=...`) is what authenticates payloads — never accept events from a tunnel without verifying the HMAC.
- Local Next.js must actually be running on `:3000`; the tunnel just proxies, it doesn't start your dev server.
- The cluster's outbox retries up to 24h with exponential backoff. If you re-tunnel during a stuck delivery, the cluster will eventually catch up.

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

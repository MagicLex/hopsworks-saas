# Staging deployment — dev.run.hopsworks.ai

Permanent staging environment for **bridge testing**: Hopsworks cluster
swaps, Stripe webhook flows, Auth0 callbacks, Resend templates, etc.
Everything user-facing that talks to an external system.

```
main branch     → run.hopsworks.ai           (production)
staging branch  → dev.run.hopsworks.ai       (staging — bridges isolated)
PRs             → *-git-<branch>.vercel.app  (preview, ephemeral)
```

## What's isolated vs shared

| Resource | Staging uses | Why |
|---|---|---|
| **Database** (Supabase) | **Same as production** | Bridge testing, not data testing. Schema is the same; we want to verify our code talks correctly to upstream systems against real shapes. |
| **Auth0 application** | Separate app, same tenant | Callback URLs differ; we don't want staging to issue tokens against the prod Web Origin allow-list. |
| **Stripe** | Test mode keys + test webhook | Real charges would happen otherwise. |
| **Hopsworks cluster** | Test cluster row in `hopsworks_clusters` | Don't pollute prod cluster with experimental project quotas / suspension flags. |
| **Crons** | Disabled on staging | Vercel runs `vercel.json` crons on Production deployment only. Trigger manually for testing. |

> **Loud red banner across every staging page**: writes go to the prod DB.
> Use a dedicated test user (`tst+staging@hopsworks.ai`), never click
> "Delete account" on a real user, never suspend / change billing-mode on
> someone you don't own.

## One-time setup

### 1. Auth0 — separate application, same tenant

1. Auth0 Dashboard → Applications → Create new "Regular Web Application"
   named `Hopsworks Managed Staging`.
2. **Allowed Callback URLs**: `https://dev.run.hopsworks.ai/api/auth/callback`
3. **Allowed Logout URLs**: `https://dev.run.hopsworks.ai`
4. **Allowed Web Origins**: `https://dev.run.hopsworks.ai`
5. Copy `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`. Tenant URL stays the same.

### 2. Stripe — TEST mode

The codebase already supports `STRIPE_TEST_*` keys via `lib/stripe-config.ts`.
For staging, point `STRIPE_*` env vars at the test-mode keys.

Create a Stripe webhook endpoint in the **test-mode** dashboard:
`https://dev.run.hopsworks.ai/api/webhooks/stripe` → copy the `whsec_*`
into staging's `STRIPE_WEBHOOK_SECRET`.

### 3. Hopsworks — test cluster row

Insert a row into `hopsworks_clusters` (the prod table — it's shared) marking
a non-production cluster as the staging target. The simplest pattern:
add a column `environment` (or reuse `status`) so the assignment logic in
`lib/cluster-assignment.ts` can pick the test cluster when staging users sign up.

If that's too invasive for now, the pragma is: in staging, hand-update the
test user's `user_hopsworks_assignments` row to point at the test cluster's
UUID. One-time cost.

### 4. Vercel — branch + domain + env vars

1. Vercel project → Settings → Git → Production branch is `main`. The
   `staging` branch deploys as a Preview by default — that's what we want.
2. Vercel project → Domains → add `dev.run.hopsworks.ai`, attach to
   "Git branch: staging".
3. DNS: add CNAME `dev` → `cname.vercel-dns.com`.
4. Vercel project → Settings → Environment Variables. Set per-environment
   values (Production / Preview):

   Already set via `vercel env add`:

   | Var | Production | Preview |
   |---|---|---|
   | `NEXT_PUBLIC_ENVIRONMENT` | `production` | `staging` |
   | `CRON_SECRET` | (existing) | new random hex |
   | `INTERNAL_API_SECRET` | new random hex | new random hex |

   Still to set manually for staging (Preview):

   | Var | Preview value |
   |---|---|
   | `AUTH0_BASE_URL` | `https://dev.run.hopsworks.ai` |
   | `AUTH0_CLIENT_ID` | staging Auth0 app id |
   | `AUTH0_CLIENT_SECRET` | staging Auth0 app secret |
   | `AUTH0_SECRET` | `openssl rand -hex 32` (cookie signing) |
   | `STRIPE_SECRET_KEY` | `sk_test_*` |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_*` |
   | `STRIPE_WEBHOOK_SECRET` | test-mode `whsec_*` |
   | `RESEND_FROM_EMAIL` | `Hopsworks Staging <no-reply@...>` (recommended) |

   DB / Supabase / HubSpot env vars: copy production values to Preview verbatim
   (we share those backends).

   Add via CLI:
   ```bash
   echo "https://dev.run.hopsworks.ai" | vercel env add AUTH0_BASE_URL preview
   ```

## Workflow

```bash
# Daily flow
git checkout staging
git merge main             # bring staging up to date
# ... make changes ...
git push origin staging    # auto-deploys to dev.run.hopsworks.ai

# When staging changes are validated
git checkout main
git merge staging
git push origin main       # auto-deploys to run.hopsworks.ai
```

## Verifying staging is correctly configured

After setup, hit `https://dev.run.hopsworks.ai`:
- **Loud red banner** at the top: "STAGING — shared production DB. Writes affect real users."
- Login flow lands you back on `dev.run.hopsworks.ai`, not `run.hopsworks.ai`.
- Billing setup uses Stripe test mode (test card `4242 4242 4242 4242`).
- Any cluster you get assigned is the staging-test row.

If any of those points to prod, an env var is wrong — fix before testing
anything that mutates state.

## Manual cron trigger from staging

Vercel cron only fires on Production deployment. To test a cron handler
against staging:

```bash
curl -X POST -H "Authorization: Bearer $STAGING_CRON_SECRET" \
  https://dev.run.hopsworks.ai/api/cron/sync-projects
```

`STAGING_CRON_SECRET` value: pull with `vercel env pull --environment=preview .env.preview`.

# Deployment Guide

## Prerequisites

1. **Vercel Account** - For hosting
2. **Auth0 Application** - Must be Auth0 v3
3. **Supabase Project** - For database
4. **Stripe Account** - For billing
5. **Hopsworks Cluster** - With admin access
6. **OpenCost** - Installed in Kubernetes cluster
7. **HubSpot Private App Token** - Required for corporate/prepaid onboarding
8. **Resend Account** (or SMTP alternative) - Delivers team invites

## Initial Setup

### 1. Auth0 Configuration

1. Create new Regular Web Application in Auth0
2. Configure URLs:
   ```
   Allowed Callback URLs: https://your-domain.vercel.app/api/auth/callback
   Allowed Logout URLs: https://your-domain.vercel.app/
   ```
3. Enable Google OAuth2 social connection
4. Note down credentials for environment variables

User provisioning happens app-side on login via `/api/auth/sync-user`; no Auth0 Action or webhook is required.

### 2. Hopsworks Identity Provider

Configure Hopsworks to accept Auth0 users:

1. Access Hopsworks admin panel
2. Navigate to Identity Providers
3. Add OpenID Connect provider:
   - **Client ID**: Your Auth0 Client ID
   - **Client Secret**: Your Auth0 Client Secret
   - **Discovery URL**: `https://[your-tenant].auth0.com/.well-known/openid-configuration`
   - **First Login Flow**: "Create User If Unique"
   - **Sync Mode**: "Force"

### 3. Database Setup

Run the latest schema in Supabase (SQL editor or `psql`):

```sql
-- Apply the canonical schema
\i sql/current_schema.sql;

-- Apply incremental migrations (if current_schema is already applied)
\i sql/001_opencost_integration.sql;
\i sql/002_cleanup_and_extend_billing.sql;
\i sql/003_project_member_roles.sql;
```

Key tables for this release:
- `user_projects` – Maps OpenCost namespaces to users/account owners.
- `usage_daily` – Stores daily cost totals from OpenCost.
- `project_member_roles` – Caches project membership for team auto-assignment.

See [Database Documentation](database/) for schemas and procedures.

### 4. Stripe Configuration

1. Create **metered products** in Stripe for:
   - Compute credits (0.35 USD / credit)
   - Online storage GB-month
   - Offline storage GB-month
   - (Optional) Network egress GB
2. Capture the **Price IDs** and populate both:
   - Environment variables (`STRIPE_PRICE_*` in Vercel)
   - `stripe_products` table in Supabase (see `sql/current_schema.sql` for columns)
3. Configure webhook endpoint:
   - URL: `https://your-domain.vercel.app/api/webhooks/stripe`
   - Events: 
     - `checkout.session.completed`
     - `invoice.payment_succeeded`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`

See [Stripe integration](../integrations/stripe.md) for full Stripe product mappings and example CLI commands.

### 5. Corporate Onboarding (HubSpot)

1. Generate a HubSpot private app token with scopes:
   - `crm.objects.deals.read`
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
2. Set `HUBSPOT_API_KEY` in Vercel (and locally).
3. Ensure HubSpot deals reference valid contacts: the app validates invite emails against deal contacts.
4. Communicate corporate registration links using the format `https://your-domain/?corporate_ref=<dealId>`.

Operational details live in [HubSpot integration](../integrations/hubspot.md).

### 6. Email Invites (Resend)

1. Verify your sending domain in Resend (or configure an equivalent transactional email provider).
2. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` environment variables.
3. Update SPF/DKIM records to improve invite deliverability.

See [Resend integration](../integrations/resend.md) for invite flow, failure handling, and rotation steps.

## Vercel Deployment

### 1. Environment Variables

Set all variables from [.env.example](../.env.example) in Vercel dashboard. Minimum required categories:

- **Auth0**: `AUTH0_*` and allowed URLs.
- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and all `STRIPE_PRICE_*` IDs.
- **Corporate**: `HUBSPOT_API_KEY` (omit if you disable corporate onboarding).
- **Email**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- **Operations**: `CRON_SECRET`, `ADMIN_EMAILS`, default cluster API URL/KEY if bootstrapping manually.

### 2. Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### 3. Configure Cron Jobs

The cron jobs are already configured in `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/usage/collect-opencost",
      "schedule": "0 * * * *"  // Every hour
    },
    {
      "path": "/api/billing/sync-stripe",
      "schedule": "0 3 * * *"  // Daily at 3 AM
    }
  ]
}
```

## Post-Deployment

### 1. Install OpenCost

After Hopsworks installation, configure OpenCost to use Hopsworks' Prometheus:

```yaml
# opencost-values.yaml
opencost:
  prometheus:
    internal:
      enabled: true
      serviceName: hopsworks-release-prometheus-server
      namespaceName: hopsworks
      port: 80
```

```bash
helm repo add opencost https://opencost.github.io/opencost-helm-chart
helm install opencost opencost/opencost \
  --namespace opencost --create-namespace \
  --values opencost-values.yaml

# Verify pods are running (2/2 READY)
kubectl get pods -n opencost
```

### 2. Upload Kubeconfig

For each Hopsworks cluster:
1. Access admin panel at `/admin47392`
2. Navigate to Clusters tab
3. Upload kubeconfig
4. Verify OpenCost shows "Active" status

### 3. Verify System

1. Test Auth0 webhook with a new user signup (ensure Stripe customer is created).
2. Run a Stripe Checkout **Setup** session and confirm `customer.subscription.*` events create the metered subscription.
3. Validate `/api/auth/validate-corporate` with a known HubSpot deal ID.
4. Verify OpenCost connection in the admin panel.
5. Check cron jobs in the Vercel dashboard and confirm hourly rows in `usage_daily`.

### 4. Configure Admin Access

Set `ADMIN_EMAILS` environment variable with comma-separated admin emails.

## Monitoring

### Application Logs
- Vercel Functions logs
- Supabase query logs
- Auth0 logs

### Metrics Collection
- Check hourly OpenCost collection in Vercel logs
- Monitor `usage_daily` table for `opencost_*` columns
- Verify namespace mapping in `user_projects` table
- Verify OpenCost integration status in admin panel

### Billing
- Monitor Stripe dashboard
- Check `usage_daily` table for usage records
- Review failed payments in Stripe
- Verify daily sync job is running

## Troubleshooting

### Build Failures
```bash
# Clear cache and rebuild
rm -rf .next node_modules
npm install
npm run build
```

### Authentication Issues
- Verify Auth0 v3 is being used
- Check callback URLs match exactly
- Ensure Auth0 secret is set

### Metrics Not Collecting
- Verify kubeconfig is valid
- Check pod labels in Kubernetes
- Review cron job logs in Vercel dashboard

### Billing Not Working
- Verify Stripe webhook secret
- Check product/price IDs
- Monitor webhook events in Stripe

## Security Requirements

- Keep environment variables current and verified after each deployment.
- Enforce HTTPS at the edge (Vercel) and within Hopsworks.
- Limit admin access via the `ADMIN_EMAILS` setting.
- Protect webhook endpoints with `STRIPE_WEBHOOK_SECRET`.
- Store `HUBSPOT_API_KEY` and `RESEND_API_KEY` only in secure secrets storage.
- Rotate `CRON_SECRET`, API keys, and Supabase service keys on schedule.
- Ensure database backups and Supabase point-in-time recovery remain enabled.

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Known Issues](../troubleshooting/known-issues.md)
- [Stripe Setup](../integrations/stripe.md)

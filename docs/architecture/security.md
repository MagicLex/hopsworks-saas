# Security Configuration

## Overview
This document outlines the security measures implemented in the hopsworks-managed SaaS middleware. These are MVP-level security controls to protect against common vulnerabilities while maintaining development flexibility.

## Authentication & Authorization

### Auth0 Integration
- OAuth 2.0 authentication via Auth0
- Session management with `@auth0/nextjs-auth0` v3
- User roles stored in database (`is_admin` flag)
- Team member access controlled via `account_owner_id` relationship

### Admin Protection
- Admin endpoints protected by `requireAdmin` middleware
- Checks both Auth0 session and database `is_admin` flag
- Located at `/api/admin/*` routes

## Webhook Security

### Stripe Webhook
- **Endpoint**: `/api/webhooks/stripe`
- **Domain**: `https://run.hopsworks.ai/api/webhooks/stripe`
- **Verification**: Stripe signature validation using `STRIPE_WEBHOOK_SECRET`
- **Events handled**:
  - `checkout.session.completed` - Credit purchases and payment setup
  - `customer.subscription.created/updated/deleted` - Subscription lifecycle
  - `invoice.payment_succeeded/failed` - Payment status
- Auto-assigns clusters after payment confirmation

## CRON Job Security

### OpenCost Collection
- **Endpoint**: `/api/usage/collect-opencost`
- **Schedule**: Hourly (0 * * * *)
- **Authentication**: Bearer token with `CRON_SECRET`
- Collects Kubernetes namespace costs via kubectl

### Stripe Sync
- **Endpoint**: `/api/billing/sync-stripe`
- **Schedule**: Daily at 3 AM (0 3 * * *)
- **Authentication**: Bearer token with `CRON_SECRET`
- Reports usage to Stripe for billing

## Rate Limiting

Implemented using `rate-limiter-flexible` with in-memory storage:

| Endpoint Type | Limit | Window | Applied To |
|--------------|-------|---------|------------|
| Team Invites | 5 requests | 1 hour | `/api/team/invite` |
| Webhooks | 100 requests | 1 minute | `/api/webhooks/*` |
| Billing | 20 requests | 1 minute | `/api/billing/*` |
| General API | 60 requests | 1 minute | All other endpoints |

**Note**: Rate limiting is disabled in development environment.

## TLS/SSL Configuration

### Hopsworks API Communication
Hopsworks clusters use self-signed certificates. To handle this:

- **Production & Development**: SSL verification disabled globally via `NODE_TLS_REJECT_UNAUTHORIZED = '0'`
- Located in `src/lib/hopsworks-api.ts` and `src/lib/hopsworks-team.ts`
- Affects all HTTPS requests during function execution

```javascript
// Required for self-signed certificates
if (typeof process !== 'undefined') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
```

**Why Global (Not Per-Request)**:

Per-request HTTPS agents don't work in Vercel serverless:
- Vercel uses `undici`-based `fetch` which doesn't support `agent` property
- Attempted fix on 2025-11-06 failed immediately in production
- See `docs/troubleshooting/investigations.md` for full details

**Security Note - Acceptable in Vercel Serverless Context**:

Unlike traditional long-running servers, serverless functions are:
1. **Isolated**: Each invocation = new Node.js process
2. **Short-lived**: Process exists only for request duration (~100ms-2s)
3. **Stateless**: No sharing between different user requests
4. **Risk window**: Milliseconds, not hours/days

Additional security layers:
- Communication within private Kubernetes networks
- API key authentication for Hopsworks
- Customer cluster isolation (single-tenant)
- Stripe/Auth0/Supabase remain protected by their own SSL (just during same request window)

**Trade-off**: Accept milliseconds of global SSL bypass per request vs. not supporting self-signed Hopsworks certificates.

**Future**: If needed, migrate to `node-fetch@2` for full SSL control or add proper certificates to Hopsworks infrastructure.

## Error Handling

### Production Error Sanitization
- Generic error messages returned to clients
- Full error details logged server-side only
- Stack traces hidden in production responses
- Specific handling for:
  - 409: Duplicate resources
  - 404: Not found
  - 400: Validation errors
  - 500: Generic server errors

## Sensitive Data Storage

### Database Security
- Supabase service role key for admin operations (bypasses RLS)
- Sensitive fields:
  - `stripe_customer_id` - Payment provider reference
  - `api_key` - Hopsworks cluster API keys
  - `kubeconfig` - Kubernetes cluster access (stored as text)

### Row Level Security (RLS)

All tables have RLS enabled with policies enforcing data isolation. Service role (used in API endpoints) bypasses RLS.

**Tables with RLS Policies**:

| Table | Policies | Description |
|-------|----------|-------------|
| `users` | 3 policies | Users can view own profile, team members (if owner), and their account owner |
| `usage_daily` | 1 policy | Users can only view their own usage records |
| `user_credits` | 1 policy | Users can only view their own credit balance |
| `user_hopsworks_assignments` | 1 policy | Users can only view their own cluster assignment |
| `team_invites` | 2 policies | Users can view invites they sent or received |
| `hopsworks_clusters` | 1 policy | Users can only view their assigned cluster |
| `stripe_products` | 1 policy | Public read access for pricing information |
| `user_projects` | 1 policy | Users can only view their own project mappings |
| `project_member_roles` | 2 policies | Members view own roles, owners view team member roles |
| `health_check_failures` | 3 policies | Admin-only access, service role can insert |

**Database Views**:

All views (`account_usage`, `account_usage_summary`, `team_members`, `pending_role_syncs`, `project_members_detail`) have NO public/authenticated/anon grants. Access is restricted to service role only through API endpoints.

**Defense in Depth**:
- RLS policies prevent unauthorized data access even if client-side code is compromised
- API endpoints use service role which bypasses RLS
- Anon key exists but is unused in codebase
- Even if anon key is leaked, RLS prevents data exposure

**Adding New Tables**:

When creating new tables, always:
1. Enable RLS: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`
2. Create SELECT policies based on ownership/team relationships
3. Service role handles INSERT/UPDATE/DELETE (no policies needed)
4. For views: `REVOKE ALL ON view_name FROM authenticated, anon, public;`

### Environment Variables
Required security-related environment variables:
```bash
# Authentication
AUTH0_SECRET            # Auth0 session encryption
AUTH0_CLIENT_SECRET     # OAuth client secret

# Database
SUPABASE_SERVICE_ROLE_KEY  # Admin database access

# Stripe
STRIPE_SECRET_KEY          # Payment processing
STRIPE_WEBHOOK_SECRET      # Webhook verification

# Cron Jobs
CRON_SECRET               # Vercel cron authentication

# Environment
NODE_ENV                  # production/development
```

## Health Monitoring

### Health Check Endpoint
- **Endpoint**: `/api/health`
- **Public Access**: Yes (for monitoring services)
- **Checks**:
  - API availability
  - Database connection
  - Auth0 configuration
- **Status Codes**:
  - 200: Healthy
  - 503: Degraded/Unhealthy

## Security Headers

Handled by Vercel platform defaults:
- X-Frame-Options
- X-Content-Type-Options
- Strict-Transport-Security
- Content-Security-Policy (basic)

## Known Limitations (MVP)

- **Kubeconfig Storage**: Stored as plain text in Supabase; access is limited to service-role operations, so rotate keys and monitor audit logs.
- **Webhook Verification**: Uses shared-secret comparison; rotate `STRIPE_WEBHOOK_SECRET` on schedule.
- **Rate Limiting**: In-memory limiter does not extend across Vercel regions; rely on monitoring to detect bursts.
- **Audit Logging**: Console logs only; export Vercel logs for retention.
- **API Versioning**: Single version; coordinate changes directly with consumers.

## Deployment Security

- Confirm all environment variables, secrets, and API keys are set before promotion.
- Generate strong values for `CRON_SECRET`, Supabase service keys, and webhook secrets.
- Validate webhook endpoints in Auth0 and Stripe dashboards after each deploy.
- Keep TLS validation enabled when communicating with Hopsworks and Stripe.
- Review admin user assignments regularly and prune unused accounts.

## Incident Response

In case of security issues:

1. **Immediate Actions**:
   - Rotate affected secrets
   - Review access logs
   - Disable compromised accounts

2. **Investigation**:
   - Check Vercel function logs
   - Review Supabase audit logs
   - Analyze Auth0 logs

3. **Recovery**:
   - Update affected user sessions
   - Reset user passwords if needed
   - Notify affected users per requirements

## Regular Security Tasks

### Weekly
- Review admin access list
- Check for unusual API usage patterns

### Monthly
- Rotate CRON_SECRET
- Review rate limiting effectiveness
- Update dependencies for security patches

### Quarterly
- Full security audit
- Penetration testing (when applicable)
- Review and update this documentation

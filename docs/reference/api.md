# API Reference

## Authentication

### User Authentication (Auth0)
All user endpoints require Auth0 authentication:
```typescript
import { withApiAuthRequired } from '@auth0/nextjs-auth0';

export default withApiAuthRequired(async function handler(req, res) {
  // Handler code
});
```

### Admin Authentication
Admin endpoints require additional checks:
```typescript
import { requireAdmin } from '@/middleware/adminAuth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, async (req, res) => {
    // Admin-only handler code
  });
}
```

## User Endpoints

### GET /api/user/hopsworks-info
Get current user's Hopsworks information.

**Response:**
```json
{
  "hasCluster": true,
  "clusterName": "shared-prod-1",
  "clusterEndpoint": "https://prod.hopsworks.ai",
  "hasHopsworksUser": true,
  "hopsworksUser": {
    "username": "hops_user_123",
    "email": "user@example.com",
    "accountType": "BILLING_ACCOUNT",
    "status": 2,
    "maxNumProjects": 5,
    "numActiveProjects": 3,
    "activated": "2025-02-01T12:34:56.000Z"
  },
  "projects": [{
    "id": 123,
    "name": "churn-modeling",
    "owner": "hops_user_123",
    "created": "2025-01-15T08:00:00.000Z"
  }]
}
```

### GET /api/usage
Get user's current month usage totals.

**Response:**
```json
{
  "cpuHours": 42.75,
  "gpuHours": 0,
  "ramGbHours": 12.8,
  "storageGB": 55.12,
  "featureGroups": 3,
  "modelDeployments": 0,
  "apiCalls": 0,
  "featureStoreApiCalls": 0,
  "modelInferenceCalls": 0,
  "currentMonth": "2025-02",
  "lastUpdate": "2025-02-07T03:10:02.123Z",
  "projectBreakdown": {
    "churn-modeling": {
      "cpuHours": 12.4,
      "gpuHours": 0,
      "ramGBHours": 3.2,
      "cpuEfficiency": 0.82,
      "ramEfficiency": 0.71,
      "lastUpdated": "2025-02-07T03:10:02.123Z"
    }
  }
}
```

### GET /api/billing
Get billing information and usage summary.

**Side effects (lazy transitions):**
- If `billing_mode = 'free'` and payment method detected → upgrades to `postpaid`, sets `maxNumProjects = 5`
- If `billing_mode = 'postpaid'` and no payment method/subscription → downgrades to `free`, sets `maxNumProjects = 1`, sends alert

**Response:**
```json
{
  "billingMode": "free",
  "hasPaymentMethod": false,
  "paymentMethodDetails": null,
  "subscriptionStatus": null,
  "prepaidEnabled": false,
  "downgradeDeadline": "2025-02-14T12:00:00.000Z",
  "downgradeInfo": {
    "deadline": "2025-02-14T12:00:00.000Z",
    "projectCount": 3
  },
  "currentUsage": {
    "cpuHours": "120.50",
    "gpuHours": "0.00",
    "ramGbHours": "240.00",
    "onlineStorageGB": "2MB",
    "offlineStorageGB": "50.25GB",
    "currentMonth": {
      "computeCost": 12.05,
      "storageCost": 5.03,
      "total": 17.08
    }
  },
  "creditBalance": null,
  "invoices": [],
  "historicalUsage": [
    {
      "date": "2025-02-06",
      "cpu_hours": 12.5,
      "gpu_hours": 0,
      "storage_gb": 48.1,
      "total_cost": 6.12
    }
  ],
  "rates": {
    "cpu_hour": 0.175,
    "gpu_hour": 3.5,
    "ram_gb_hour": 0.0175,
    "storage_online_gb": 0.5,
    "storage_offline_gb": 0.03,
    "network_egress_gb": 0.14
  }
}
```

### GET /api/pricing
Public pricing snapshot consumed by landing pages.

**Response:**
```json
{
  "compute_credits": 0.35,
  "cpu_hour": 0.175,
  "gpu_hour": 3.5,
  "ram_gb_hour": 0.0175,
  "storage_online_gb": 0.5,
  "storage_offline_gb": 0.03,
  "network_egress_gb": 0.14
}
```

### POST /api/auth/validate-corporate
Validate a HubSpot deal before corporate signup.

**Request:**
```json
{
  "dealId": "16586605456",
  "checkDealOnly": true
}
```

**Response (valid deal):**
```json
{
  "valid": true,
  "dealName": "ACME Annual Platform",
  "companyName": "ACME Corp",
  "companyLogo": "https://logo.clearbit.com/acme.com"
}
```

### GET /api/user/corporate-info
Return company info for prepaid/corporate users.

**Response:**
```json
{
  "isCorporate": true,
  "corporateRef": "16586605456",
  "companyName": "ACME Corp",
  "companyLogo": "https://logo.clearbit.com/acme.com",
  "companyDomain": "acme.com"
}
```

### POST /api/billing/start-free
Switch user to free tier (for existing postpaid users without payment method).

**Request:** Empty POST body

**Response:**
```json
{
  "success": true,
  "billingMode": "free",
  "clusterAssigned": true,
  "clusterId": 1
}
```

**Notes:**
- Only works for postpaid users without active subscription
- Sets `billing_mode = 'free'`
- Assigns cluster with `maxNumProjects = 1`
- Team members cannot call this endpoint

### POST /api/alerts/downgrade
Internal endpoint for sending downgrade alerts.

**Request:**
```json
{
  "userId": "auth0|...",
  "email": "user@example.com",
  "projectCount": 3,
  "deadline": "2025-02-14T12:00:00.000Z"
}
```

**Response:**
```json
{
  "success": true
}
```

**Notes:**
- Called internally by `/api/billing` during lazy downgrade
- Sends email to user explaining they need to delete projects
- Sends alert to admin email (if `ADMIN_ALERT_EMAIL` configured)

### POST /api/user/accept-terms
Save user's acceptance of Terms of Service, AUP, and Privacy Policy.

**Request:**
```json
{
  "marketingConsent": true  // optional, defaults to false
}
```

**Response:**
```json
{
  "success": true
}
```

**Notes:**
- Sets `terms_accepted_at` to current timestamp
- Stores `marketing_consent` boolean
- Called from billing-setup page when user accepts terms
- Team members accept terms during invite flow (handled by `/api/team/join`)

## Team Management Endpoints

### GET /api/team/members
Get team members.

**Response:**
```json
{
  "account_owner": {
    "id": "auth0|...",
    "email": "owner@example.com",
    "name": "Owner Name",
    "created_at": "2023-12-10T09:00:00.000Z",
    "stripe_customer_id": "cus_123"
  },
  "team_members": [{
    "id": "auth0|...",
    "email": "member@example.com",
    "name": "Member Name",
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_login_at": "2025-02-06T11:24:00.000Z",
    "hopsworks_username": "member123",
    "status": "active"
  }],
  "is_owner": true
}
```

### POST /api/team/invite
Invite a team member.

**Request:**
```json
{
  "email": "newmember@example.com",
  "projectRole": "Data scientist",
  "autoAssignProjects": true
}
```

**Response:**
```json
{
  "message": "Invite sent successfully",
  "invite": {
    "id": "uuid",
    "email": "newmember@example.com",
    "expires_at": "2024-01-08T00:00:00.000Z",
    "invite_url": "https://your-domain/team/accept-invite?token=...",
    "project_role": "Data scientist",
    "auto_assign_projects": true
  }
}
```

### GET /api/team/accept-invite
Get invite details by token.

**Query Parameters:**
- `token` - Invite token

**Response:**
```json
{
  "email": "invited@example.com",
  "invitedBy": "owner@example.com",
  "expiresAt": "2024-01-08T00:00:00.000Z",
  "loginUrl": "/api/auth/login?returnTo=..."
}
```

### POST /api/team/join
Accept an invite and join the team.

**Request:**
```json
{
  "token": "invite-token-from-email"
}
```

**Response:**
```json
{
  "message": "Successfully joined team",
  "account_owner_id": "auth0|owner",
  "cluster_assigned": true,
  "projects_assigned": [
    "churn-modeling",
    "fraud-detection"
  ]
}
```

## Admin Endpoints

All admin routes require an Auth0 session with `is_admin = true`.

### GET /api/admin/users
List every user with associated projects, costs, and cluster assignments (used by `/admin47392`).

### Usage Health
- `GET /api/admin/usage/check-opencost` – Probe OpenCost connectivity for the active cluster.
- `GET /api/admin/usage/check-database` – Verify most recent `usage_daily` rows.
- `POST /api/admin/usage/collect` – Manually trigger the hourly ingestion (mirrors cron).
- `GET /api/admin/usage/[userId]` – Detailed per-namespace usage history for a single user.

### Project & Namespace Sync
- `POST /api/admin/sync-username` – Refresh cached Hopsworks username/ID for a user.
- `GET|POST|PUT /api/admin/project-roles` – Inspect and manage project membership (adds members, bulk syncs, etc.).

**Note:** Project syncing is handled automatically by the cron job at `/api/cron/sync-projects` which runs periodically.

### Cluster Management
- `GET|POST|PUT /api/admin/clusters` – List, create, or update cluster records.
- `POST /api/admin/clusters/update-kubeconfig` – Upload/replace kubeconfig for a cluster.
- `POST /api/admin/test-opencost` – Validate OpenCost connectivity for a specific cluster ID.

### Billing Utilities
- `POST /api/admin/fix-missing-subscriptions` – Repair Stripe subscription state (idempotent helper).
- `GET /api/admin/billing` – Aggregate billing metrics for admins.

## Webhook Endpoints

### POST /api/webhooks/stripe
Handles Stripe webhook events:
- `checkout.session.completed` (mode `setup`): Payment method setup completion
- `customer.subscription.created|updated|deleted`: Subscription lifecycle
- `invoice.payment_succeeded|failed`: Invoice status notifications

## Cron Endpoints

### POST|GET /api/usage/collect-opencost
Collects cost data from OpenCost for all clusters.
- Runs every hour (`:00`)
- Requires `CRON_SECRET` header in production
- Uses Kubernetes API proxy to query OpenCost securely
- Updates `usage_daily` with accumulated costs
- Maps namespaces to users via `user_projects` table

### POST|GET /api/billing/sync-stripe
Reports daily usage data to Stripe for metered billing.
- Runs daily at 3 AM via cron
- Reports usage for postpaid customers with active subscriptions
- Creates meter events in Stripe for CPU, storage, and API usage
- Marks records as `reported_to_stripe = true`

## Error Handling

All endpoints return consistent error responses:
```json
{
  "error": "Error message",
  "details": "Additional context (in development)"
}
```

Common status codes:
- `400`: Bad request
- `401`: Unauthorized
- `403`: Forbidden (not admin or team member accessing billing)
- `404`: Not found
- `500`: Server error

## Rate Limiting

`middleware/rateLimit.ts` applies per-endpoint limits:
- Team invites: 5 requests per hour per account owner.
- Webhooks: 100 requests per minute to guard against replay storms.
- Billing routes: 20 requests per minute to prevent dashboard abuse.
- Other endpoints fall back to a default 60 requests per minute.

## Hopsworks API Integration

Our backend integrates with Hopsworks clusters via admin API keys. All Hopsworks operations use wrappers in `src/lib/hopsworks-api.ts` that handle API quirks correctly.

### Key Implementation Details

1. **User IDs are numeric**: Hopsworks API requires numeric user IDs (e.g., `10181`), NOT usernames. Our wrappers handle this transparently.

2. **Always use `expand=creator`**: Project queries use `?expand=creator` to avoid N+1 API calls.

3. **No direct lookups**: Hopsworks has no endpoints for direct project/user lookups by name. We fetch all resources and filter client-side.

See [Hopsworks API Reference](./hopsworks-api.md) for detailed endpoint documentation and wrapper usage examples.

## Related Documentation

- [Hopsworks API Reference](./hopsworks-api.md)
- [Architecture Overview](../ARCHITECTURE.md)
- [Database Documentation](database/)
- [Billing System](../billing.md)

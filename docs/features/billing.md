# Billing System

## Overview

The billing system tracks resource usage via OpenCost and applies our pricing model. We support three billing modes: **free** (limited tier), **postpaid** (Stripe), and **prepaid** (enterprise/invoice).

## Architecture

```
OpenCost (usage units) → Our Pricing → Database → Stripe (postpaid) or Invoice (prepaid)
```

### Key Principles
- **OpenCost** collects raw usage metrics (CPU hours, GPU hours, RAM GB-hours)
- **We apply pricing** using our rate card
- **Stripe handles billing** for postpaid customers
- **Manual invoicing** for prepaid/enterprise customers

## Pricing Model

### Current Resource Rates
Rates live in `src/config/billing-rates.ts` and represent the single source of truth for both SaaS and prepaid customers.

| Resource                | Credits | USD Equivalent |
|-------------------------|---------|----------------|
| 1 vCPU hour             | 0.50    | $0.175         |
| 1 GPU hour              | 10.00   | $3.50          |
| 1 GB RAM hour           | 0.05    | $0.0175        |
| 1 GB-month online storage | 1.4286 | $0.50          |
| 1 GB-month offline storage | 0.0857 | $0.03         |
| 1 GB network egress     | 0.40    | $0.14          |

### Credits as an Internal Unit
- Credits keep pricing consistent between live Stripe billing and prepaid invoices.
- `calculateCreditsUsed()` converts OpenCost usage into credits; `calculateDollarAmount()` multiplies by `$0.35/credit`.
- Credits are **not** sold directly in the app; corporate customers settle invoices off-platform using the reported credit totals.

### Billing Modes

#### Free (Default for New Users)
- **Registration**: Standard signup → lands on `/billing-setup` → click "Start for Free"
- **Payment**: None required (no Stripe customer)
- **Cluster access**: Immediate upon registration
- **Projects**: **1 project only** (`maxNumProjects = 1`)
- **Quotas**: K8s resource quotas applied via external cronjob (`quotas-bookkeeper`)
- **Usage tracking**: For visibility only, not billed
- **Database**: `billing_mode = 'free'`
- **Upgrade path**: Add payment method → automatic upgrade to postpaid (5 projects)

#### Downgrade Flow (Postpaid → Free)
When a postpaid user removes their payment method:
1. `/api/billing` detects `postpaid` + no payment method → sets `billing_mode = 'free'`
2. `maxNumProjects` reduced to 1
3. If user has >1 project: `downgrade_deadline` set to 7 days from now
4. **Modal shown**: "You have X projects. Delete all but 1 within Y days or account suspended."
5. Modal links directly to project settings pages for deletion
6. Alert sent to team (email/webhook)
7. After deadline: user suspended until compliant

#### Prepaid (Corporate/Enterprise)
- **Registration**: Via special link with `?corporate_ref=deal_id`
- **Payment**: Invoice/wire transfer (handled outside platform)
- **Stripe**: Not required
- **Cluster access**: Immediate upon registration
- **Projects**: 5 projects immediately available
- **Usage tracking**: For reporting only, not billing
- **Database**: `billing_mode = 'prepaid'`

#### Postpaid (SaaS/Self-Service)
- **Registration**: Standard signup flow
- **Payment**: Credit card via Stripe (required for cluster access)
- **First login flow**:
  1. Auth0 callback → `sync-user` creates user with `billing_mode = 'postpaid'`
  2. `syncResult.needsPayment = true` → redirect to `/billing-setup`
  3. User accepts terms and sets up payment via Stripe Checkout
  4. Stripe webhook creates metered subscription
  5. User redirected to `/dashboard`
- **Cluster access**: Assigned during `sync-user` (Hopsworks user created)
- **Projects**: 5 projects available after cluster assignment
- **Usage tracking**: `/api/billing/sync-stripe` reports daily totals via Stripe Billing Meter Events
- **Database flags**: `billing_mode = 'postpaid'`; `stripe_subscription_id` links to the live plan

#### Prepaid (Promo Code)
- **Registration**: Via `?promo=PROMO_CODE` URL parameter
- **Payment**: None required
- **First login flow**:
  1. Promo code validated via `/api/auth/validate-promo`
  2. Auth0 callback → `sync-user` creates user with `billing_mode = 'prepaid'`
  3. `syncResult.needsPayment = false` → redirect to `/billing-setup` for terms only
  4. User accepts terms → redirect to `/dashboard`
- **Cluster access**: Immediate upon registration
- **Projects**: 5 projects immediately available
- **Database flags**: `billing_mode = 'prepaid'`; `promo_code` stores the code used

## Storage Billing Model

> ⚠️ **IMPORTANT: Storage is billed as GB-month, not daily snapshots!**

Storage billing uses the **prorated daily model** (same as AWS S3, GCP, Azure):

```
Daily report to Stripe = storage_snapshot_gb / 30
Stripe SUM over month  = correct GB-month value
```

**Example:**
- User has 1.2 GB stored consistently
- Daily report: 1.2 / 30 = 0.04 GB
- After 30 days, Stripe sums: 0.04 × 30 = **1.2 GB-month** ✓

**If storage changes mid-month:**
- Day 1-15: 1 GB → reports 0.033/day = 0.5 GB
- Day 16-30: 2 GB → reports 0.067/day = 1.0 GB
- Total: **1.5 GB-month** (correctly prorated)

> ⚠️ **Never send raw daily snapshots with SUM aggregation** - that would bill 30x too much!

---

## Stripe Integration

### Products and Pricing
We use Stripe's metered billing with the following products:

| Product Type | Product ID | Price ID | Unit Price |
|--------------|------------|----------|------------|
| Compute Credits | prod_SyouWf2n0ZTrgl | price_1S2rGbBVhabmeSATRqsYZHUm | $0.35/credit |
| Online Storage | prod_SyowZZ5KSoxZZR | price_1S2rINBVhabmeSATVcqyroBz | $0.50/GB-month |
| Offline Storage | prod_SyoxUy6KrEirtL | price_1S2rJLBVhabmeSATjpqLQgIn | $0.03/GB-month |

### Webhook Configuration
- Endpoint: `https://run.hopsworks.ai/api/webhooks/stripe`
- Events monitored:
  - `checkout.session.completed`
  - `customer.subscription.created/updated/deleted`
  - `invoice.payment_succeeded/failed`

## Data Flow

### 1. Usage Collection (Hourly)

**See**: [OpenCost Collection Documentation](../operations/opencost-collection.md) for complete flow details.

```typescript
import { calculateCreditsUsed, calculateDollarAmount } from '@/config/billing-rates';

// OpenCost provides usage metrics per namespace
const allocation = {
  namespace: 'mlproject',
  cpuCoreHours: 24.5,
  gpuHours: 0,
  ramByteHours: 137_438_953_472
};

// Convert RAM byte-hours to GB-hours
const ramGbHours = allocation.ramByteHours / (1024 ** 3);

// Convert usage into credits and then USD
const creditsUsed = calculateCreditsUsed({
  cpuHours: allocation.cpuCoreHours,
  gpuHours: allocation.gpuHours,
  ramGbHours
});

const hourlyTotalCost = calculateDollarAmount(creditsUsed); // -> $4.29
```

**Multi-cluster**: The collection job processes all active clusters independently. Each namespace is verified to belong to a user on the correct cluster to prevent cross-cluster billing errors.

### 2. Cost Storage
```sql
-- usage_daily table stores both usage and calculated costs
opencost_cpu_hours: 24.5        -- Usage from OpenCost
opencost_gpu_hours: 0
opencost_ram_gb_hours: 128
 total_cost: 4.29                -- Our calculated cost
```

### 3. Billing

**Prepaid Users:**
- See costs in dashboard
- Receive monthly usage reports
- Pay via invoice

**Postpaid Users:**
- Usage reported to Stripe daily
- Stripe calculates final invoice
- Automatic payment processing

## Database Schema

### usage_daily
Stores daily usage and costs:
```sql
-- Usage metrics (from OpenCost)
opencost_cpu_hours DECIMAL(10,4)
opencost_gpu_hours DECIMAL(10,4)  
opencost_ram_gb_hours DECIMAL(10,4)

-- Storage metrics
online_storage_gb DECIMAL(10,4)
offline_storage_gb DECIMAL(10,4)

-- Calculated costs (our pricing)
total_cost DECIMAL(10,2)

-- Project breakdown
project_breakdown JSONB  -- Per-project usage details
```

## API Endpoints

### User Facing
- `GET /api/billing` – Billing overview, Stripe invoices, rate card.
- `GET /api/usage` – Current-month usage totals and project breakdown.

### Internal / Cron
- `POST|GET /api/usage/collect-opencost` – Hourly OpenCost ingestion.
- `POST|GET /api/billing/sync-stripe` – Daily Stripe Meter Events sync.

### Admin
- `GET /api/admin/users` – Usage totals by user (with project breakdown).
- `GET /api/admin/usage/check-opencost` – Validate OpenCost connectivity.
- `GET /api/admin/usage/check-database` – Validate recent usage rows.
- `POST /api/admin/usage/collect` – Manual ingestion trigger.

## Stripe Integration (Postpaid Only)

### Setup
1. Create metered products in Stripe Dashboard
2. Set price IDs in environment variables
3. Configure webhook endpoint

### Daily Reporting
```javascript
// Report usage to Stripe for billing
await stripe.billing.meterEvents.create({
  event_name: 'cpu_usage',
  payload: {
    value: cpuHours,
    stripe_customer_id: customerId
  }
});
```

### Webhook Events
- `customer.subscription.created` - New subscription
- `invoice.payment_succeeded` - Payment received
- `invoice.payment_failed` - Payment failed

## Implementation Files

### Core Files
- `src/config/billing-rates.ts` - Pricing configuration
- `src/pages/api/usage/collect-opencost.ts` - Usage collection
- `src/pages/api/billing/sync-stripe.ts` - Stripe usage reporting
- `src/pages/api/billing.ts` - User billing API
- `src/pages/api/pricing.ts` - Public pricing snapshot used on marketing pages

### Admin Files
- `src/pages/admin47392.tsx` - Admin dashboard
- `src/pages/api/admin/users.ts` - User management
- `src/pages/api/admin/usage/*` - Usage health checks and manual triggers

## Cron Jobs

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/sync-projects",
      "schedule": "*/30 * * * *"  // Every 30 minutes - syncs project mappings
    },
    {
      "path": "/api/usage/collect-opencost",
      "schedule": "0 * * * *"  // Every hour - collects usage metrics
    },
    {
      "path": "/api/billing/sync-stripe",
      "schedule": "0 3 * * *"   // Daily at 3 AM - reports to Stripe
    }
  ]
}
```

## Environment Variables

```bash
# Stripe (postpaid only)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_CPU_HOURS=price_...
STRIPE_PRICE_GPU_HOURS=price_...
STRIPE_PRICE_RAM_GB_HOURS=price_...
STRIPE_PRICE_STORAGE_ONLINE=price_...
STRIPE_PRICE_STORAGE_OFFLINE=price_...
STRIPE_PRICE_NETWORK_EGRESS=price_...


# Corporate onboarding (HubSpot)
HUBSPOT_API_KEY=pat-...

# Team invites (Resend)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=no-reply@example.com

# Cron authentication
CRON_SECRET=...
```

## Admin Features

Access at `/admin47392`:

### Billing Overview
- View all users with total PAYG amounts
- Today's costs per user
- Expandable project breakdown
- Shows usage (CPU/GPU/RAM hours) and costs

### Manual Actions
- "Update Usage Data" - Trigger collection manually
- View collection results and errors

## SQL Queries

```sql
-- User's current month cost
SELECT 
  SUM(total_cost) as month_total
FROM usage_daily
WHERE user_id = 'auth0|123'
AND date >= date_trunc('month', CURRENT_DATE);

-- Project breakdown for today
SELECT 
  project_breakdown
FROM usage_daily
WHERE user_id = 'auth0|123'
AND date = CURRENT_DATE;

-- Prepaid balance
SELECT 
  total_purchased - total_used as balance
FROM user_credits
WHERE user_id = 'auth0|123';
```

## Testing

### Test Prepaid Billing
1. Set user to `billing_mode: 'prepaid'`
2. Run usage collection
3. Verify costs appear but no Stripe activity

### Test Postpaid Billing
1. Set user to `billing_mode: 'postpaid'`
2. Ensure Stripe subscription exists
3. Run usage collection
4. Run Stripe reporting
5. Check Stripe dashboard for usage records

## Storage Metering (Implemented)

### Current Status ✅
Storage tracking is **fully implemented** using batch queries:
- `online_storage_gb` - RonDB/NDB storage (online feature store)
- `offline_storage_gb` - HDFS storage (datasets, training data)

### Implementation Architecture

**Batch Query Approach:**
- Single HDFS query for all projects: `hdfs dfs -du /Projects`
- Single NDB query for all projects via `ndbinfo.table_memory_usage`
- Runs hourly as part of the OpenCost collection job
- **Two-pass collection**: Pass 1 bills compute + storage for namespaces with
  active pods. Pass 2 bills storage-only for projects that have HDFS/NDB data
  but no running workloads that hour. This ensures storage is billed every
  hour (prorated at `storageGB / 720 * rate`) regardless of compute activity.
- ~3-5 seconds total overhead per run
- Scales to ~500-1000 projects before timeout concerns

**Location:**
- Implementation: `src/lib/opencost-direct.ts`
  - `getOfflineStorageBatch()` - HDFS batch query
  - `getOnlineStorageBatch(mysqlPassword)` - NDB batch query
- Integration: Windmill `f/opencost/collect_usage` → Docker sidecar (primary), `src/pages/api/usage/collect-opencost.ts` (Vercel fallback)
- Storage costs included in `total_cost` calculation

### Data Collection

**Offline Storage (HDFS):**
```typescript
// Single command queries all projects
kubectl exec namenode-pod -- /srv/hops/hadoop/bin/hdfs dfs -du /Projects

// Example output:
// 600855341  600855341  /Projects/testme
// 4521       4521       /Projects/mahmoud
```

Filtering:
- Skips projects with < 10KB (Hopsworks metadata only)
- Returns Map<project_name, bytes>

**Online Storage (NDB):**
```sql
SELECT
  database_name AS project,
  SUM(in_memory_bytes + disk_memory_bytes) AS bytes
FROM ndbinfo.table_memory_usage
GROUP BY database_name
HAVING bytes > 0
```

Filtering:
- Excludes system databases: `mysql`, `heartbeat`, `hops`, `hopsworks`, `metastore`
- Skips allocations < 100KB
- Returns Map<project_name, bytes>

### Cost Calculation

Storage costs are **pro-rated hourly** from monthly rates, billed **every hour**
(not only when compute is active):

```typescript
const HOURS_PER_MONTH = 30 * 24; // 720 hours

const hourlyCost = calculateCreditsUsed({
  onlineStorageGb: onlineGB / HOURS_PER_MONTH,
  offlineStorageGb: offlineGB / HOURS_PER_MONTH
});
```

The collector runs two passes per cluster:
1. **Pass 1 (Compute + Storage):** Namespaces reported by OpenCost (active pods):
   bills CPU/GPU/RAM hours and storage together.
2. **Pass 2 (Storage-only):** Projects found in HDFS/NDB batch queries that were
   not in Pass 1: bills storage with zero compute. This covers projects where
   data persists but the user's workloads are idle.

**Example (testme project):**
- Offline: 574 MB (0.56 GB) → $0.0168/month → $0.000023/hour
- Online: 0.63 MB (0.0006 GB) → $0.0003/month → ~$0/hour
- **Total storage cost:** $0.0171/month ($0.000024/hour)

### Database Schema

**hopsworks_clusters table:**
```sql
ALTER TABLE hopsworks_clusters
ADD COLUMN IF NOT EXISTS mysql_password TEXT;
```

Required for NDB queries. Store the MySQL root password from:
```bash
kubectl get secret -n hopsworks mysql-users-secrets \
  -o jsonpath='{.data.hopsworksroot}' | base64 -d
```

**usage_daily table:**
Storage values are **snapshots** (not accumulated):
```sql
online_storage_gb DECIMAL(10,4)   -- Latest GB at collection time
offline_storage_gb DECIMAL(10,4)  -- Latest GB at collection time
```

### Caveats & Known Issues

⚠️ **NDB Metrics Include Metadata:**
- `ndbinfo.table_memory_usage` reports total allocated memory (in-memory + disk)
- May include table metadata, indexes, and overhead
- More accurate than `memory_per_fragment` for billing purposes
- Aggregates at table level rather than fragment level

⚠️ **System Database Filtering:**
- NDB query returns system databases (hopsworks, metastore, etc.)
- Filtered in code - do NOT bill users for these
- HDFS doesn't have this issue (user projects isolated in `/Projects/`)

⚠️ **Empty Projects:**
- Projects with only Hopsworks metadata (~4.5 KB) are filtered out
- HDFS threshold: 10 KB
- NDB threshold: 100 KB

### Performance & Scale

**Current Performance:**
- HDFS query: ~1-2 seconds (100+ projects)
- NDB query: ~1-2 seconds (100+ projects)
- Total overhead: ~3-5 seconds per hourly run

**Scale Limits:**
- Tested: 3 projects with data
- Expected: 500-1000 projects before timeout issues
- Beyond that: migrate to queue-based architecture

### Testing

Manual test script:
```bash
# See docs/reference/metering-queries.md for full queries
# Or run the collection endpoint manually:
curl -X POST https://yourapp.vercel.app/api/usage/collect-opencost \
  -H "Authorization: Bearer $CRON_SECRET"
```

Verify in Supabase:
```sql
SELECT
  user_id,
  date,
  online_storage_gb,
  offline_storage_gb,
  total_cost
FROM usage_daily
WHERE date = CURRENT_DATE
ORDER BY total_cost DESC;
```

### Migration Steps

Before deploying:

1. **Run SQL migration:**
```sql
-- In Supabase SQL editor:
ALTER TABLE hopsworks_clusters
ADD COLUMN IF NOT EXISTS mysql_password TEXT;
```

2. **Add MySQL password to cluster:**
```sql
UPDATE hopsworks_clusters
SET mysql_password = '<password_from_secret>'
WHERE status = 'active';
```

3. **Deploy updated code**

4. **Monitor first run:**
Check logs for "Collecting storage metrics..." and verify no errors

## Future Improvements

- **Storage guardrails** – Fail loudly (or alert) if `getOnlineStorageBatch` comes back empty to catch missing RonDB credentials before storage goes to $0.
- **Orphan namespace monitoring** – Log/alert when a namespace stays unresolved across runs so projects never slip through unbilled.
- **Collection mutex** – Add a per-cluster lock (Supabase flag, Redis, etc.) to prevent concurrent cron executions from double-counting usage.
- **Namespace + cluster key** – Extend `user_projects` uniqueness to `(namespace, hopsworks_cluster_id)` so duplicate project names across clusters don’t overwrite each other.
- **Hourly cross-checks** – Schedule a “trust-but-verify” job that compares raw OpenCost totals with what landed in `usage_daily` and records any deltas.
- **Stripe health tracking** – Store the most recent `/api/billing/sync-stripe` payload per user to make end-to-end billing audits trivial.

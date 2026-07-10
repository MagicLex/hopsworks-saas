# Architecture Overview

## Tech Stack
- **Frontend**: Next.js 15.4 (Pages Router), TypeScript
- **UI**: tailwind-quartz component library
- **Auth**: Auth0 SDK v3 (MUST use v3, not v4)
- **Database**: Supabase (PostgreSQL)
- **Payments**: Stripe metered billing (live)
- **Corporate CRM**: HubSpot (deal validation for prepaid onboarding)
- **Email**: Resend for invite delivery
- **Hosting**: Vercel with scheduled cron jobs
- **Cost Tracking**: OpenCost inside the Kubernetes cluster

## Key Flows

### Authentication, Sync & Onboarding State Machine

The app uses a centralized sync flow via `AuthContext`, then routes through a
server-resolved onboarding state:

1. **Auth0 callback** → user exists in AuthContext
2. **AuthContext** sets `syncing = true`, calls `/api/auth/sync-user` (creates/updates the DB user)
3. **OnboardingContext** fetches `GET /api/user/onboarding` once synced. The
   server derives the state with `resolveOnboardingState()` (`src/lib/onboarding.ts`)
   from the Auth0 session (`email_verified`), the `users` row
   (`deleted_at`, `status`, `terms_accepted_at`, `billing_mode`,
   `stripe_subscription_id`) and `user_hopsworks_assignments`. It is never stored.
4. **OnboardingGate** (`_app.tsx`) renders the current step; pages only mount
   when the state is `ready`, so page hooks never fire against a half-created account.
5. **BillingContext / CorporateContext** wait for the onboarding resolution and
   skip fetching when no account row exists.

States: `unauthenticated → email_unverified → needs_account → needs_payment
(postpaid only) → assigning_cluster → ready`, plus `suspended` and `deleted`
branches. `needs_account`, `needs_payment` and `suspended` route to
`/billing-setup`; `email_unverified` and `assigning_cluster` render dedicated
gate steps (`assigning_cluster` polls bounded, with a retry that POSTs
`{action: "retry_cluster"}` to `/api/user/onboarding`, an idempotent call).

Corporate/promo refs arrive as query params on `/api/auth/{login,signup}` and
are persisted in the `hw_signup_refs` httpOnly cookie, consumed and cleared by
sync-user at account creation. They survive tab changes and the
email-verification detour.

### User Signup (Self-Service SaaS - Postpaid)
1. User clicks signup on landing page → Auth0 hosted login
2. Auth0 callback → `/api/auth/sync-user` creates the user (`billing_mode = NULL`)
3. Onboarding state `needs_account` → `/billing-setup`: terms + plan choice
4. User adds a payment method via Stripe Checkout → webhook sets
   `billing_mode = 'postpaid'` and creates the metered subscription
5. Cluster assignment triggered by the webhook; the gate shows
   `assigning_cluster` until the assignment row exists
6. State `ready` → dashboard

### Prepaid Signup (Promo Code)
1. User arrives with `?promo=PROMO_CODE`
2. Code validated via `/api/auth/validate-promo`, passed to `/api/auth/signup`
   as a query param, persisted in the `hw_signup_refs` cookie
3. Auth0 signup → `/api/auth/sync-user` reads the cookie
4. User created with `billing_mode = 'prepaid'`
5. State `needs_account` → `/billing-setup` for terms only
6. User accepts terms → cluster assigned → dashboard
7. No Stripe payment required

### Corporate (Prepaid) Signup
1. User arrives with `?corporate_ref=<hubspot-deal-id>`
2. `/api/auth/validate-corporate` validates the deal through HubSpot APIs
3. On successful validation, user created with `billing_mode = 'prepaid'`
4. Same flow as promo code - terms acceptance only, no payment
5. Usage collected hourly but invoicing happens off-platform

### Team Management
1. Account owners send invites via `/api/team/invite`; Resend emails the tokenized link
2. Invited user clicks link → `/team/accept-invite` shows invite details + terms
3. User accepts terms → Auth0 signup with `returnTo=/team/joining?token=xxx`
4. `/team/joining` calls `/api/team/join` which:
   - Validates invite token
   - Upserts user with `account_owner_id` set to owner
   - Assigns user to owner's cluster
   - Creates Hopsworks OAuth user with `maxNumProjects: 0`
5. Team member redirected to `/dashboard`
6. Team member usage aggregated to owner's account for billing

### Cost Collection (Hourly via OpenCost)
1. Windmill schedule runs hourly via Docker sidecar (Vercel cron fallback still active)
2. For **each active cluster** (multi-cluster support):
   - Uses `kubectl exec` to query OpenCost API inside cluster
   - Gets costs per namespace for the last hour
   - No external exposure needed (secure)
   - Verifies namespace owner is on correct cluster
3. Maps namespaces to users via `user_projects` table
4. Accumulates hourly costs in `usage_daily` table
5. Updates `project_breakdown` JSONB with per-project details
6. Persists totals in `usage_daily` for reporting and Stripe sync.

**See**: [OpenCost Collection Documentation](../operations/opencost-collection.md) for detailed flow.

### OpenCost Integration
```
┌─────────────┐     kubectl exec      ┌──────────────┐
│   Vercel    │─────────────────────▶│  OpenCost    │
│  Cron Job   │                       │  (in cluster)│
└─────────────┘                       └──────────────┘
      │                                      │
      │                                      │ Query costs
      ▼                                      ▼
┌─────────────┐                       ┌──────────────┐
│  Database   │                       │  Namespaces  │
│ usage_daily │◀──────────────────────│   (costs)    │
└─────────────┘    Map & Store        └──────────────┘
```

### Billing
- **Postpaid (default)**: Daily cron `/api/billing/sync-stripe` reports usage totals to Stripe Billing Meter Events.
- **Prepaid (corporate)**: Usage retained for reporting; invoicing handled manually based on HubSpot deal metadata.
- Hybrid model supports SaaS and prepaid accounts simultaneously.
- Team member usage rolls up to the owner via `usage_daily.account_owner_id`.
- All costs originate from OpenCost allocations; pricing is defined in `src/config/billing-rates.ts`.

## Database Schema

### Core Tables
- **`users`** – Auth0 ID as primary key:
  - `account_owner_id` links team members to owners.
  - `billing_mode` toggles between `postpaid` and `prepaid`.
  - `hopsworks_username` cached for API calls.
  - `metadata.corporate_ref` stores the HubSpot deal ID.
- **`team_invites`** – Pending invitations, including desired project role and `auto_assign_projects`.
- **`project_member_roles`** – Tracks team member access to each Hopsworks project plus sync status.

### Cluster Management
- **`hopsworks_clusters`** - Shared cluster endpoints with kubeconfig
- **`user_hopsworks_assignments`** - Maps users to clusters, includes:
  - `hopsworks_user_id` - For API updates
  - `hopsworks_username` - For reference
  - `assigned_by` - Tracks manual vs automatic assignment

### Billing Tables
- **`user_projects`** – Maps OpenCost namespaces to account owners.
- **`usage_daily`** – Hourly totals aggregated per day for Stripe sync.
- **`stripe_products`** – Active Stripe product/price mappings used by billing sync.

## Hopsworks Integration

### User Creation Flow
1. **No Hopsworks user on signup** - Only database user created
2. **Hopsworks user created during cluster assignment** after payment verified
3. **Project limits**:
   - Billing users (account owners): 5 projects (`maxNumProjects: 5`)
   - Team members: 0 projects (`maxNumProjects: 0`)
   - Limits enforced by Hopsworks, controlled by hopsworks-managed

### OAuth Authentication
- Hopsworks configured to accept Auth0 OAuth tokens
- Uses Auth0 `CLIENT_ID` for OAuth user creation
- Subject ID links Auth0 identity to Hopsworks user

### Project Access
- **Account owners** can create up to 5 projects
- **Team members** cannot create projects but can be added to owner's projects
- Project membership managed within Hopsworks UI

## Security
- All API routes require Auth0 sessions; admin routes enforce `is_admin`.
- Supabase service-role key enables server-to-server access; never expose client-side.
- Hopsworks API keys and kubeconfigs are stored as text in Supabase: access restricted to admin functions and encrypted at rest by Supabase.
- **OpenCost is not exposed externally**; all calls go through Kubernetes API proxying.
- Team members inherit billing but cannot view Stripe data.

## Deployment Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Vercel (Frontend + API)           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │  Next.js   │  │  API       │  │  Cron Jobs │      │
│  │  Pages     │  │  Routes    │  │  (Hourly)  │      │
│  └────────────┘  └────────────┘  └────────────┘      │
└──────────────────────────────────────────────────────┘
         │              │                │
         │              │                │ kubectl exec
         ▼              ▼                ▼
┌──────────────┐ ┌──────────────┐  ┌──────────────┐
│    Auth0     │ │   Supabase   │  │  Kubernetes  │
│              │ │   Database   │  │   Cluster    │
└──────────────┘ └──────────────┘  │ ┌──────────┐ │
                                   │ │ OpenCost │ │
┌──────────────┐                   │ └──────────┘ │
│    Stripe    │                   └──────────────┘
│   Payments   │
└──────────────┘
┌──────────────┐
│   HubSpot    │
│  (Deals)     │
└──────────────┘
┌──────────────┐
│    Resend    │
│ (Invites)    │
└──────────────┘
```

## Cost Data Flow

1. **OpenCost** tracks actual cloud resource costs in Kubernetes
2. **Hourly Collection** queries OpenCost for namespace costs
3. **Namespace Mapping** uses `user_projects` to find owners
4. **Cost Aggregation** sums all project costs per user
5. **Database Storage** in `usage_daily` with breakdown
6. **Stripe Billing** uses aggregated costs for invoicing

## Monitoring Points

- Vercel cron job execution logs
- OpenCost connection status (admin UI)
- Unmapped namespaces (no owner found)
- Collection success/failure rates
- Daily cost trends per user
- Project activity (active/inactive status)

# Project Glossary

Shared language. The agent and new humans read this to decode jargon consistently.

## Terms

**Account owner**
A user who owns billing and a cluster assignment. Identified by `account_owner_id IS NULL` in `users`. Can invite team members.
_Avoid_: "billing user", "main user", "primary user".

**Team member**
A user invited by an account owner. Inherits billing and cluster from the owner. Identified by `account_owner_id` pointing to the owner. Hopsworks quota is `maxNumProjects: 0`.
_Avoid_: "sub-user", "guest", "invitee" once they have accepted.

**Cluster**
A Hopsworks Kubernetes deployment. One row per cluster in `hopsworks_clusters` (URL, API key, kubeconfig). Users are mapped via `user_hopsworks_assignments`.
_Avoid_: "tenant", "instance".

**Project**
A Hopsworks project. Lives in Hopsworks. We mirror only the (user, cluster, namespace, project_name) mapping in `user_projects` for billing.
_Avoid_: confusing it with Stripe products or our internal SaaS records.

**Namespace**
The Kubernetes namespace OpenCost reports against. Hopsworks project names use underscores (`my_project`); Kubernetes namespaces use hyphens (`my-project`). `user_projects.namespace` stores the hyphenated form.
_Avoid_: using `project_name` and `namespace` interchangeably.

**`billing_mode`**
Enum on `users`: `'postpaid'` (Stripe metered, default), `'prepaid'` (corporate or promo, off-platform invoicing), `'free'` (legacy/internal).
_Avoid_: "paid", "trial", "enterprise" as synonyms.

**User state**
Enum on `users.status`: `active`, `suspended` (login allowed, sees notice, Hopsworks status=3), `deleted` (soft delete, 403 on login, Hopsworks status=3). See `docs/features/user-lifecycle.md`.

**OpenCost**
In-cluster cost allocator. We `kubectl exec` into the OpenCost pod every hour to pull per-namespace compute and storage. Source of all metered usage.

**Ratchet (project quota)**
Workaround for a Hopsworks bug where `numActiveProjects` and `maxNumProjects` count created (not active) projects. We only ever raise `maxNumProjects`, never lower it, using a `<` guard. See `docs/troubleshooting/known-issues.md`.

**`syncUserProjects()`**
Reconciles `user_projects` from the Hopsworks admin API on every login and before any project-count-dependent decision (billing, downgrade, suspension). In `src/lib/project-sync.ts`.

**`corporate_ref`**
URL parameter holding a HubSpot deal ID. Validates a prepaid corporate signup. Stored in `users.metadata.corporate_ref`.

**Promo code**
Self-service prepaid path. Validated via `/api/auth/validate-promo`. Skips Stripe payment, requires terms acceptance only.

## Relationships

- An **account owner** has many **team members** (`users.account_owner_id` FK).
- A **user** is assigned to one **cluster** at a time (`user_hopsworks_assignments`).
- A **user** has many **projects** (`user_projects`); team-member project access is tracked via `project_member_roles`, NOT `user_projects`.
- A **cluster** holds many **namespaces**; one **namespace** maps to one **project** maps to one **billing user** (the account owner).

## Flagged ambiguities

**"User"**: three identities, do not conflate.
- Auth0 user (sub claim, identity).
- Supabase `users.id` (SaaS state, billing).
- Hopsworks user (`hopsworks_user_id` + `hopsworks_username`, in `user_hopsworks_assignments`).

**"Active project"**: Hopsworks API `numActiveProjects` actually returns *created* projects (includes soft-deleted). Always verify against `user_projects` synced state, never trust the Hopsworks count for billing decisions.

**"Project name" vs "Namespace"**: see `Namespace` term above. Hyphenated form wins for OpenCost lookup.

**"Suspended" vs "Deleted"**: suspended users can still log in and recover. Deleted users get a 403 from `sync-user`, billing, and all user-facing endpoints.

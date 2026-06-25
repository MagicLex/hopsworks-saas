# Billing & Management Control Plane

Pay-as-you-go SaaS on shared Hopsworks clusters. This is the design to meter consumption, bill it,
and enforce a per-account budget, all tunable at runtime from the bridge (hopsworks-saas / run.hopsworks.ai) with
minimal changes to Hopsworks itself.

## Architecture

```
            ┌──────────────── BRIDGE (policy brain, hopsworks-saas) ────────────┐
 lifecycle  │ metering reconciler ──► usage_daily                                  │
 webhook ──►│ capacity_tier (ceiling) + enforcement_state (budget)                 │
 (state)    │              └─ resolve ─► applied_quota_tier  (one field, Supabase)  │
            └───────────────────────────────┬──────────────────────────────────────┘
                                            |
                                            |
                                            |
                                            ▼  Supabase (PostgREST)
            ┌──── quotas-bookkeeper (hopsworks-as-a-service, in-cluster, every 5m) ─┐
            │ reads the desired field ──► PATCH namespace label ──► Kyverno quota   │
            └───────────────────────────────────────────────────────────────────────┘
            bridge also drives, via the admin API: per-project HopsFS + RonDB storage quotas, maxNumProjects, user status, computeState, Stripe
```

- **Bridge** owns policy: it meters usage, prices it, computes the desired state, and writes it to
  Supabase. It never touches Kubernetes.
- **quotas-bookkeeper** is a Go cronjob in the cluster that reads Supabase and patches namespace
  labels; Kyverno turns the label into a ResourceQuota. It exists and runs every 5 minutes, today
  toggling only paying-is-exempt vs free-gets-default.
- **Lifecycle webhook** (Hopsworks → bridge, from hopsworks-ee PR #2992) keeps the
  namespace→project→account map fresh, so cost is attributed to the right account without polling.

Policy lives in the DB and is read at runtime: prices, plans, budgets, and thresholds are edited,
not redeployed. Metering uses a per-cluster watermark and backfills from OpenCost retention (49h
hourly, 15d daily), so a missed tick self-heals. State changes ride the webhook instead of a poll.

## Enforcement model

Two independent axes, resolved into one applied value:

- **Capacity** (`capacity_tier`: small / medium / large / exempt): the compute ceiling a project may
  request. small→medium is self-serve; large and exempt are sales-gated, so nobody jumps to 100+
  cores without a conversation.
- **Budget** (`enforcement_state`: normal / throttled / frozen): derived from month-to-date recorded
  cost vs the account budget. Free accounts get a default budget; paying accounts have none and stay
  `normal` unless a self-set cap bites.

```
applied_quota_tier = frozen        if budget exceeded
                   = throttled     if budget reached
                   = capacity_tier otherwise
```

The bridge writes `applied_quota_tier`; the bookkeeper applies it. Ladder, all reversible by writing
one field; suspend is reserved for abuse and non-payment, never for budget:

| Step | Trigger | Effect |
|---|---|---|
| Normal | cost < budget | quota = capacity_tier |
| Nudge | 80/90% of budget | email + in-app banner |
| Throttle | budget reached | quota shrinks to a few cores |
| Freeze | budget exceeded | `requests.cpu: 0`, new pods rejected, running work drains |
| Suspend | non-payment or abuse | account deactivated (admin API + Stripe) |

Throttle and freeze are Kubernetes quota changes the Hopsworks app cannot see, so a user hits a raw
`exceeded quota` error. A generic per-user `computeState` (set by the bridge, shown as a banner)
makes the reason visible without suspending the account.

## Coverage

What is metered, capped, and billed today, per resource:

| Resource | Metered | Capped | Billed | Gap to close |
|---|---|---|---|---|
| CPU / RAM | yes | yes (Kyverno) | yes | none |
| GPU | n/a (no GPU nodes today) | n/a | n/a | future-proof only: a per-tier `nvidia.com/gpu` line, unset until GPU nodes exist |
| Storage offline (HopsFS) | yes | no | yes | bridge sets a per-project HopsFS space quota via the admin API |
| Storage online (RonDB) | yes, per project | yes (FSTORE-1819 / HWORKS-2421 / HWORKS-2866) | yes | bridge sets per-project limits from the plan; set `rondb_quotas` default |
| Network egress | no | no | no | read OpenCost `networkTransferBytes`, then bill |
| Kafka | no | partial: topic count + cluster-wide rate | no | deferred, not billed (see Plan) |

Notes that shape the plan:

- CPU/RAM is the only fully governed axis.
- Online storage is measurable and cappable per project. RonDB has native per-database quotas
  (`in_memory_size`, `on_disk_size`, `rate_per_sec`, ...) keyed by the project's database name,
  enforced by RonDB itself (writes are rejected at the onlinefs layer once a quota is crossed). The
  full stack is merged into hopsworks-ee master across three tickets: the rate-limit primitive
  (FSTORE-1819, `rate_per_sec`), the feature flag (HWORKS-2421), and project-creation defaults plus
  usage exposure (HWORKS-2866). Set per project via `PUT /admin/projects/{id}`, defaults from the
  `rondb_quotas` cluster variable, usage read from `ndbinfo.database_memory_usage`, admin UI plus an
  over-quota banner on the project page. The bridge sets per-project limits from the plan and reads
  usage from the same API.
- Kafka is not billed per project and is deferred (see Plan). Topic count is capped
  (`kafka_max_num_topics`), and a cluster-wide byte-rate quota exists off by default (HWORKS-2632,
  merged to helm `main`). Per-project rate, size/retention, and byte accounting are future work.
- Storage is a stock, not a flow: freezing compute does not stop the storage bill, and reclaiming it
  requires deleting data. The breaker for storage is to freeze writes (quota at current usage), not
  to throttle. No budget-reservation maths and no attempt to prevent excess: the goal is attribution
  and a clear bill, not a cap. Paid accounts bill what they store and pay it, storage included. On
  free, a write-freeze stops growth but the existing stock keeps costing us, so the only real brake
  is a retention policy that deletes idle free-tier data after a set period. Without that policy, a
  free account that uploads then goes idle is a standing cost.
- Egress is already per project: OpenCost is queried `aggregate=namespace`, and the allocation object
  carries `networkTransferBytes` per namespace; the reconciler just doesn't read it yet. Optional
  refinement: `networkTransferBytes` is total bytes out of pods, not internet egress specifically.
  Billing the raw figure counts intra-cluster traffic too; isolating real egress needs OpenCost's
  network cost model (network-costs daemonset + provider config), which can be added later. Decide
  which subset to bill at implementation time.

## Changes per repo

**hopsworks-as-a-service / quotas-bookkeeper** (small): read `applied_quota_tier` from Supabase
instead of branching on raw billing_mode; add `throttled` and `frozen` Kyverno tier policies; wire a
per-tier `nvidia.com/gpu` line into the quota template (future-proof, no-op until GPU nodes exist);
treat unknown/NULL as an error, not a silent skip. SA, RBAC,
cronjob, and deploy pipeline already exist. Storage quotas (HopsFS offline, RonDB online) do not
touch the bookkeeper: the bridge sets them through the admin API.

The only net-new artifact in-cluster is the two Kyverno tier policies (`throttled`, `frozen`). The
label-patch plumbing and the label→ResourceQuota expansion already exist; the bookkeeper change is a
one-field swap (`billing_mode` → `applied_quota_tier`) plus the NULL guard. Kyverno is mandatory
here: Hopsworks never writes a ResourceQuota (its admin kube API only sets namespace labels and
priority classes and reads the quota back, `KubeClientService` has no quota write), so something
in-cluster must materialise label→quota, and that is Kyverno.

Keep the bookkeeper; do not fold it into the bridge. The Hopsworks admin API can set the namespace
label too (`POST /admin/projects/{id}/kube/label`), so in principle the bridge could write it
directly and the cronjob could go. That was considered and rejected: the bookkeeper is a
reconciliation loop that re-asserts desired state every tick and self-heals label drift, whereas a
bridge push writes once and lets the cluster diverge in silence. For billing that drift is a money
leak (a frozen account silently un-freezing). A push would also couple enforcement to Hopsworks API
uptime and route it across the internet from an out-of-cluster bridge. Reconciliation in-cluster is
the SOTA shape and the robust one; the only worthwhile future upgrade is cron → watch, not deletion.

**hopsworks-ee**: the primitives scoped in *Required Hopsworks primitives* below. The online-storage
cap is merged to ee master (FSTORE-1819 / HWORKS-2421 / HWORKS-2866); the bridge drives it, no
building needed. The Kafka cluster-wide rate quota is merged to helm `main` (HWORKS-2632, default
off); per-project Kafka rate, size, and accounting are deferred upstream work. `computeState` is still to build for the compute throttle/freeze case, though online
over-quota visibility already ships as a banner. No usage events from EE; usage stays a bridge-side
integral.

**hopsworks-saas** (the bulk):

- DB: `billing_rates` (effective-dated), `billing_plans` (capacity tier, monthly budget, project
  limit, credits), `enforcement_policy` (thresholds), per-project `capacity_tier` /
  `enforcement_state` / `applied_quota_tier`, `metering_watermark`.
- Metering reconciler: watermark + backfill, idempotent per `(namespace, hour)`; read
  `networkTransferBytes` to fill egress.
- State resolution: compute `enforcement_state` from budget, resolve `applied_quota_tier`, set
  `computeState` on throttle/freeze.
- Capacity upgrades: self-serve small→medium; large/exempt go through an approval queue.
- Promote the lifecycle webhook receiver to master and retire the project-sync poll.
- Admin UI: capacity, budget, enforcement state, and live quota per account; price/plan/budget
  editors; approval and enforcement queues.

## Required Hopsworks primitives

The only changes that must land in Hopsworks itself. Each is generic, with no SaaS tier or billing
logic in Hopsworks: the bridge supplies the values, Hopsworks enforces and exposes.

1. **Per-user compute-state signal** (small, to build). A per-user `computeState` field (enum
   `normal` / `throttled` / `frozen` + optional message), settable via `PUT /admin/users/{id}` and
   returned by `authenticationStatus`, so the UI shows a banner. Closes the visibility gap on the
   compute axis: a quota-throttled user reads a clear reason instead of an opaque `exceeded quota`.
   The bridge sets the value and message. Note the online (RonDB) over-quota case already has its own
   banner (HWORKS-2866); this primitive covers the Kubernetes-quota throttle/freeze the Hopsworks app
   cannot otherwise see.

2. **Per-project online (RonDB) storage limit** (merged to ee master, bridge-driven). Delivered
   across FSTORE-1819 (the `rate_per_sec` rate-limit primitive), HWORKS-2421 (feature flag), and
   HWORKS-2866 (project-creation defaults plus usage exposure): RonDB has native per-database quotas
   (`in_memory_size`, `on_disk_size`, `rate_per_sec` and more), enforced by RonDB itself, set per
   project via `PUT /admin/projects/{id}`, defaulted from the `rondb_quotas` cluster variable, with
   per-database usage read from `ndbinfo.database_memory_usage` and surfaced in the admin UI, project
   settings, and an over-quota banner. RonDB rejects writes at the onlinefs layer once a quota is
   crossed, so enforcement is not application-level. The remaining work is bridge-side: set a generous
   `rondb_quotas` default and push a per-project write-freeze limit only on budget breach or
   non-payment.

3. **Kafka per-project rate/size/accounting** (deferred, not billed). Topic count is already capped
   and a cluster-wide byte-rate quota ships off by default (HWORKS-2632, helm `main`). Per-project
   differentiation, `retention.bytes`, and per-project byte accounting are future work, scoped only if
   Kafka usage proves material.

Offline storage needs no new primitive: per-project HopsFS space quotas already exist and are
settable through the existing admin API (`PUT /admin/projects/{id}`; the `Quotas` DTO carries
`hdfsQuota`/`hdfsNsQuota`, applied by `updateQuotas` via the app's DFS client), unset today. The
bridge sets them the same way it sets RonDB quotas, so no namenode exec and no bookkeeper RBAC
change. GPU needs no primitive either: it is a per-tier line in the Kyverno quota, and there are no
GPU nodes today, so it is wired future-proof and stays a no-op until GPU hardware is added.

## Plan

Bottom-up: meter correctly, make policy editable, then enforce. Each step is shippable on its own.

1. Robust metering (watermark + backfill) and egress (read `networkTransferBytes`). Closes the silent
   metering gaps. No user-facing change.
2. Prices, plans, budgets, and policy in the DB with UI editors. Self-serve tuning, observe-only.
3. Resolution + `applied_quota_tier`, bookkeeper reads it. Enforcement off raw billing_mode,
   behaviour-equivalent first.
4. Budget enforcement: throttled/frozen tiers, GPU cap (future-proof, no GPU nodes today),
   `computeState`, the ladder. Nudge first,
   freeze behind confirm, suspend abuse-only.
5. Storage breakers (budget/non-payment only): HopsFS space quota and RonDB per-project limit, both
   set as a write-freeze at current usage via the admin API. RonDB primitive is in ee master; bridge
   sets the `rondb_quotas` default and pushes the per-project limit. Generous default, not a routine
   cap.
6. Lifecycle webhook to master, retire the poll.
7. Kafka (deferred, good to add later): not billed per project today. Enable the cluster-wide
   byte-rate quota if needed (HWORKS-2632, merged to helm `main`, off by default); per-project rate,
   size/retention, and byte accounting wait until Kafka usage proves material.

## Open risks (billing)

- `NULL` billing_mode accounts fall through every gate; resolution must treat NULL as an error.
- Storage cost survives compute enforcement and suspension; only deletion reclaims it. Paid: it
  bills, they pay, no action needed. Free: write-freeze caps growth, but idle stored data keeps
  costing us until a retention policy reclaims it. That policy is the only brake on free-tier storage
  abuse; without it a frozen free account is a permanent cost.
- Multi-account abuse: per-namespace quotas do not bound one person opening many free accounts.
- Kafka usage is not billed or capped per project today; revisit if it proves material.
- `namespaces: patch` on the bookkeeper SA cannot be label-scoped in RBAC; keep it tight, rotate its
  Supabase key.

Infra/capacity risks (one tenant saturating a shared pool: RonDB `DataMemory`, Kafka disk) are out of
scope for this document. They are a capacity concern, not a billing one: a paying tenant that grows is
billed, not blocked. Enforcement here freezes writes only on budget breach or non-payment.

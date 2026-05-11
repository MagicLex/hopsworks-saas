# Hopsworks Backend Briefs

Engineering wishlist for the `hopsworks-ee` core team. Each brief documents one workaround in `hopsworks-managed` that exists because the upstream Hopsworks API lacks the right primitive. Shipping the proposed change deletes the workaround.

**Status legend**

- `PROPOSED`: drafted here, not yet sent upstream
- `SENT`: handed to backend team
- `IN PROGRESS`: backend is implementing
- `SHIPPED`: live, workaround can be removed
- `REMOVED`: workaround removed from `hopsworks-managed`

| #  | Title                                              | Status        |
|----|----------------------------------------------------|---------------|
| 1  | `maxNumProjects` counts created, not active        | IN PROGRESS   |
| 2  | Active vs deleted projects in listings             | IN PROGRESS   |
| 3  | Lifecycle webhooks (user, project, membership)     | IN PROGRESS   |
| 4  | `createas` 409 error disambiguation                | IN PROGRESS   |
| 5  | Project member / role API                          | IN PROGRESS   |
| 6  | SaaS-managed cluster mode (login lock)             | IN PROGRESS   |
| 7  | Project creation policy by cluster mode            | IN PROGRESS   |

---

## Brief #1: `maxNumProjects` counts created, not active

**Status**: IN PROGRESS (Option A landed in `hopsworks-ee`, branch `feature/saas-augmentation`, pending merge and deploy)

### Problem

The `maxNumProjects` quota on a Hopsworks user is consumed by *created* projects, not *currently active* ones. When a user deletes a project, the quota is not freed. After a user creates and deletes 5 projects on a postpaid tier, they cannot create a sixth even though their active count is zero.

This forces `hopsworks-managed` to maintain a parallel `user_projects` table, detect deletions, and ratchet `maxNumProjects` upward by the number of deleted projects to compensate.

### Root cause (post-investigation)

The original framing was incomplete. The EE code already recomputes `numActiveProjects` from a JPQL query against the `project` table on every project create/delete. The quota is checked as `numActiveProjects >= maxNumProjects`, not `createdProjects >= maxNumProjects`.

The actual bug: the recompute query (`Project.findByOwner`) had no status filter, so any project row left in `creationStatus = ONGOING` or `FAILED` from a half-failed creation or deletion stayed counted toward the quota forever. Combined with the fact that `updateNumActiveProjects` was called only on the success path of cleanup (no `finally`), a partial-fail cleanup produced a zombie row that permanently consumed a slot. The SaaS ratchet was treating the symptom of zombie persistence.

### Backend fix (Option A, shipped in `hopsworks-ee`)

1. New value `UNDER_REMOVAL` in `CreationStatus` enum (ORDINAL=3, append-safe, no schema migration).
2. New named query `Project.findActiveByOwner` excludes `FAILED` and `UNDER_REMOVAL` from the recompute.
3. `UsersController.updateNumActiveProjects` now uses the active query: stale zombies stop counting toward the quota.
4. `ProjectController.cleanup` and `forceCleanup` flip the project to `UNDER_REMOVAL` at the top of the method, before any cleanup work runs. The user's quota slot is freed up-front. If cleanup fails halfway, the row stays as `UNDER_REMOVAL`, doesn't count, doesn't block the user.
5. New admin endpoint `POST /admin/projects/{projectId}/force-purge`: hard-deletes a stuck zombie row (only allowed when `creationStatus IN (FAILED, UNDER_REMOVAL)`, returns `409 PROJECT_NOT_PURGEABLE` otherwise) and recomputes the owner's `numActiveProjects`. Use after manual confirmation that external resources (HDFS, K8s, certs) are gone.

### What `hopsworks-managed` can simplify once deployed

Delete the ratchet machinery entirely:

- `src/lib/project-sync.ts:168-180`: drop the `maxNumProjects += projectsToDeactivate.length` ratchet block. Project deletion now frees the quota at the EE level.
- `src/pages/api/admin/fix-project-quotas.ts`: delete the file. Replace any operator workflow with a call to the new `POST /admin/projects/{projectId}/force-purge` endpoint when a true zombie is found.
- `src/pages/api/billing.ts:420`, `src/pages/api/webhooks/stripe.ts` (3 places): delete the "only bump up, never down" guards. `maxNumProjects` can now be set strictly to the tier baseline because there is no ratchet to preserve.
- `src/pages/api/auth/sync-user.ts` Health Check 5: simplify to a one-shot tier-baseline reconciliation. The "below baseline" path should never trigger after this lands; if it does, alert instead of self-heal.

Roughly 200 lines removed plus one admin endpoint.

### Verification once deployed

1. Create a project, force-fail the cleanup (kill the pod mid-delete or trigger an exception in `removeProjectInt`). The project row stays in `creationStatus = UNDER_REMOVAL` but `users.num_active_projects` decrements.
2. Same user creates a new project: succeeds without a `maxNumProjects` ratchet.
3. Operator hits `POST /admin/projects/{zombieId}/force-purge` after confirming external state is clean: row is removed, `numActiveProjects` recomputed.
4. Hitting `force-purge` on an active (`DONE`) project returns `409` and does nothing.

### Pointers to the EE change

- `hopsworks-persistence/.../project/CreationStatus.java`: enum value `UNDER_REMOVAL`
- `hopsworks-persistence/.../project/Project.java`: named query `Project.findActiveByOwner`
- `hopsworks-common/.../dao/project/ProjectFacade.java`: `findActiveByUser`
- `hopsworks-common/.../user/UsersController.java`: `updateNumActiveProjects` (uses active query)
- `hopsworks-common/.../project/ProjectController.java`: `markProjectUnderRemoval`, `forcePurge`, calls in `cleanup` and `forceCleanup`
- `hopsworks-api/.../admin/projects/ProjectsAdminResource.java`: `POST /admin/projects/{projectId}/force-purge`
- `hopsworks-rest-utils/.../RESTCodes.java`: `ProjectErrorCode.PROJECT_NOT_PURGEABLE`

---

## Brief #2: Active vs deleted projects in listings

**Status**: IN PROGRESS (shipped on `feature/saas-augmentation`, pending merge and deploy; depends on brief #1)

### Problem

`GET /admin/projects` returns deleted (zombie) projects with no way to filter them out. The user-facing field `numActiveProjects` on `GET /admin/users/{id}` also counts deleted projects in some states. We have no reliable way to ask "how many projects does this user actually have right now."

### Backend fix (shipped in `hopsworks-ee`)

Building on brief #1's `UNDER_REMOVAL` state and `findActiveByOwner` query:

- `ProjectAdminInfoDTO` now includes `creationStatus`. Listings expose project lifecycle state.
- `GET /admin/projects` accepts two new query params:
  - `?status=active`: returns only projects whose `creationStatus NOT IN (FAILED, UNDER_REMOVAL)`. Same definition as `numActiveProjects`.
  - `?ownerId=<userId>`: server-side filter by owner. Replaces the client-side filter in `getUserProjects`.
  - The two combine: `?status=active&ownerId=10181`.
- Defaults preserve backward compatibility: no params = full listing including zombies, same as before.
- `numActiveProjects` on `GET /admin/users/{id}` already reflects active state correctly (fixed in brief #1).
- New facade query `Project.findAllActive` for the unscoped active listing.

### What `hopsworks-managed` can simplify once deployed

- `src/lib/hopsworks-api.ts:237-278` (`getUserProjects`): replace the fetch-all-and-filter with `GET /admin/projects?status=active&ownerId=${userId}&expand=creator`. Drop the client-side `filter` block.
- `src/pages/api/cron/sync-projects.ts`: drop the 30-minute reconcile cron. Switch dashboards/usage/billing endpoints to read directly from `GET /admin/users/{id}` (`numActiveProjects`) or the per-user listing above.
- `src/pages/api/usage.ts`, `src/pages/api/billing.ts`: read upstream instead of local `user_projects`.
- `user_projects` Supabase table: drop, or downgrade to a cache with a much shorter TTL.
- Reduce `vercel.json` cron count from 4 to 3.

### Pointers to the EE change

- `hopsworks-persistence/.../project/Project.java`: named query `Project.findAllActive`
- `hopsworks-common/.../dao/project/ProjectFacade.java`: `findAllActive`
- `hopsworks-api/.../admin/dto/ProjectAdminInfoDTO.java`: `creationStatus` field
- `hopsworks-api/.../admin/projects/ProjectsAdminBuilder.java`: `build(uriInfo, resourceRequest, activeOnly, ownerId)` overload
- `hopsworks-api/.../admin/projects/ProjectsAdminResource.java`: `?status` and `?ownerId` query params on `GET /admin/projects`

---

## Brief #3: Lifecycle webhooks

**Status**: IN PROGRESS (shipped on `feature/saas-augmentation`, pending merge and deploy)

### Problem

`hopsworks-managed` has no way to know when state changes upstream. We compensate with polling on every login (7 health checks) and a daily reconciliation cron. State drifts between Stripe, Supabase, and Hopsworks until either a user logs in or the daily check runs.

### Backend fix (shipped in `hopsworks-ee`)

Reuses the existing `OperationLog` outbox already in place for K8s/Trino/Superset sync (`hopsworks-common/.../async/service/`). The outbox path:

1. Business EJB calls fire `ProjectHandler` / `UserAccountHandler` / `ProjectTeamRoleHandler`. The shipped `ServiceUserAccountHandler` writes an `OperationLog` row in the same transaction. Reliable: webhook delivery is durable across crashes.
2. `OperationLogTimer` (singleton, ~15s tick) batches pending ops, dispatches to every registered `UserOperationHandler` / `ProjectOperationHandler`, tracks per-handler success/failure with exponential backoff.
3. New handler `LifecycleWebhookHandler` implements both interfaces. For each op it builds a JSON envelope, computes HMAC-SHA256 over the body, POSTs to the configured URL.

```
POST {webhook_url}
Content-Type: application/json
X-Hopsworks-Signature: sha256=<hmac-hex>

{
  "event": "user.created" | "user.updated" | "user.deleted"
         | "project.created" | "project.deleted"
         | "project.member.added" | "project.member.updated" | "project.member.removed",
  "timestamp": "2026-05-10T12:34:56Z",
  "clusterId": "eu-west-1-prod",
  "data": { ... event-specific payload ... }
}
```

Payload shapes:

- `user.created`, `user.updated`: `{userId, username, email, status}` (status name from `UserAccountStatus` enum). Receivers compare against their own state to derive activated/deactivated transitions; brief #3 originally proposed split events but the underlying `UserAccountHandler.update` does not surface old vs new status, so the SaaS layer reconciles instead. The `status` field carries everything needed.
- `user.deleted`: `{userId, username}` only. The `Users` row is gone by the time the OperationLog timer fires, so `email` and `status` are not available. `userId` is the stable numeric identifier captured at log-save time; match on it (not on the mutable `username`).
- `project.*`: `{projectId, name, ownerId, creationStatus}`.
- `project.member.*`: `{projectId, userId, role}` (role omitted on `removed`).

Configuration (`Settings` entries, applied per cluster):

- `LIFECYCLE_WEBHOOK_URL`: empty disables the handler. The whole pipeline becomes a no-op.
- `LIFECYCLE_WEBHOOK_SECRET`: HMAC-SHA256 key. Empty omits the signature header (don't deploy this way in prod).
- `LIFECYCLE_WEBHOOK_CLUSTER_ID`: identifier echoed back in every payload for multi-cluster receivers.

Delivery semantics:

- Idempotent: receivers MUST tolerate redelivery. The outbox retries up to 10 times immediately, then exponential backoff up to 24h.
- Skipping rule (inherited from the timer): if a newer op exists for the same entity in the same batch, the older one is skipped. State-based delivery, not strict event log. In practice: `user.created` followed quickly by `user.deleted` may collapse to `user.deleted` only. The receiver should reconcile from the final state, not assume every transition is delivered.
- Service users (online-fs, serving-manager, airflow) skip the membership webhook automatically.

### What `hopsworks-managed` can simplify once deployed

- Add a webhook receiver endpoint (e.g. `POST /api/webhooks/hopsworks-lifecycle`) that verifies HMAC and updates Supabase state on the spot.
- `src/pages/api/auth/sync-user.ts`: drop the 7 health checks. Keep auth check + token validation. Reconciliation is now event-driven.
- `src/pages/api/cron/check-data-integrity.ts`: downgrade to weekly belt-and-braces, or drop entirely once the receiver has been stable for two weeks.
- `health_check_failures` table: keep only as a low-volume retry log (or drop).
- Configure each cluster: set `LIFECYCLE_WEBHOOK_URL`, `LIFECYCLE_WEBHOOK_SECRET`, `LIFECYCLE_WEBHOOK_CLUSTER_ID` via the existing settings admin API.

### Pointers to the EE change

- `hopsworks-common/.../webhook/LifecycleWebhookHandler.java`: the handler
- `hopsworks-common/.../util/Settings.java`: `LIFECYCLE_WEBHOOK_URL` / `LIFECYCLE_WEBHOOK_SECRET` / `LIFECYCLE_WEBHOOK_CLUSTER_ID`
- The plumbing (`ServiceUserAccountHandler`, `OperationLogTimer`, `OperationHandlerHelper`) was already there for K8s/Superset/Trino. The webhook is just another `UserOperationHandler` + `ProjectOperationHandler`.

---

## Brief #4: `createas` 409 error disambiguation

**Status**: IN PROGRESS (shipped on `feature/saas-augmentation`, pending merge and deploy; depends on brief #1)

### Problem

`POST /admin/projects/createas` returned `409 Conflict` with the same `PROJECT_EXISTS` (errorCode `150001`) for multiple distinct failure modes:

1. Project name already taken globally (true conflict)
2. Project row left in `FAILED` or `UNDER_REMOVAL` state from a prior cleanup or creation that did not finish (zombie)
3. Project row in `ONGOING` state because another request is currently creating the same name (concurrent creation)

Same integer code for all three meant the SaaS layer could not decide whether to surface "name taken", purge a zombie, or retry after a backoff.

### Backend fix (shipped in `hopsworks-ee`)

Two new error codes alongside the existing `PROJECT_EXISTS`:

- `PROJECT_EXISTS` (errorCode `150001`, HTTP 409): name taken by a healthy project (`creationStatus = DONE`). Same as before, retained for backward compatibility.
- `PROJECT_IN_PARTIAL_STATE` (errorCode `150099`, HTTP 409): name held by a row in `FAILED` or `UNDER_REMOVAL`. The caller should call `POST /admin/projects/{id}/force-purge` (brief #1) and then retry. The `devMsg` includes `projectId` so the caller doesn't need a second lookup.
- `PROJECT_CREATION_IN_PROGRESS` (errorCode `150100`, HTTP 409): name held by a row in `ONGOING`, OR the `EJBException` unique-key race fired on persist. The caller should backoff and retry.

The error body uses the existing structured shape (`errorCode`, `errorMsg`, `usrMsg`, `devMsg`); no new envelope. SaaS callers switch on the integer `errorCode`.

### What `hopsworks-managed` can simplify once deployed

Replace the blanket "Project name already exists" handler in `src/lib/hopsworks-api.ts:222-229` with a switch on `errorCode`:

```ts
switch (body.errorCode) {
  case 150001: // PROJECT_EXISTS, true name conflict
    throw new ProjectNameTakenError(body.usrMsg);
  case 150099: // PROJECT_IN_PARTIAL_STATE
    // devMsg contains "projectId: 1234"
    const projectId = parseProjectIdFromDevMsg(body.devMsg);
    await forcePurgeProject(credentials, projectId);
    return retryCreate();  // one-shot, same provisioning call
  case 150100: // PROJECT_CREATION_IN_PROGRESS
    return retryWithBackoff();
  default:
    throw new Error(body.errorMsg);
}
```

Eliminates the "phantom project" support category: when SaaS sees a partial-state response, it has both the projectId and a clear remediation path.

### Pointers to the EE change

- `hopsworks-rest-utils/.../RESTCodes.java`: `PROJECT_IN_PARTIAL_STATE`, `PROJECT_CREATION_IN_PROGRESS`
- `hopsworks-common/.../project/ProjectController.java`: `createProjectDbMetadata` disambiguates by `creationStatus`; the `EJBException` catch on `createProjectDbMetadata` now maps to `PROJECT_CREATION_IN_PROGRESS`

---

## Brief #5: Project member / role API

**Status**: IN PROGRESS (shipped on `feature/saas-augmentation`, pending merge and deploy)

### Problem

Hopsworks had no first-class admin API for managing project membership. `hopsworks-managed` maintained team membership and project roles in `project_member_roles` (Supabase), but could not push these as enforceable membership upstream. Drift: our DB says alice is a `Data Scientist` on project foo, but Hopsworks may not reflect that.

### Backend fix (shipped in `hopsworks-ee`)

Four admin endpoints under `ProjectsAdminResource`, all `HOPS_ADMIN`-gated, reuse the existing `ProjectController` membership methods:

```http
GET /admin/projects/{projectId}/members
→ 200 [ProjectMemberAdminDTO]
```

```http
POST /admin/projects/{projectId}/members
{ "userId": 10181, "role": "Data scientist" | "Data owner" | "Observer" }
→ 201 ProjectMemberAdminDTO
```

```http
PUT /admin/projects/{projectId}/members/{userId}
{ "role": "Data owner" }
→ 200 ProjectMemberAdminDTO
```

```http
DELETE /admin/projects/{projectId}/members/{userId}?deleteHomeDir=false
→ 204
```

`ProjectMemberAdminDTO` shape: `{userId, username, email, role, addedAt}`.

Notes:

- `userId` keys consistently across the API (brief asked for it; matches our `Users.uid` PK).
- Role values match `ProjectRoleTypes` constants; invalid roles return `409 PROJECT_TEAM_ROLE_NOT_SUPPORTED` (existing code).
- `DELETE` refuses to remove the project owner (returns `403 PROJECT_OWNER_NOT_ALLOWED`); use `DELETE /admin/projects/{id}` to delete the project itself.
- Beyond the three endpoints in the brief, `PUT` for role updates was added en passant. Without it, a role change requires DELETE + POST and triggers the full leave/join cleanup flow. The new `PUT` reuses `ProjectController.updateMemberRole` directly.

### What `hopsworks-managed` can simplify once deployed

- `src/pages/api/auth/sync-user.ts` Health Check 7 (`team_member_missing_project_access`): flip from "log only" to auto-repair. Call `POST /admin/projects/{projectId}/members` with the role from `project_member_roles`.
- `src/components/admin/ProjectRoleManager.tsx`: every Supabase write is mirrored into a `POST/PUT/DELETE /admin/projects/{id}/members` call. `project_member_roles` becomes a cache of upstream truth, not source of truth.
- `src/pages/api/team/invite.ts`, `src/pages/api/team/accept-invite.ts`: same pattern. Add the call upstream after the local DB write.
- Drift between our `project_member_roles` and effective Hopsworks access disappears.

### Pointers to the EE change

- `hopsworks-api/.../admin/dto/ProjectMemberAdminDTO.java`: input/output DTO
- `hopsworks-api/.../admin/projects/ProjectsAdminResource.java`: 4 new endpoints (`listMembers`, `addMember`, `updateMemberRole`, `removeMember`)
- Reuses `ProjectController.findProjectTeamById`, `addMember`, `updateMemberRole`, `removeMemberFromTeam`

---

## Brief #6: SaaS-managed cluster mode (login lock + compute hide)

**Status**: IN PROGRESS (shipped on `feature/saas-augmentation`, pending merge and deploy)

### Problem

On a Hopsworks cluster backing `run.hopsworks.ai`, users could reach the cluster URL directly and:

1. Log in via the native password form, bypassing the Auth0 → `run.hopsworks.ai` → cluster session path. A soft-deleted user might still have a valid Hopsworks account and authenticate before propagation finishes.
2. Read cluster compute internals (variables, K8s cluster info) that have no business reaching SaaS end users.

### Backend fix (shipped in `hopsworks-ee`)

A single cluster-level flag `MANAGEMENT_MODE`:

- `STANDALONE` (default): existing stock Hopsworks behaviour, nothing changed.
- `SAAS_MANAGED`: native auth and compute-info exposure are blocked.

Concrete gates added in SAAS_MANAGED mode:

- `POST /auth/login`, `POST /auth/register`, `POST /auth/recover/password`, `POST /auth/recover/qrCode`: all return `403 SAAS_MANAGED_AUTH_REQUIRED` with `devMsg` carrying the configured `SAAS_ENTRY_POINT_URL`. The four entry points cover password login, signup, and the two recovery flows.
- `GET /variables/{id}`: locked to `HOPS_ADMIN` regardless of the variable's `VariablesVisibility` flag. In standalone, USER-visibility variables remain readable; in SAAS_MANAGED, every variable lookup requires admin.
- `GET /admin/projects/{id}/kube/clusterinfo`: returns `403 REST_ACCESS_CONTROL` to non-admin users in SAAS_MANAGED. Standalone behaviour unchanged.
- OAuth-flow `accountType: OAUTH2` and `REMOTE_ACCOUNT_TYPE` users continue to authenticate through the existing remote-user path (untouched).
- `GET /variables/authenticationStatus` (anonymous, JWT-not-required): now also returns `managementMode` and `saasEntryPointUrl`. The frontend reads this on the login page to skip the native form and redirect to the SaaS entry point. Required because the `/variables/{id}` lockdown above also blocks pre-login reads of `MANAGEMENT_MODE` itself.

Two new `Settings` keys:

- `MANAGEMENT_MODE`: `STANDALONE` | `SAAS_MANAGED` (default `STANDALONE`).
- `SAAS_ENTRY_POINT_URL`: e.g. `https://run.hopsworks.ai`. Echoed in the 403 `devMsg` so callers know where to redirect, and surfaced on `authenticationStatus` so the frontend can redirect proactively.

The flip is one DB-backed setting (`hopsworks.variables`); no migration needed.

### What `hopsworks-managed` can simplify once deployed

- Set `MANAGEMENT_MODE=SAAS_MANAGED` and `SAAS_ENTRY_POINT_URL=https://run.hopsworks.ai` on every SaaS cluster (one-time, via the existing `PUT /admin/variables/{name}` admin endpoint or terraform/helm config).
- `updateHopsworksUserStatus(..., 3)` in `src/lib/hopsworks-api.ts:393-419`: keep as a defense-in-depth, but the urgency drops dramatically. A soft-deleted user can no longer authenticate even if propagation is delayed.
- `src/pages/api/auth/sync-user.ts`: the "block soft-deleted users at the run.hopsworks.ai layer" path stays. The "user who skips that layer entirely" hole is now closed at the cluster.
- Frontend hides the native login form when `authenticationStatus.managementMode === "SAAS_MANAGED"` and redirects to `authenticationStatus.saasEntryPointUrl` (the cluster will reject the native form regardless, but UX is cleaner).

### Known scope limits (follow-up work)

The compute-info hide is targeted rather than exhaustive. Job execution DTOs still expose `appId` (Yarn application ID) and similar fields to the project's data scientists; that is needed for log retrieval so blanking it is non-trivial. If managed wants a fuller hide of every compute-related field across `ExecutionDTO`, `JobDTO`, `JupyterRaySessionDTO`, etc., file a follow-up brief and we can do a structured DTO-sanitization pass.

### Pointers to the EE change

- `hopsworks-common/.../util/Settings.java`: `MANAGEMENT_MODE`, `SAAS_ENTRY_POINT_URL`, `Settings.isSaasManaged()` helper
- `hopsworks-rest-utils/.../RESTCodes.java`: `UserErrorCode.SAAS_MANAGED_AUTH_REQUIRED` (160072)
- `hopsworks-api/.../user/AuthService.java`: `rejectIfSaasManaged()` helper, called from `login`, `register`, `recoverPassword`, `recoverQRCode`
- `hopsworks-api/.../util/VariablesService.java`: `getVar` admin-gates all variables in SAAS_MANAGED; `getAuthenticationStatus` surfaces `managementMode` and `saasEntryPointUrl` for the login page
- `hopsworks-api/.../util/AuthenticationStatus.java`: DTO carries the two new fields (JWT-not-required, anonymous-readable)
- `hopsworks-api/.../kube/project/KubeProjectResourceService.java`: `getInfo` admin-gates `clusterinfo` in SAAS_MANAGED

---

## Brief #7: Project creation policy by cluster mode

**Status**: IN PROGRESS (shipped on `feature/saas-augmentation`, pending merge and deploy; depends on briefs #1 and #6)

### Problem

The SaaS layer enforces a project-creation policy that did not exist in standalone Hopsworks. We pushed `maxNumProjects` per user on every state change, but during the window between user creation and the policy push, new users defaulted to the standalone `MAX_NUM_PROJ_PER_USER = 5`. Plus the SaaS code did not know which cluster mode it was operating against, so the override was always pushed even on non-SaaS deployments.

### Backend fix (shipped in `hopsworks-ee`)

Reuses the `MANAGEMENT_MODE` flag from brief #6. New helper `Settings.getDefaultMaxNumProjects()`:

- `STANDALONE`: returns the existing `MAX_NUM_PROJ_PER_USER` setting value (default `5`, admin-configurable). Behaviour unchanged from today.
- `SAAS_MANAGED`: forces `0`. New users land with no project-creation rights regardless of `MAX_NUM_PROJ_PER_USER`.

Three call sites switched from the raw `MAX_NUM_PROJ_PER_USER` lookup to the helper:

- `UsersController.createNewUser` (local password creation path)
- `UsersController.createNewRemoteUser` (OAuth / remote-user path; the OAuth account-creation race is closed here)
- `UsersAdminResource.createUser` (admin-driven creation)

Result: on a `SAAS_MANAGED` cluster, every new account, however it lands, starts with `maxNumProjects = 0`. The SaaS layer must explicitly grant quota via `PUT /admin/users/{id}` (existing endpoint, `maxNumProjects` field).

### What `hopsworks-managed` can simplify once deployed

- `src/lib/cluster-assignment.ts`: keep the explicit grant call, but the urgency drops. The race window between OAuth-driven user creation and our tier-policy push is closed at the cluster.
- `src/pages/api/auth/sync-user.ts` Health Check 5 (`maxNumProjects below tier baseline`): with brief #1's fix removing the ratchet AND brief #7 removing the race, this check should never trigger. Downgrade to alerting only; if it triggers, something else is wrong.
- `src/pages/api/admin/fix-project-quotas.ts`: already deletable per brief #1.
- Billing-mode change paths still re-push `maxNumProjects` (that is the SaaS quota policy enforcement). Unchanged.
- Combined effect of briefs #1 + #2 + #7: drop the entire `user_projects` reconciliation table. The policy is "SaaS pushes `maxNumProjects` once at the right billing event, Hopsworks frees the slot on deletion, that is the whole story."

### Pointers to the EE change

- `hopsworks-common/.../util/Settings.java`: `getDefaultMaxNumProjects()` helper (returns 0 in SAAS_MANAGED, `MAX_NUM_PROJ_PER_USER` value otherwise)
- `hopsworks-common/.../user/UsersController.java`: `createNewUser`, `createNewRemoteUser` use the helper
- `hopsworks-api/.../admin/UsersAdminResource.java`: `createUser` uses the helper
- `MANAGEMENT_MODE` setting (brief #6) drives the behaviour; no new setting added

---

## Cross-references

- Briefs #1 + #2 + #7 together eliminate the entire `user_projects` reconciliation machinery
- Briefs #3 + #5 together eliminate most of the `health_check_failures` system
- Briefs #6 + #7 share the cluster `managementMode` primitive: ship them together if possible

## What is intentionally **not** in this list

- `SaasFreeUser` / `SaasPostpaidUser` user types: rejected. Tier business policy belongs in `hopsworks-managed`, not in the Hopsworks core. Generic primitives (quotas, feature flags, status) over named business types.
- Stripe / billing logic in Hopsworks: rejected for the same reason.
- Cluster migration API (`POST /admin/users/{id}/migrate-cluster`): noted as a future concern, not yet justified by current workaround volume.

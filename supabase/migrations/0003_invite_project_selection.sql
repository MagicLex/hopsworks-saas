-- Team invites: let the owner pick which projects the member joins,
-- instead of all-or-nothing.
--
-- NULL project_ids + auto_assign_projects=true  → all current + future projects (legacy behavior)
-- non-empty project_ids                          → only those project IDs
-- auto_assign_projects=false                     → no projects
--
-- Idempotent: safe to re-run.

ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS project_ids text[];

COMMENT ON COLUMN public.team_invites.project_ids IS
  'Hopsworks project IDs to add the member to on accept. NULL = all owner projects (when auto_assign_projects). Empty/non-null = explicit subset.';

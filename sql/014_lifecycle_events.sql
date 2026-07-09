-- Append-only log of Hopsworks lifecycle webhook events, powering the admin
-- activity view. The receiver stays state-based; this table is observability
-- only, written best-effort after the event is handled (a failed insert never
-- fails the webhook). History starts at deploy time, nothing is backfilled.

create table if not exists lifecycle_events (
  id bigint generated always as identity primary key,
  event text not null,
  cluster_id uuid,
  hopsworks_user_id integer,
  user_id text,            -- SaaS user id when resolvable at ingest time
  email text,
  project_id integer,
  project_name text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists lifecycle_events_user_created_idx
  on lifecycle_events (user_id, created_at desc);
create index if not exists lifecycle_events_created_idx
  on lifecycle_events (created_at desc);

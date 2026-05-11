import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';
import crypto from 'crypto';

// Receiver for the Hopsworks lifecycle outbox (backend brief #3).
// Cluster posts here over its egress; we verify HMAC-SHA256 and reconcile
// Supabase from the payload's *current state*. The cluster's outbox may
// collapse transitions, so handlers MUST be idempotent and state-based.

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

type LifecycleEvent =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'project.created'
  | 'project.deleted'
  | 'project.member.added'
  | 'project.member.updated'
  | 'project.member.removed';

interface LifecyclePayload {
  event: LifecycleEvent;
  timestamp: string;
  clusterId: string;
  data: Record<string, unknown>;
}

function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const secret = process.env.HOPSWORKS_LIFECYCLE_WEBHOOK_SECRET;
  if (!secret) return false;
  const match = /^sha256=([a-f0-9]+)$/i.exec(header);
  if (!match) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const provided = Buffer.from(match[1], 'hex');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = await buffer(req);
  const sig = req.headers['x-hopsworks-signature'];
  const sigHeader = Array.isArray(sig) ? sig[0] : sig;

  if (!verifySignature(raw, sigHeader)) {
    console.error('[Hopsworks webhook] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: LifecyclePayload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    console.error('[Hopsworks webhook] Invalid JSON', err);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (!payload.event || !payload.data || !payload.clusterId) {
    return res.status(400).json({ error: 'Missing event, data, or clusterId' });
  }

  console.log(
    `[Hopsworks webhook] event=${payload.event} cluster=${payload.clusterId} ts=${payload.timestamp}`,
    payload.data
  );

  try {
    switch (payload.event) {
      case 'user.deleted':
        await handleUserDeleted(payload);
        break;
      case 'project.created':
        await handleProjectCreated(payload);
        break;
      case 'project.deleted':
        await handleProjectDeleted(payload);
        break;
      case 'user.created':
      case 'user.updated':
      case 'project.member.added':
      case 'project.member.updated':
      case 'project.member.removed':
        // v2 — not yet wired. Ack to drain the outbox.
        console.log(`[Hopsworks webhook] ${payload.event} not yet handled, ack'd`);
        break;
      default:
        console.warn(`[Hopsworks webhook] Unknown event type: ${payload.event}`);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[Hopsworks webhook] Handler error for ${payload.event}:`, err);
    return res.status(500).json({ error: 'Handler failed' });
  }
}

async function handleUserDeleted(payload: LifecyclePayload) {
  const userId = payload.data.userId;
  if (typeof userId !== 'number') {
    console.warn('[Hopsworks webhook] user.deleted missing numeric userId', payload.data);
    return;
  }

  const { data: user, error: lookupErr } = await supabaseAdmin
    .from('users')
    .select('id, deleted_at')
    .eq('hopsworks_user_id', userId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!user) {
    console.log(`[Hopsworks webhook] user.deleted: no SaaS user for hopsworks_user_id=${userId}, skipping`);
    return;
  }
  if (user.deleted_at) {
    console.log(`[Hopsworks webhook] user.deleted: SaaS user ${user.id} already deleted, no-op`);
    return;
  }

  const { error: updateErr } = await supabaseAdmin
    .from('users')
    .update({
      deleted_at: new Date().toISOString(),
      deletion_reason: 'hopsworks_lifecycle_webhook',
      status: 'deleted',
    })
    .eq('id', user.id);
  if (updateErr) throw updateErr;
  console.log(`[Hopsworks webhook] user.deleted: marked SaaS user ${user.id} deleted`);
}

async function handleProjectCreated(payload: LifecyclePayload) {
  const projectId = payload.data.projectId;
  const name = payload.data.name;
  const ownerId = payload.data.ownerId;
  const creationStatus = payload.data.creationStatus;

  if (typeof projectId !== 'number' || typeof ownerId !== 'number' || typeof name !== 'string') {
    console.warn('[Hopsworks webhook] project.created malformed data', payload.data);
    return;
  }

  // Only DONE projects count as active. ONGOING / FAILED / UNDER_REMOVAL → inactive
  // so they don't consume a quota slot in our local view (mirrors backend brief #1+#2).
  const isActive = creationStatus === 'DONE';

  const { data: owner, error: ownerErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('hopsworks_user_id', ownerId)
    .maybeSingle();
  if (ownerErr) throw ownerErr;
  if (!owner) {
    console.log(
      `[Hopsworks webhook] project.created: no SaaS user for hopsworks_user_id=${ownerId} (project=${name}), skipping`
    );
    return;
  }

  const { error: upsertErr } = await supabaseAdmin.from('user_projects').upsert(
    {
      user_id: owner.id,
      project_id: projectId,
      project_name: name,
      namespace: name,
      status: isActive ? 'active' : 'inactive',
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,project_id' }
  );
  if (upsertErr) throw upsertErr;
  console.log(
    `[Hopsworks webhook] project.created: upserted user=${owner.id} project_id=${projectId} status=${
      isActive ? 'active' : 'inactive'
    } creationStatus=${creationStatus}`
  );
}

async function handleProjectDeleted(payload: LifecyclePayload) {
  const projectId = payload.data.projectId;
  if (typeof projectId !== 'number') {
    console.warn('[Hopsworks webhook] project.deleted missing numeric projectId', payload.data);
    return;
  }

  const { error } = await supabaseAdmin
    .from('user_projects')
    .update({ status: 'inactive', last_seen_at: new Date().toISOString() })
    .eq('project_id', projectId);
  if (error) throw error;
  console.log(`[Hopsworks webhook] project.deleted: marked project_id=${projectId} inactive`);
}

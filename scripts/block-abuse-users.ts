#!/usr/bin/env ts-node
/**
 * Block users flagged for abuse (mining, fraud, etc).
 *
 * - Sets Supabase status='suspended' with reason='abuse'
 * - Sets Hopsworks status=4 (BLOCKED_ACCOUNT) — distinct from
 *   status=3 (DEACTIVATED) which suspendUser() uses for payment issues.
 * - Cascades to team members if user is an account owner.
 * - Idempotent: re-running on already-blocked users just re-confirms Hopsworks state.
 *
 * Usage:
 *   tsx scripts/block-abuse-users.ts <email1> <email2> ...
 *   tsx scripts/block-abuse-users.ts --dry-run <email1> ...
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { updateHopsworksUserStatus } from '../src/lib/hopsworks-api';

dotenv.config({ path: '.env.local' });

const REASON = 'abuse';
const HW_BLOCKED = 4 as const;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const emails = args.filter(a => !a.startsWith('--'));

if (emails.length === 0) {
  console.error('Usage: tsx scripts/block-abuse-users.ts [--dry-run] <email1> <email2> ...');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

interface Outcome {
  email: string;
  userId?: string;
  supabaseBefore?: string;
  supabaseAfter?: string;
  hwBefore?: number;
  hwAfter?: number;
  error?: string;
}

async function fetchHwStatus(apiUrl: string, apiKey: string, hwUserId: number): Promise<number | undefined> {
  try {
    const res = await fetch(`${apiUrl}/hopsworks-api/api/admin/users/${hwUserId}`, {
      headers: { Authorization: `ApiKey ${apiKey}` }
    });
    if (!res.ok) return undefined;
    const body = await res.json() as { status?: number };
    return body.status;
  } catch {
    return undefined;
  }
}

async function blockOne(email: string): Promise<Outcome> {
  const out: Outcome = { email };

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, email, status, account_owner_id, metadata')
    .eq('email', email)
    .single() as { data: { id: string; email: string; status: string; account_owner_id: string | null; metadata: Record<string, unknown> | null } | null; error: any };

  if (userErr || !user) {
    out.error = `user not found in supabase (${userErr?.message || 'no row'})`;
    return out;
  }

  out.userId = user.id;
  out.supabaseBefore = user.status;

  const { data: assignment } = await supabase
    .from('user_hopsworks_assignments')
    .select('hopsworks_user_id, hopsworks_clusters ( api_url, api_key, name )')
    .eq('user_id', user.id)
    .single() as { data: { hopsworks_user_id: number; hopsworks_clusters: { api_url: string; api_key: string; name: string } } | null };

  if (assignment) {
    out.hwBefore = await fetchHwStatus(assignment.hopsworks_clusters.api_url, assignment.hopsworks_clusters.api_key, assignment.hopsworks_user_id);
  }

  if (dryRun) {
    console.log(`[dry-run] ${email}: supabase=${out.supabaseBefore} hw=${out.hwBefore} → would set supabase=suspended, hw=${HW_BLOCKED}`);
    return out;
  }

  // Always (re)write status + suspension_reason: the reason is what the
  // signup-time IP-reuse check matches on, so re-running this script
  // backfills accounts suspended before the reason was persisted.
  const { error: updErr } = await supabase
    .from('users')
    .update({
      status: 'suspended',
      metadata: { ...(user.metadata ?? {}), suspension_reason: REASON }
    })
    .eq('id', user.id);
  if (updErr) {
    out.error = `supabase update failed: ${updErr.message}`;
    return out;
  }
  out.supabaseAfter = 'suspended';

  if (assignment) {
    try {
      await updateHopsworksUserStatus(
        { apiUrl: assignment.hopsworks_clusters.api_url, apiKey: assignment.hopsworks_clusters.api_key },
        assignment.hopsworks_user_id,
        HW_BLOCKED
      );
      out.hwAfter = await fetchHwStatus(assignment.hopsworks_clusters.api_url, assignment.hopsworks_clusters.api_key, assignment.hopsworks_user_id);
    } catch (e: any) {
      out.error = `hopsworks block failed: ${e.message}`;
    }
  } else {
    out.error = (out.error ? out.error + '; ' : '') + 'no hopsworks assignment';
  }

  if (user.account_owner_id === null) {
    const { data: members } = await supabase
      .from('users')
      .select('email')
      .eq('account_owner_id', user.id) as { data: { email: string }[] | null };
    if (members && members.length > 0) {
      console.log(`  ↳ ${user.email} owns ${members.length} team member(s); cascading...`);
      for (const m of members) {
        const r = await blockOne(m.email);
        printOutcome(r, '    ');
      }
    }
  }

  return out;
}

function printOutcome(o: Outcome, indent = '') {
  const tag = o.error ? '❌' : (o.hwAfter === HW_BLOCKED ? '✅' : '⚠️ ');
  console.log(
    `${indent}${tag} ${o.email}  supabase: ${o.supabaseBefore || '?'} → ${o.supabaseAfter || o.supabaseBefore || '?'}` +
    `  hw: ${o.hwBefore ?? '?'} → ${o.hwAfter ?? o.hwBefore ?? '?'}` +
    (o.error ? `  ERR: ${o.error}` : '')
  );
}

(async () => {
  console.log(`Blocking ${emails.length} user(s) for abuse${dryRun ? ' [DRY RUN]' : ''}\n`);
  const outcomes: Outcome[] = [];
  for (const email of emails) {
    const o = await blockOne(email);
    outcomes.push(o);
    printOutcome(o);
  }

  console.log('\nSummary:');
  console.log(`  blocked:  ${outcomes.filter(o => !o.error && o.hwAfter === HW_BLOCKED).length}`);
  console.log(`  partial:  ${outcomes.filter(o => !o.error && o.hwAfter !== HW_BLOCKED).length}`);
  console.log(`  failed:   ${outcomes.filter(o => o.error).length}`);
})().catch(e => { console.error(e); process.exit(1); });

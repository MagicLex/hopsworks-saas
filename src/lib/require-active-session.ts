import { NextApiRequest, NextApiResponse } from 'next';
import { getSession, Session } from '@auth0/nextjs-auth0';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Auth0 session + soft-delete gate. Returns the session on success; otherwise
// writes 401/403 and returns null so callers `if (!session) return;`.
// Soft-deleted users slip past Auth0 (their token is still valid) — every
// user-facing endpoint must gate here, not just sync-user.
export async function requireActiveSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<Session | null> {
  const session = await getSession(req, res);
  if (!session?.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('deleted_at')
    .eq('id', session.user.sub)
    .single();

  if (user?.deleted_at) {
    console.log(`[Auth] Blocked API call from deleted user ${session.user.email}`);
    res.status(403).json({ error: 'Account has been deleted', deletedAt: user.deleted_at });
    return null;
  }

  return session;
}

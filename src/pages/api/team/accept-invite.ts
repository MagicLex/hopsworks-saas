import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { hashInviteToken } from '@/lib/invite-token';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid invite token' });
    }

    const tokenHash = hashInviteToken(token);
    const { data: invite, error: inviteError } = await supabase
      .from('team_invites')
      .select(`
        *,
        account_owner:users!account_owner_id (
          id,
          name,
          email
        )
      `)
      .eq('token_hash', tokenHash)
      .is('accepted_at', null)
      .single();

    if (inviteError || !invite) {
      return res.status(404).json({ error: 'Invite not found or already used' });
    }

    // Check if invite is expired
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite has expired' });
    }

    // Check if user exists to determine signup vs login
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', invite.email.toLowerCase())
      .single();

    // Use signup for new users, login for existing
    const authEndpoint = existingUser ? '/api/auth/login' : '/api/auth/signup';
    
    // Return invite details for display on acceptance page
    return res.status(200).json({
      email: invite.email,
      invitedBy: invite.account_owner?.name || invite.account_owner?.email,
      expiresAt: invite.expires_at,
      // Construct Auth0 URL with the invite email pre-filled
      loginUrl: `${authEndpoint}?` + new URLSearchParams({
        returnTo: `/team/joining?token=${token}`,
        login_hint: invite.email
      }).toString()
    });

  } catch (error) {
    console.error('Accept invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
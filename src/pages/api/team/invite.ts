import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { rateLimit } from '../../../middleware/rateLimit';
import { getPostHogClient } from '@/lib/posthog-server';
import { handleApiError } from '@/lib/error-handler';
import {
  validateInviteRequest,
  calculateInviteExpiry
} from '@/lib/invite-validation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

async function inviteHandler(req: NextApiRequest, res: NextApiResponse) {
  const session = await requireActiveSession(req, res);
  if (!session) return;

  const userId = session.user.sub;

  if (req.method === 'POST') {
    try {
      const { email, projectRole, autoAssignProjects = true } = req.body;

      // Validate request payload
      const validation = validateInviteRequest({ email, projectRole });
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      const { normalizedEmail, role } = validation;

      // Prevent self-invite
      if (normalizedEmail === session.user.email?.toLowerCase()) {
        return res.status(400).json({ error: 'You cannot invite yourself' });
      }

      // Check if user is an account owner (account_owner_id is NULL) and has cluster access
      const { data: currentUser, error: userError } = await supabase
        .from('users')
        .select('account_owner_id, billing_mode, stripe_customer_id')
        .eq('id', userId)
        .single();

      if (userError || !currentUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (currentUser.account_owner_id !== null) {
        return res.status(403).json({ error: 'Only account owners can invite team members' });
      }

      // Check if owner has cluster assignment (required before inviting)
      const { data: clusterAssignment } = await supabase
        .from('user_hopsworks_assignments')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!clusterAssignment) {
        return res.status(403).json({
          error: 'You must complete billing setup before inviting team members',
          code: 'BILLING_REQUIRED'
        });
      }

      // Check if email is already a user
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', normalizedEmail)
        .single();

      if (existingUser) {
        return res.status(400).json({ error: 'User already exists with this email' });
      }

      // Check if there's already a pending invite
      const { data: existingInvite } = await supabase
        .from('team_invites')
        .select('id')
        .eq('email', normalizedEmail)
        .eq('account_owner_id', userId)
        .is('accepted_at', null)
        .single();

      if (existingInvite) {
        return res.status(400).json({ error: 'Invite already sent to this email' });
      }

      // Generate invite token
      const token = randomBytes(32).toString('hex');

      // Create invite with project role and auto-assign preference
      const { data: invite, error: inviteError } = await supabase
        .from('team_invites')
        .insert({
          account_owner_id: userId,
          email: normalizedEmail,
          token,
          project_role: role,
          auto_assign_projects: autoAssignProjects,
          expires_at: calculateInviteExpiry().toISOString()
        })
        .select()
        .single();

      if (inviteError) {
        console.error('Failed to create invite:', inviteError);
        return res.status(500).json({ error: 'Failed to create invite' });
      }

      // Send email with invite link
      const inviteUrl = `${process.env.AUTH0_BASE_URL}/team/accept-invite?token=${token}`;

      // Get inviter's details
      const { data: inviter } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', userId)
        .single();

      const inviterName = inviter?.name || inviter?.email || 'Your colleague';

      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'Hopsworks <no-reply@hopsworks.com>',
          to: normalizedEmail,
          subject: `${inviterName} invited you to join their Hopsworks team`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">You've been invited to join a Hopsworks team</h2>
              
              <p style="color: #666; line-height: 1.6;">
                ${inviterName} has invited you to join their team on Hopsworks. 
                As a team member, you'll have access to Hopsworks and your usage will be billed to the team account.
              </p>

              <div style="margin: 30px 0;">
                <a href="${inviteUrl}" 
                   style="background-color: #1eb182; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Accept Invitation
                </a>
              </div>

              <p style="color: #999; font-size: 14px;">
                This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
              </p>

              <p style="color: #999; font-size: 14px; margin-top: 30px;">
                Or copy and paste this link: <br>
                <a href="${inviteUrl}" style="color: #1eb182;">${inviteUrl}</a>
              </p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError);
        // Don't fail the whole operation if email fails
      }

      // Track team invite sent in PostHog
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: 'team_invite_sent',
        properties: {
          inviteeEmail: normalizedEmail,
          projectRole: role,
          autoAssignProjects,
          inviterEmail: inviter?.email,
        }
      });
      await posthog.shutdown();

      return res.status(200).json({
        message: 'Invite sent successfully',
        invite: {
          id: invite.id,
          email: invite.email,
          expires_at: invite.expires_at,
          invite_url: inviteUrl
        }
      });

    } catch (error) {
      return handleApiError(error, res, 'POST /api/team/invite');
    }
  } else if (req.method === 'GET') {
    try {
      // List pending invites for the account owner
      const { data: invites, error } = await supabase
        .from('team_invites')
        .select('*')
        .eq('account_owner_id', userId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch invites:', error);
        return res.status(500).json({ error: 'Failed to fetch invites' });
      }

      return res.status(200).json({ invites });

    } catch (error) {
      return handleApiError(error, res, 'GET /api/team/invite');
    }
  } else if (req.method === 'DELETE') {
    try {
      const { inviteId } = req.query;

      if (!inviteId || typeof inviteId !== 'string') {
        return res.status(400).json({ error: 'Invite ID is required' });
      }

      // Delete invite (only if owned by current user and not accepted)
      const { error } = await supabase
        .from('team_invites')
        .delete()
        .eq('id', inviteId)
        .eq('account_owner_id', userId)
        .is('accepted_at', null);

      if (error) {
        console.error('Failed to delete invite:', error);
        return res.status(500).json({ error: 'Failed to delete invite' });
      }

      return res.status(200).json({ message: 'Invite deleted successfully' });

    } catch (error) {
      return handleApiError(error, res, 'DELETE /api/team/invite');
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return rateLimit('teamInvite')(req, res, () => inviteHandler(req, res));
}
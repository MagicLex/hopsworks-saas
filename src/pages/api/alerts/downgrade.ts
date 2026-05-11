import { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';
import { requireInternalAuth } from '@/lib/internal-auth';

/**
 * Alert endpoint for user downgrades (postpaid → free with >1 project)
 * Called internally by /api/billing when lazy downgrade triggers.
 * Caller must forward `Authorization: Bearer ${INTERNAL_API_SECRET}`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireInternalAuth(req, res)) return;

  const { userId, email, projectCount, deadline } = req.body;

  if (!userId || !email || !projectCount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  console.log(`[Downgrade Alert] User ${email} downgraded to free with ${projectCount} projects. Deadline: ${deadline}`);

  // Send email to user
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const dashboardUrl = `${process.env.AUTH0_BASE_URL}/dashboard`;
    const deadlineDate = deadline ? new Date(deadline).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : null;

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Hopsworks <no-reply@hopsworks.com>',
        to: email,
        subject: `Action Required: Delete ${projectCount - 1} project(s) to continue on Free plan`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f59e0b;">Action Required</h2>

            <p style="color: #666; line-height: 1.6;">
              Hi,
            </p>

            <p style="color: #666; line-height: 1.6;">
              Your Hopsworks account has been switched to the <strong>Free plan</strong> because your payment method was removed.
            </p>

            <div style="background-color: #fef3c7; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #f59e0b;">
              <p style="margin: 0; color: #92400e;">
                <strong>Free plan includes 1 project only.</strong><br><br>
                You currently have <strong>${projectCount} projects</strong>. Please delete ${projectCount - 1} project(s)
                ${deadlineDate ? `by <strong>${deadlineDate}</strong>` : ''} to continue using Hopsworks.
              </p>
            </div>

            <p style="color: #666; line-height: 1.6;">
              To delete projects, go to each project's Settings page and click "Delete Project".
            </p>

            <div style="margin: 30px 0;">
              <a href="${dashboardUrl}"
                 style="background-color: #1eb182; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Go to Dashboard
              </a>
            </div>

            <p style="color: #666; line-height: 1.6;">
              <strong>Alternatively</strong>, you can <a href="${dashboardUrl}" style="color: #1eb182;">add a payment method</a> to upgrade back to Pay-as-you-go (5 projects included).
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #999; font-size: 14px;">
              If you don't take action${deadlineDate ? ` by ${deadlineDate}` : ''}, your account may be suspended until the project limit is met.
            </p>
          </div>
        `,
      });
      console.log(`[Downgrade Alert] Email sent to ${email}`);
    } catch (error) {
      console.error(`[Downgrade Alert] Failed to send email to ${email}:`, error);
    }
  }

  // Send internal alert (to admin email or Slack)
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (adminEmail && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Hopsworks <no-reply@hopsworks.com>',
        to: adminEmail,
        subject: `[Alert] User downgraded: ${email}`,
        html: `
          <div style="font-family: monospace;">
            <h3>User Downgrade Alert</h3>
            <pre>
User ID:       ${userId}
Email:         ${email}
Projects:      ${projectCount}
Deadline:      ${deadline || 'N/A'}
            </pre>
            <p>User was downgraded from postpaid to free due to missing payment method.</p>
          </div>
        `,
      });
      console.log(`[Downgrade Alert] Admin alert sent to ${adminEmail}`);
    } catch (error) {
      console.error(`[Downgrade Alert] Failed to send admin alert:`, error);
    }
  }

  return res.status(200).json({ success: true });
}

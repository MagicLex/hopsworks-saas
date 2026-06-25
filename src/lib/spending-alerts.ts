import { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SPENDING_THRESHOLDS = [80, 90, 100] as const;
type SpendingThreshold = typeof SPENDING_THRESHOLDS[number];

interface SpendingAlertsData {
  month: string;
  alerts_sent: string[];
}

interface UserWithCap {
  id: string;
  email: string;
  name?: string;
  spending_cap: number;
  spending_alerts_sent: SpendingAlertsData | null;
}

/**
 * Check spending against cap and send alerts if thresholds crossed.
 * Called after usage is calculated in collect-opencost cron.
 */
export async function checkSpendingCap(
  supabase: SupabaseClient,
  userId: string,
  accountOwnerId: string | null,
  monthlyTotal: number
): Promise<void> {
  // Billing is charged to account owner, so check their cap
  const targetUserId = accountOwnerId || userId;

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, name, spending_cap, spending_alerts_sent')
    .eq('id', targetUserId)
    .single();

  if (error || !user) {
    console.log(`[SpendingCap] User ${targetUserId} not found`);
    return;
  }

  // No cap set - nothing to check
  if (!user.spending_cap || user.spending_cap <= 0) {
    return;
  }

  const currentMonth = getCurrentMonth();
  const alertsData = parseAlertsData(user.spending_alerts_sent, currentMonth);
  const percentUsed = (monthlyTotal / user.spending_cap) * 100;

  // Determine which thresholds are crossed but not yet alerted
  const newThresholds = SPENDING_THRESHOLDS.filter(threshold =>
    percentUsed >= threshold && !alertsData.alerts_sent.includes(String(threshold))
  );

  if (newThresholds.length === 0) {
    return;
  }

  // Send alert for the highest crossed threshold
  const highestThreshold = Math.max(...newThresholds) as SpendingThreshold;

  console.log(`[SpendingCap] User ${user.email}: ${percentUsed.toFixed(1)}% of $${user.spending_cap} cap - sending ${highestThreshold}% alert`);

  await sendSpendingAlert(user as UserWithCap, highestThreshold, monthlyTotal);

  // Update alerts_sent to include all newly crossed thresholds
  const updatedAlertsSent = [
    ...alertsData.alerts_sent,
    ...newThresholds.map(String)
  ];

  await supabase
    .from('users')
    .update({
      spending_alerts_sent: {
        month: currentMonth,
        alerts_sent: updatedAlertsSent
      }
    })
    .eq('id', targetUserId);
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parse alerts data, resetting if month changed
 */
function parseAlertsData(
  data: SpendingAlertsData | null,
  currentMonth: string
): SpendingAlertsData {
  // If no data or different month, start fresh
  if (!data || data.month !== currentMonth) {
    return { month: currentMonth, alerts_sent: [] };
  }
  return data;
}

/**
 * Send spending alert email via Resend
 */
async function sendSpendingAlert(
  user: UserWithCap,
  threshold: SpendingThreshold,
  currentSpend: number
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[SpendingCap] RESEND_API_KEY not configured, skipping email');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const dashboardUrl = `${process.env.AUTH0_BASE_URL}/dashboard?tab=billing`;

  const isFrozen = threshold >= 100;
  const isThrottled = threshold >= 90 && threshold < 100;
  const subject = isFrozen
    ? `Spending cap reached: compute frozen on your account`
    : isThrottled
      ? `90% of your spending cap: compute throttled`
      : `You've reached ${threshold}% of your $${user.spending_cap} monthly cap`;

  const statusColor = isFrozen ? '#dc2626' : isThrottled ? '#f59e0b' : '#1eb182';
  const statusText = isFrozen
    ? 'Your spend has reached your monthly cap. Compute on your account is now frozen: running work drains and new workloads are rejected until your usage resets next cycle or you raise the cap. Stored data is not deleted and keeps billing.'
    : isThrottled
      ? 'You have reached 90% of your monthly cap. Compute on your account is now throttled to a minimum until your spend drops or you raise the cap.'
      : `You've used ${threshold}% of your monthly spending cap. Compute is throttled at 90% and frozen at 100%.`;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Hopsworks <no-reply@hopsworks.com>',
      to: user.email,
      subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${statusColor};">Spending Alert</h2>

          <p style="color: #666; line-height: 1.6;">
            Hi ${user.name || 'there'},
          </p>

          <p style="color: #666; line-height: 1.6;">
            ${statusText}
          </p>

          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #666;">Current Spend</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #333;">$${currentSpend.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;">Monthly Cap</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #333;">$${user.spending_cap.toFixed(2)}</td>
              </tr>
              <tr style="border-top: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #666;">Usage</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${statusColor};">${Math.round((currentSpend / user.spending_cap) * 100)}%</td>
              </tr>
            </table>
          </div>

          ${isFrozen || isThrottled ? `
          <p style="color: #666; line-height: 1.6; background-color: #fef2f2; padding: 12px; border-radius: 6px; border-left: 4px solid ${statusColor};">
            <strong>Note:</strong> This cap enforces compute limits. Raise or disable it in your dashboard to restore full capacity. Stored data keeps billing until you remove it.
          </p>
          ` : ''}

          <div style="margin: 30px 0;">
            <a href="${dashboardUrl}"
               style="background-color: #1eb182; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Usage Dashboard
            </a>
          </div>

          <p style="color: #999; font-size: 14px;">
            You can adjust or disable your spending cap at any time from your Hopsworks dashboard.
          </p>
        </div>
      `,
    });
    console.log(`[SpendingCap] Alert email sent to ${user.email}`);
  } catch (error) {
    console.error(`[SpendingCap] Failed to send alert email to ${user.email}:`, error);
  }
}

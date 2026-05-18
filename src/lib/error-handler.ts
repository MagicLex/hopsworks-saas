import { NextApiResponse } from 'next';

function formatError(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack}`;
  if (typeof error === 'object' && error !== null) return JSON.stringify(error, null, 2);
  return String(error);
}

async function sendToSlack(message: string, context?: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const text = `:rotating_light: *API Error*${context ? ` in \`${context}\`` : ''}\n\`\`\`${message.slice(0, 2000)}\`\`\``;

  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(() => {}); // Fire and forget
}

export async function alertBillingFailure(
  action: string,
  userEmail: string,
  error: unknown,
  details?: Record<string, unknown>
) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const errorMsg = formatError(error);
  const detailsStr = details ? `\n${JSON.stringify(details, null, 2)}` : '';

  const text = `:credit_card: :x: *Billing Failure*
• *Action:* \`${action}\`
• *User:* ${userEmail}
• *Error:* ${errorMsg.slice(0, 500)}${detailsStr}`;

  console.error(`[BILLING ALERT] ${action} for ${userEmail}:`, error);

  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(() => {});
}

export function handleApiError(error: unknown, res: NextApiResponse, context?: string) {
  // Log the full error for debugging
  console.error(`API Error${context ? ` in ${context}` : ''}:`, error);

  // Send to Slack in production
  if (process.env.NODE_ENV === 'production') {
    sendToSlack(formatError(error), context);
  }

  // In production, return generic error messages
  if (process.env.NODE_ENV === 'production') {
    // Check for known error types
    if (error instanceof Error) {
      // Database errors
      if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
        return res.status(409).json({ error: 'Resource already exists' });
      }
      
      // Not found errors
      if (error.message.includes('not found') || error.message.includes('does not exist')) {
        return res.status(404).json({ error: 'Resource not found' });
      }
      
      // Validation errors
      if (error.message.includes('invalid') || error.message.includes('required')) {
        return res.status(400).json({ error: 'Invalid request data' });
      }
    }
    
    // Generic error for production
    return res.status(500).json({ error: 'Internal server error' });
  }

  // In development, return more detailed errors
  if (error instanceof Error) {
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: error.stack
    });
  }

  return res.status(500).json({ 
    error: 'Internal server error',
    details: String(error)
  });
}
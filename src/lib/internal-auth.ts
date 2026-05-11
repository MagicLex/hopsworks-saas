import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` on scheduled hits.
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 *
 * Returns true if the request is authorized; otherwise writes 401 and returns false.
 * Call as: `if (!requireCronAuth(req, res)) return;`
 */
export function requireCronAuth(
  req: NextApiRequest,
  res: NextApiResponse,
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'CRON_SECRET not configured' });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * For server-to-server calls between our own API routes that don't have a
 * user session (e.g., /api/billing → /api/alerts/downgrade). Caller must
 * forward `Authorization: Bearer ${INTERNAL_API_SECRET}`.
 */
export function requireInternalAuth(
  req: NextApiRequest,
  res: NextApiResponse,
): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'INTERNAL_API_SECRET not configured' });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

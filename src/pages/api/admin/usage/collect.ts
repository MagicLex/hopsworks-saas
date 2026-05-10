import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../../middleware/adminAuth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Call the OpenCost collection endpoint directly
    const baseUrl = process.env.AUTH0_BASE_URL;
    
    const response = await fetch(`${baseUrl}/api/usage/collect-opencost`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Collection failed: ${response.statusText}`);
    }

    const result = await response.json();

    return res.status(200).json({
      message: 'OpenCost collection triggered successfully',
      result
    });
  } catch (error) {
    console.error('Error triggering collection:', error);
    return res.status(500).json({ 
      error: 'Failed to trigger collection',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export default function adminCollectHandler(req: NextApiRequest, res: NextApiResponse) {
  return requireAdmin(req, res, handler);
}
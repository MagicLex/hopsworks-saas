import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@auth0/nextjs-auth0';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await getSession(req, res);
    if (!session?.user) {
      return res.status(200).json({ isAdmin: false });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('is_admin, deleted_at')
      .eq('id', session.user.sub)
      .single();

    if (error || !user || user.deleted_at) {
      return res.status(200).json({ isAdmin: false });
    }

    return res.status(200).json({ isAdmin: user.is_admin || false });
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(200).json({ isAdmin: false });
  }
}
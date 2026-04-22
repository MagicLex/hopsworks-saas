import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const HUBSPOT_API_URL = 'https://api.hubapi.com';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;

    // Get user metadata
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('metadata, billing_mode')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is corporate
    if (user.billing_mode !== 'prepaid' || !user.metadata?.corporate_ref) {
      return res.status(200).json({ isCorporate: false });
    }

    const corporateRef = user.metadata.corporate_ref;

    // Fetch deal info from HubSpot
    try {
      const dealResponse = await fetch(
        `${HUBSPOT_API_URL}/crm/v3/objects/deals/${corporateRef}?associations=company`,
        {
          headers: {
            'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!dealResponse.ok) {
        console.error('Failed to fetch deal from HubSpot');
        return res.status(200).json({ 
          isCorporate: true,
          corporateRef,
          companyName: null,
          companyLogo: null
        });
      }

      const dealData = await dealResponse.json();

      // Try to get company details
      let companyName = null;
      let companyLogo = null;
      let companyDomain = null;

      if (dealData.associations?.companies?.results?.length > 0) {
        const companyId = dealData.associations.companies.results[0].id;
        try {
          const companyResponse = await fetch(
            `${HUBSPOT_API_URL}/crm/v3/objects/companies/${companyId}?properties=name,company,logo,website,domain`,
            {
              headers: {
                'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (companyResponse.ok) {
            const companyData = await companyResponse.json();
            companyName = companyData.properties?.name || companyData.properties?.company;
            companyLogo = companyData.properties?.logo;
            companyDomain = companyData.properties?.domain || companyData.properties?.website;
          }
        } catch (err) {
          console.error('Failed to fetch company:', err);
        }
      }

      // Fallback to Clearbit if no HubSpot logo
      if (!companyLogo && companyDomain) {
        companyLogo = `https://logo.clearbit.com/${companyDomain}`;
      }

      return res.status(200).json({
        isCorporate: true,
        corporateRef,
        companyName,
        companyLogo,
        companyDomain
      });

    } catch (error) {
      console.error('Error fetching corporate info:', error);
      return res.status(200).json({ 
        isCorporate: true,
        corporateRef,
        companyName: null,
        companyLogo: null
      });
    }

  } catch (error) {
    console.error('Error in corporate-info endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
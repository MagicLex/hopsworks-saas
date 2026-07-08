#!/usr/bin/env ts-node
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { assignUserToCluster } from '../src/lib/cluster-assignment';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const USER_IDS = [
  'google-oauth2|113080923052978582111', // mohsinrana6699@gmail.com
  'google-oauth2|101054384504099900620', // mahaasim384@gmail.com
  'auth0|6a019a56b50f838c0c48eea6',      // kurva.veeresh@nam-it.com
  'auth0|6a01a59faa336a4a64e3c994',      // abdulazeez.syed@nam-it.com
  'auth0|6a01ac5a1d54da5c097f6218',      // 20250380@novaims.unl.pt
  'auth0|6a01ac698eff2df330cbfc38',      // 20250388@novaims.unl.pt
  'github|102565617',                     // catarina.aboim.cardoso@gmail.com
  'github|232352226',                     // ccmendinhas04@gmail.com
  'auth0|6a01ad21b47d83728c47d722',      // 20250375@novaims.unl.pt
  'auth0|6a01d4118eff2df330cc2506',      // veeresh.dwh123@gmail.com
  'auth0|6a01d8cdb47d83728c48034c',      // hanzalaabbaskhan@gmail.com
  'google-oauth2|100405340907532164176', // abhishekget77@gmail.com
  'google-oauth2|100184917578835943529', // ultimategamingchannel04@gmail.com (postpaid, prio)
];

async function main() {
  console.log(`Replaying cluster assignment for ${USER_IDS.length} users\n`);

  for (const userId of USER_IDS) {
    const { data: user } = await supabase
      .from('users')
      .select('email, billing_mode, stripe_subscription_status, hopsworks_user_id')
      .eq('id', userId)
      .single();

    if (!user) {
      console.log(`SKIP ${userId} — user row not found`);
      continue;
    }

    if (user.hopsworks_user_id) {
      console.log(`SKIP ${user.email} — already has hopsworks_user_id`);
      continue;
    }

    const tag = `${user.email} [${user.billing_mode}${user.stripe_subscription_status ? `/${user.stripe_subscription_status}` : ''}]`;
    console.log(`-> ${tag}`);

    try {
      const result = await assignUserToCluster(supabase, userId, true);
      if (result.success) {
        console.log(`   OK clusterId=${result.clusterId}`);
      } else {
        console.log(`   FAIL ${result.error}`);
      }
    } catch (err) {
      console.log(`   THROW ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

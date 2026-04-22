import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getPostHogClient } from '@/lib/posthog-server';
import { sendPlanUpdated, sendUserActivated } from '../../../lib/marketing-webhooks';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;

    // Get user info
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('email, stripe_customer_id, billing_mode, account_owner_id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Team members cannot set up billing
    if (user.account_owner_id) {
      return res.status(403).json({ error: 'Team members cannot manage billing' });
    }

    // Check if already has payment method
    if (user.stripe_customer_id) {
      // Check if customer has payment methods - check all types
      const paymentMethods = await stripe.paymentMethods.list({
        customer: user.stripe_customer_id
      });

      // Also check for successful setup intents
      const setupIntents = await stripe.setupIntents.list({
        customer: user.stripe_customer_id,
        limit: 1
      });
      const hasSuccessfulSetup = setupIntents.data.some(si => si.status === 'succeeded');

      if (paymentMethods.data.length > 0 || hasSuccessfulSetup) {
        // Check if user needs a subscription (free user with payment method but no sub)
        const existingSubs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'active',
          limit: 1
        });

        if (existingSubs.data.length === 0 && user.billing_mode === 'free') {
          // User has payment method but no subscription - create one directly
          console.log(`Creating subscription for free user ${userId} with existing payment method`);

          // Get stripe products for metered billing
          const { data: stripeProducts } = await supabaseAdmin
            .from('stripe_products')
            .select('*')
            .eq('active', true);

          if (stripeProducts && stripeProducts.length > 0) {
            // Get the customer's default payment method
            const paymentMethodsList = await stripe.paymentMethods.list({
              customer: user.stripe_customer_id,
              limit: 1
            });
            const defaultPaymentMethod = paymentMethodsList.data[0]?.id;

            const subscription = await stripe.subscriptions.create({
              customer: user.stripe_customer_id,
              items: stripeProducts.map(product => ({
                price: product.stripe_price_id
              })),
              default_payment_method: defaultPaymentMethod,
              metadata: {
                user_id: userId,
                email: user.email
              }
            });

            console.log(`Created subscription ${subscription.id} with status ${subscription.status} for user ${userId}`);

            // Update user to postpaid with subscription AND clear suspended status
            await supabaseAdmin
              .from('users')
              .update({
                billing_mode: 'postpaid',
                stripe_subscription_id: subscription.id,
                stripe_subscription_status: subscription.status,
                downgrade_deadline: null,
                status: 'active'
              })
              .eq('id', userId);

            // Update maxNumProjects to 5 in Hopsworks
            try {
              const { updateUserProjectLimit } = await import('@/lib/hopsworks-api');
              const { data: assignment } = await supabaseAdmin
                .from('user_hopsworks_assignments')
                .select('hopsworks_cluster_id, hopsworks_user_id')
                .eq('user_id', userId)
                .single();

              if (assignment?.hopsworks_cluster_id && assignment?.hopsworks_user_id) {
                const { data: cluster } = await supabaseAdmin
                  .from('hopsworks_clusters')
                  .select('api_url, api_key')
                  .eq('id', assignment.hopsworks_cluster_id)
                  .single();

                if (cluster) {
                  // Only bump UP - quota workaround may have set it higher than 5
                  const { getHopsworksUserById } = await import('../../../lib/hopsworks-api');
                  const hwUser = await getHopsworksUserById(
                    { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                    assignment.hopsworks_user_id
                  );
                  if (hwUser && (hwUser.maxNumProjects ?? 0) < 5) {
                    await updateUserProjectLimit(
                      { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                      assignment.hopsworks_user_id,
                      5
                    );
                  }
                }
              }
            } catch (e) {
              console.error('Failed to update maxNumProjects:', e);
              // Log to health_check_failures - sync-user will fix on next login
              try {
                await supabaseAdmin.from('health_check_failures').insert({
                  user_id: userId,
                  email: user.email,
                  check_type: 'setup_payment_maxnumprojects',
                  error_message: 'Subscription created but maxNumProjects update failed',
                  details: { error: String(e), expected: 5 }
                });
              } catch {} // Don't fail if logging fails
            }

            console.log(`User ${userId} upgraded to postpaid with subscription ${subscription.id}`);

            // Fire webhooks for plan change (free → postpaid)
            sendPlanUpdated({
              userId,
              email: user.email,
              oldPlan: 'free',
              newPlan: 'postpaid',
              trigger: 'payment_setup'
            }).catch(err => console.error('[Marketing] Plan webhook failed:', err));

            // Redirect back to dashboard
            return res.status(200).json({
              success: true,
              redirectUrl: `${process.env.AUTH0_BASE_URL}/dashboard?payment=success&tab=billing`
            });
          }
        }

        try {
          // Create billing portal session to manage existing payment methods
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: `${process.env.AUTH0_BASE_URL}/dashboard?tab=billing`,
          });

          return res.status(200).json({ portalUrl: portalSession.url });
        } catch (portalError: any) {
          // If portal not configured, let them add another payment method
          console.error('Portal error:', portalError.message);
        }
      }
    }

    // Create customer if needed
    let stripeCustomerId = user.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: userId
        }
      });
      
      stripeCustomerId = customer.id;
      
      await supabaseAdmin
        .from('users')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', userId);
    }

    // For postpaid users, free users upgrading, or null billing_mode - create checkout session to add payment method
    // This triggers subscription creation in the webhook after successful setup
    if (!user.billing_mode || user.billing_mode === 'postpaid' || user.billing_mode === 'free') {
      // Payment method setup - subscription will be created by webhook after successful setup
      const setupSession = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        mode: 'setup',
        metadata: {
          user_id: userId,
          billing_mode: 'postpaid'
        },
        success_url: `${process.env.AUTH0_BASE_URL}/dashboard?payment=success&tab=billing`,
        cancel_url: `${process.env.AUTH0_BASE_URL}/dashboard?payment=cancelled&tab=billing`,
      });

      // Track payment method setup initiated
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: 'payment_method_added',
        properties: {
          billingMode: 'postpaid',
          stripeCustomerId,
          email: user.email,
        }
      });
      await posthog.shutdown();

      return res.status(200).json({ checkoutUrl: setupSession.url });
    }

    // For prepaid users - just add payment method via setup session
    const setupSession = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'setup',
      success_url: `${process.env.AUTH0_BASE_URL}/dashboard?payment=success&tab=billing`,
      cancel_url: `${process.env.AUTH0_BASE_URL}/dashboard?payment=cancelled&tab=billing`,
    });

    // Track payment method setup initiated
    const posthog2 = getPostHogClient();
    posthog2.capture({
      distinctId: userId,
      event: 'payment_method_added',
      properties: {
        billingMode: user.billing_mode || 'prepaid',
        stripeCustomerId,
        email: user.email,
      }
    });
    await posthog2.shutdown();

    return res.status(200).json({ checkoutUrl: setupSession.url });

  } catch (error) {
    console.error('Error setting up payment:', error);
    return res.status(500).json({ 
      error: 'Failed to set up payment method' 
    });
  }
}
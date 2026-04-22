import { NextApiRequest, NextApiResponse } from 'next';
import { requireActiveSession } from '@/lib/require-active-session';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getPostHogClient } from '@/lib/posthog-server';

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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;
    const email = session.user.email;

    // Get user data
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate user can have subscription
    if (user.account_owner_id) {
      return res.status(400).json({ error: 'Team members cannot have subscriptions' });
    }

    if (user.billing_mode !== 'postpaid') {
      return res.status(400).json({ error: 'Only postpaid users can have subscriptions' });
    }

    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'Stripe customer must be created first' });
    }

    // Check if subscription already exists in our database
    if (user.stripe_subscription_id) {
      // Verify it exists in Stripe
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        if (subscription && (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due')) {
          return res.status(200).json({ 
            subscription: {
              id: subscription.id,
              status: subscription.status,
              existingSubscription: true
            }
          });
        }
      } catch (error) {
        // Subscription doesn't exist in Stripe, clear it from DB
        await supabaseAdmin
          .from('users')
          .update({
            stripe_subscription_id: null,
            stripe_subscription_status: null
          })
          .eq('id', userId);
      }
    }

    // Check if subscription already exists in Stripe (but not in our DB)
    const existingSubscriptions = await stripe.subscriptions.list({
      customer: user.stripe_customer_id,
      limit: 10,
      status: 'all'
    });

    // Find active or trialing subscription
    const activeSubscription = existingSubscriptions.data.find(
      sub => sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
    );

    if (activeSubscription) {
      // Subscription exists in Stripe - sync it to DB
      await supabaseAdmin
        .from('users')
        .update({
          stripe_subscription_id: activeSubscription.id,
          stripe_subscription_status: activeSubscription.status
        })
        .eq('id', userId);

      return res.status(200).json({ 
        subscription: {
          id: activeSubscription.id,
          status: activeSubscription.status,
          existingSubscription: true,
          synced: true
        }
      });
    }

    // No existing subscription - create a new one
    const { data: stripeProducts } = await supabaseAdmin
      .from('stripe_products')
      .select('*')
      .eq('active', true);

    if (!stripeProducts || stripeProducts.length === 0) {
      return res.status(500).json({ error: 'No active Stripe products configured' });
    }

    // Create subscription with metered prices
    const subscription = await stripe.subscriptions.create({
      customer: user.stripe_customer_id,
      items: stripeProducts.map(product => ({
        price: product.stripe_price_id
      })),
      metadata: {
        user_id: userId,
        email: email
      }
    });

    // Update user with subscription ID
    await supabaseAdmin
      .from('users')
      .update({
        stripe_subscription_id: subscription.id,
        stripe_subscription_status: subscription.status
      })
      .eq('id', userId);

    console.log(`Created new subscription ${subscription.id} for user ${email}`);

    // Track subscription creation in PostHog
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: 'subscription_created',
      properties: {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        billingMode: user.billing_mode,
        email: email,
        stripeCustomerId: user.stripe_customer_id,
        productCount: stripeProducts.length,
      }
    });
    await posthog.shutdown();

    return res.status(201).json({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        created: true
      }
    });

  } catch (error) {
    console.error('Error creating subscription:', error);
    return res.status(500).json({ 
      error: 'Failed to create subscription',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
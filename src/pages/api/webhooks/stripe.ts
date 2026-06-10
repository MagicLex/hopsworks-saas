import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { buffer } from 'micro';
import { Resend } from 'resend';
import { assignUserToCluster } from '../../../lib/cluster-assignment';
import { reactivateUser } from '../../../lib/user-status';
import { handleApiError, alertBillingFailure } from '../../../lib/error-handler';
import { updateUserProjectLimit } from '../../../lib/hopsworks-api';
import { sendPlanUpdated } from '../../../lib/marketing-webhooks';
import { syncUserProjects } from '../../../lib/project-sync';

const resend = new Resend(process.env.RESEND_API_KEY);

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

// Disable body parsing, need raw body for webhook signature verification
export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err instanceof Error ? err.message : String(err));
    return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Idempotence check - skip if already processed
  const { data: existingEvent } = await supabaseAdmin
    .from('stripe_processed_events')
    .select('event_id')
    .eq('event_id', event.id)
    .single();

  if (existingEvent) {
    console.log(`Webhook event ${event.id} already processed - skipping`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        
        // Handle payment method setup
        if (session.mode === 'setup' && session.customer) {
          await handlePaymentMethodSetup(session);
        }
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log('Invoice paid:', invoice.id);
        break;
      }

      case 'payment_method.attached': {
        const paymentMethod = event.data.object as Stripe.PaymentMethod;
        await handlePaymentMethodAttached(paymentMethod);
        break;
      }

      case 'payment_method.detached': {
        const paymentMethod = event.data.object as Stripe.PaymentMethod;
        const previousAttributes = (event.data as any).previous_attributes;
        await handlePaymentMethodDetached(paymentMethod, previousAttributes);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Mark event as processed (idempotence)
    try {
      await supabaseAdmin
        .from('stripe_processed_events')
        .insert({ event_id: event.id, event_type: event.type });
    } catch {} // Don't fail webhook if insert fails

    return res.status(200).json({ received: true });
  } catch (error) {
    return handleApiError(error, res, 'POST /api/webhooks/stripe');
  }
}

async function handlePaymentMethodSetup(session: Stripe.Checkout.Session) {
  const customerId = session.customer as string;
  console.log(`Payment method setup completed for customer ${customerId}`);

  // Get user by Stripe customer ID
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, billing_mode, stripe_subscription_id, status')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    // Reactivate suspended users when payment method is added
    if (user.status === 'suspended') {
      await reactivateUser(supabaseAdmin as any, user.id, 'payment_method_setup');
    }

    // Upgrade free tier users to postpaid when they add a payment method
    if (user.billing_mode === 'free') {
      console.log(`Upgrading user ${user.id} from free to postpaid`);
      await supabaseAdmin
        .from('users')
        .update({ billing_mode: 'postpaid' })
        .eq('id', user.id);
      user.billing_mode = 'postpaid'; // Update local reference

      // Fire webhook for plan change
      sendPlanUpdated({
        userId: user.id,
        email: user.email,
        oldPlan: 'free',
        newPlan: 'postpaid',
        trigger: 'payment_setup'
      }).catch(err => console.error('[Marketing] Plan webhook failed:', err));

      // Update maxNumProjects from 1 to 5 in Hopsworks
      try {
        const { data: assignment } = await supabaseAdmin
          .from('user_hopsworks_assignments')
          .select('hopsworks_user_id, hopsworks_cluster_id')
          .eq('user_id', user.id)
          .single();

        if (assignment?.hopsworks_user_id) {
          const { data: cluster } = await supabaseAdmin
            .from('hopsworks_clusters')
            .select('api_url, api_key')
            .eq('id', assignment.hopsworks_cluster_id)
            .single();

          if (cluster) {
            await updateUserProjectLimit(
              { apiUrl: cluster.api_url, apiKey: cluster.api_key },
              assignment.hopsworks_user_id,
              5
            );
            console.log(`Updated maxNumProjects to 5 for user ${user.id} after free->postpaid upgrade`);
          }
        }
      } catch (error) {
        await alertBillingFailure('update_maxNumProjects', user.email, error, { userId: user.id, expected: 5 });
      }
    }

    // For postpaid users (or null billing_mode), create subscription if not exists
    if ((!user.billing_mode || user.billing_mode === 'postpaid') && !user.stripe_subscription_id) {
      try {
        // Check Stripe directly for existing subscriptions (race condition guard)
        const existingSubscriptions = await stripe.subscriptions.list({
          customer: customerId,
          limit: 1
        });

        if (existingSubscriptions.data.length > 0) {
          // Already has subscription, just update our DB
          const existingSub = existingSubscriptions.data[0];
          await supabaseAdmin
            .from('users')
            .update({
              stripe_subscription_id: existingSub.id,
              stripe_subscription_status: existingSub.status
            })
            .eq('id', user.id);
          console.log(`User ${user.id} already has subscription ${existingSub.id}, synced to DB`);
        } else {
          // Get stripe products for metered billing
          const { data: stripeProducts } = await supabaseAdmin
            .from('stripe_products')
            .select('*')
            .eq('active', true);

          if (stripeProducts && stripeProducts.length > 0) {
            // Create subscription with metered prices
            const subscription = await stripe.subscriptions.create({
              customer: customerId,
              items: stripeProducts.map(product => ({
                price: product.stripe_price_id
              })),
              metadata: {
                user_id: user.id,
                email: user.email
              }
            });

            // Update user with subscription ID
            await supabaseAdmin
              .from('users')
              .update({
                stripe_subscription_id: subscription.id,
                stripe_subscription_status: subscription.status
              })
              .eq('id', user.id);

            console.log(`Created subscription ${subscription.id} for user ${user.id} after payment setup`);
          }
        }
      } catch (error) {
        await alertBillingFailure('create_subscription', user.email, error, { userId: user.id, customerId });
      }
    }
    
    // After payment and subscription setup, assign cluster
    const { data: assignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('id')
      .eq('user_id', user.id)
      .single();
    
    if (!assignment) {
      // Pass true for isManualAssignment since payment is now verified
      const { success, error } = await assignUserToCluster(supabaseAdmin, user.id, true);
      if (success) {
        console.log(`Assigned cluster to user ${user.id} after payment method setup`);
      } else {
        await alertBillingFailure('assign_cluster', user.email, error, { userId: user.id, trigger: 'payment_method_setup' });
      }
    }
  }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  // Get user by Stripe customer ID
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    // IMPORTANT: Update subscription ID FIRST so assignUserToCluster sees it
    // This ensures maxNumProjects is calculated correctly (5 for subscribers, 0 otherwise)
    await supabaseAdmin
      .from('users')
      .update({
        stripe_subscription_id: subscription.id,
        stripe_subscription_status: subscription.status
      })
      .eq('id', user.id);

    console.log(`Subscription created for user ${user.id}`);

    // Check if user already has cluster assignment
    const { data: assignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!assignment) {
      // Assign cluster now that payment is verified via subscription
      const { success, error } = await assignUserToCluster(supabaseAdmin, user.id, true);
      if (success) {
        console.log(`Assigned cluster to user ${user.id} after subscription creation`);
      } else {
        await alertBillingFailure('assign_cluster', user.email, error, { userId: user.id, trigger: 'subscription_created' });
      }
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    await supabaseAdmin
      .from('users')
      .update({
        stripe_subscription_status: subscription.status
      })
      .eq('id', user.id);
    
    console.log(`Subscription updated for user ${user.id}: ${subscription.status}`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, billing_mode, downgrade_deadline')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    // Update subscription status in DB
    await supabaseAdmin
      .from('users')
      .update({
        stripe_subscription_status: 'canceled',
        stripe_subscription_id: null
      })
      .eq('id', user.id);

    // If user already has a valid downgrade deadline, they're in grace period - don't suspend
    if (user.billing_mode === 'free' && user.downgrade_deadline) {
      const deadline = new Date(user.downgrade_deadline);
      if (deadline > new Date()) {
        console.log(`User ${user.id} already in free tier with grace period until ${user.downgrade_deadline} - not suspending`);
        return;
      }
    }

    // Downgrade to free tier instead of suspending
    // Sync projects before counting — user_projects may be stale (last synced at login)
    try {
      const syncResult = await syncUserProjects(user.id);
      if (!syncResult.success) {
        await alertBillingFailure('sync_projects', user.email, new Error(syncResult.error || 'unknown'), { userId: user.id, trigger: 'subscription_deleted' });
      }
    } catch (e) {
      await alertBillingFailure('sync_projects', user.email, e, { userId: user.id, trigger: 'subscription_deleted' });
    }

    // Get project count from our DB — Hopsworks numActiveProjects includes deleted projects
    let projectCount = 0;
    try {
      const { data: activeProjects } = await supabaseAdmin
        .from('user_projects')
        .select('project_id')
        .eq('user_id', user.id)
        .eq('status', 'active');
      projectCount = activeProjects?.length || 0;
    } catch (e) {
      await alertBillingFailure('get_project_count', user.email, e, { userId: user.id, trigger: 'subscription_deleted' });
    }

    // Set 7-day deadline if user has more than 1 project
    const deadline = projectCount > 1
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Update user to free tier
    const oldBillingMode = user.billing_mode;
    await supabaseAdmin
      .from('users')
      .update({
        billing_mode: 'free',
        downgrade_deadline: deadline
      })
      .eq('id', user.id);

    // Fire webhook for downgrade
    sendPlanUpdated({
      userId: user.id,
      email: user.email,
      oldPlan: oldBillingMode,
      newPlan: 'free',
      trigger: 'payment_setup' // Triggered by payment method removal
    }).catch(err => console.error('[Marketing] Plan webhook failed:', err));

    // Update maxNumProjects to 1 in Hopsworks
    try {
      const { data: assignment } = await supabaseAdmin
        .from('user_hopsworks_assignments')
        .select('hopsworks_cluster_id, hopsworks_user_id')
        .eq('user_id', user.id)
        .single();

      if (assignment?.hopsworks_cluster_id && assignment?.hopsworks_user_id) {
        const { data: cluster } = await supabaseAdmin
          .from('hopsworks_clusters')
          .select('api_url, api_key')
          .eq('id', assignment.hopsworks_cluster_id)
          .single();

        if (cluster) {
          await updateUserProjectLimit(
            { apiUrl: cluster.api_url, apiKey: cluster.api_key },
            assignment.hopsworks_user_id,
            1
          );
          console.log(`Updated maxNumProjects to 1 for user ${user.id} after subscription deletion`);
        }
      }
    } catch (e) {
      await alertBillingFailure('update_maxNumProjects', user.email, e, { userId: user.id, trigger: 'subscription_deleted' });
    }

    console.log(`User ${user.id} downgraded to free tier. Projects: ${projectCount}, Deadline: ${deadline || 'none'}`);
  }
}

async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod) {
  const customerId = paymentMethod.customer as string;

  if (!customerId) {
    console.log('Payment method attached but no customer');
    return;
  }

  console.log(`Payment method attached for customer ${customerId}`);

  // Get user by customer ID
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, billing_mode, stripe_subscription_id, status')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    // Reactivate suspended users when payment method is added
    if (user.status === 'suspended') {
      await reactivateUser(supabaseAdmin as any, user.id, 'payment_method_attached');
    }

    // NOTE: We do NOT create subscriptions here - that's done in handlePaymentMethodSetup
    // (checkout.session.completed) to avoid race conditions causing duplicate subscriptions.
    // This handler only syncs existing subscriptions if our DB is out of sync.
    if (!user.stripe_subscription_id) {
      const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        limit: 1
      });

      if (existingSubscriptions.data.length > 0) {
        const existingSub = existingSubscriptions.data[0];
        await supabaseAdmin
          .from('users')
          .update({
            stripe_subscription_id: existingSub.id,
            stripe_subscription_status: existingSub.status
          })
          .eq('id', user.id);
        console.log(`Synced existing subscription ${existingSub.id} to DB for user ${user.id}`);
      }
    }

    // Assign cluster if needed
    const { data: assignment } = await supabaseAdmin
      .from('user_hopsworks_assignments')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!assignment) {
      const { success, error } = await assignUserToCluster(supabaseAdmin, user.id, true);
      if (success) {
        console.log(`Assigned cluster to user ${user.id} after payment method attached`);
      } else {
        await alertBillingFailure('assign_cluster', user.email, error, { userId: user.id, trigger: 'payment_method_attached' });
      }
    }
  }
}

async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod, previousAttributes?: any) {
  // Get customer ID from previous_attributes (current customer is null after detach)
  const customerId = previousAttributes?.customer;

  if (!customerId) {
    console.log('Payment method detached but no customer in previous_attributes');
    return;
  }

  console.log(`Payment method detached for customer ${customerId}`);

  // Get user by customer ID
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, billing_mode, stripe_subscription_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    // Only act on postpaid users who lose their payment method
    if (user.billing_mode === 'postpaid' || !user.billing_mode) {
      // Check if customer has any other payment methods
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: customerId,
          limit: 1
        });

        // If no payment methods left, downgrade to free tier
        if (paymentMethods.data.length === 0) {
          console.log(`User ${user.id} lost last payment method - downgrading to free tier`);

          // Sync projects before counting — user_projects may be stale (last synced at login)
          try {
            const syncResult = await syncUserProjects(user.id);
            if (!syncResult.success) {
              await alertBillingFailure('sync_projects', user.email, new Error(syncResult.error || 'unknown'), { userId: user.id, trigger: 'payment_method_detached' });
            }
          } catch (e) {
            await alertBillingFailure('sync_projects', user.email, e, { userId: user.id, trigger: 'payment_method_detached' });
          }

          // Cancel subscription if exists (to avoid failed payment attempts)
          if (user.stripe_subscription_id) {
            try {
              await stripe.subscriptions.cancel(user.stripe_subscription_id);
              console.log(`Cancelled subscription ${user.stripe_subscription_id} for user ${user.id}`);
            } catch (e) {
              await alertBillingFailure('cancel_subscription', user.email, e, { userId: user.id, subscriptionId: user.stripe_subscription_id });
            }
          }

          // Get project count from our DB — Hopsworks numActiveProjects includes deleted projects
          let projectCount = 0;
          try {
            const { data: activeProjects } = await supabaseAdmin
              .from('user_projects')
              .select('project_id')
              .eq('user_id', user.id)
              .eq('status', 'active');
            projectCount = activeProjects?.length || 0;
          } catch (e) {
            await alertBillingFailure('get_project_count', user.email, e, { userId: user.id, trigger: 'payment_method_detached' });
          }

          // Set 7-day deadline if user has more than 1 project
          const deadline = projectCount > 1
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null;

          // Update user to free tier
          const oldBillingMode = user.billing_mode;
          await supabaseAdmin
            .from('users')
            .update({
              billing_mode: 'free',
              downgrade_deadline: deadline,
              stripe_subscription_id: null,
              stripe_subscription_status: 'canceled'
            })
            .eq('id', user.id);

          // Fire webhook for downgrade
          sendPlanUpdated({
            userId: user.id,
            email: user.email,
            oldPlan: oldBillingMode,
            newPlan: 'free',
            trigger: 'payment_setup' // Triggered by payment method detached
          }).catch(err => console.error('[Marketing] Plan webhook failed:', err));

          // Update maxNumProjects to 1 in Hopsworks
          try {
            const { data: assignment } = await supabaseAdmin
              .from('user_hopsworks_assignments')
              .select('hopsworks_cluster_id, hopsworks_user_id')
              .eq('user_id', user.id)
              .single();

            if (assignment?.hopsworks_cluster_id && assignment?.hopsworks_user_id) {
              const { data: cluster } = await supabaseAdmin
                .from('hopsworks_clusters')
                .select('api_url, api_key')
                .eq('id', assignment.hopsworks_cluster_id)
                .single();

              if (cluster) {
                await updateUserProjectLimit(
                  { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                  assignment.hopsworks_user_id,
                  1
                );
                console.log(`Updated maxNumProjects to 1 for user ${user.id} after payment method removal`);
              }
            }
          } catch (e) {
            await alertBillingFailure('update_maxNumProjects', user.email, e, { userId: user.id, trigger: 'payment_method_detached' });
          }

          console.log(`User ${user.id} downgraded to free tier. Projects: ${projectCount}, Deadline: ${deadline || 'none'}`);
        } else {
          console.log(`User ${user.id} still has ${paymentMethods.data.length} payment method(s)`);
        }
      } catch (error) {
        await alertBillingFailure('check_payment_methods', user.email, error, { userId: user.id });
      }
    } else {
      console.log(`User ${user.id} is ${user.billing_mode} mode - no action needed`);
    }
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, name')
    .eq('stripe_customer_id', customerId)
    .single();

  if (user) {
    console.error(`[BILLING] Payment failed for ${user.email} - invoice ${invoice.id}`);

    // Send payment failure notification
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Hopsworks <no-reply@hopsworks.com>',
        to: user.email,
        subject: 'Action Required: Payment Failed for Your Hopsworks Account',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Payment Failed</h2>

            <p>Hi${user.name ? ` ${user.name}` : ''},</p>

            <p>We were unable to process a payment for your Hopsworks account.</p>

            <p><strong>What happens next:</strong></p>
            <ul>
              <li>We'll automatically retry the payment</li>
              <li>If the issue persists, your account may be suspended</li>
            </ul>

            <p>To avoid any interruption, please update your payment method:</p>

            <a href="${process.env.AUTH0_BASE_URL}/billing"
               style="display: inline-block; background-color: #1eb182; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
              Update Payment Method
            </a>

            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              If you have questions, reply to this email or contact support.
            </p>
          </div>
        `,
      });
      console.log(`[BILLING] Payment failure notification sent to ${user.email}`);
    } catch (emailError) {
      await alertBillingFailure('send_payment_failure_email', user.email, emailError, { userId: user.id });
    }
  }
}
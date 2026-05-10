import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_RATES } from '@/config/billing-rates';
import { syncUserProjects } from '@/lib/project-sync';
import { requireActiveSession } from '@/lib/require-active-session';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { month } = req.query;
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
    const session = await requireActiveSession(req, res);
    if (!session) return;

    const userId = session.user.sub;

    // Get user billing info
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('billing_mode, stripe_customer_id, stripe_subscription_id, feature_flags, account_owner_id, status, terms_accepted_at, marketing_consent, spending_cap, downgrade_deadline, email')
      .eq('id', userId)
      .single();
    
    // Team members get simplified billing info
    if (user?.account_owner_id) {
      // Get account owner info
      const { data: owner } = await supabaseAdmin
        .from('users')
        .select('email, name')
        .eq('id', user.account_owner_id)
        .single();
      
      return res.status(200).json({
        isTeamMember: true,
        accountOwner: {
          email: owner?.email,
          name: owner?.name
        },
        billingMode: 'team',
        hasPaymentMethod: true, // Team members don't need payment
        currentUsage: {
          cpuHours: '0.00',
          gpuHours: '0.00',
          ramGbHours: '0.00',
          onlineStorageGB: '0.00',
          offlineStorageGB: '0.00',
          currentMonth: {
            computeCost: 0,
            storageCost: 0,
            total: 0
          }
        }
      });
    }

    // Get current month usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: currentMonthData } = await supabaseAdmin
      .from('usage_daily')
      .select('opencost_cpu_hours, opencost_gpu_hours, opencost_ram_gb_hours, total_cost, online_storage_gb, offline_storage_gb, date')
      .eq('user_id', userId)
      .gte('date', startOfMonth.toISOString().split('T')[0])
      .order('date', { ascending: true });

    // Calculate current month totals - accumulate compute, use latest storage snapshot
    const currentMonthTotals = currentMonthData?.reduce((acc, day) => ({
      cpuHours: acc.cpuHours + (day.opencost_cpu_hours || 0),
      gpuHours: acc.gpuHours + (day.opencost_gpu_hours || 0),
      ramGbHours: acc.ramGbHours + (day.opencost_ram_gb_hours || 0),
      totalCost: acc.totalCost + (day.total_cost || 0)
    }), { cpuHours: 0, gpuHours: 0, ramGbHours: 0, totalCost: 0 }) ||
    { cpuHours: 0, gpuHours: 0, ramGbHours: 0, totalCost: 0 };

    // Get latest storage values from most recent day (storage is a snapshot, not accumulated)
    const latestDay = currentMonthData?.[currentMonthData.length - 1];
    const onlineStorageGB = latestDay?.online_storage_gb || 0;
    const offlineStorageGB = latestDay?.offline_storage_gb || 0;


    // Get usage data for the requested period
    let startDate: Date;
    let endDate: Date;
    
    if (month && typeof month === 'string' && month !== 'current') {
      // Specific month requested (YYYY-MM format)
      startDate = new Date(month + '-01');
      endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0); // Last day of month
    } else {
      // Default: last 30 days
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }
    
    const { data: historicalData } = await supabaseAdmin
      .from('usage_daily')
      .select('date, opencost_cpu_hours, opencost_gpu_hours, online_storage_gb, offline_storage_gb, total_cost')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    // Prepaid users use invoicing, not credits
    let creditBalance = null;

    // Get billing history from Stripe
    let billingHistory: any[] = [];
    if (user?.stripe_customer_id) {
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2025-06-30.basil'
        });
        
        const invoices = await stripe.invoices.list({
          customer: user.stripe_customer_id,
          limit: 10, // Get more to filter out drafts
          expand: ['data.subscription']
        });
        
        // Filter out draft invoices or finalize them if they're ready
        const processedInvoices = [];
        for (const invoice of invoices.data) {
          // Skip draft invoices that are empty (no items)
          if (invoice.status === 'draft') {
            // Check if it has line items and should be finalized
            if (invoice.lines && invoice.lines.data && invoice.lines.data.length > 0 && invoice.auto_advance) {
              try {
                // Auto-finalize drafts that have items and auto_advance enabled
                const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id!);
                processedInvoices.push(finalizedInvoice);
                console.log(`Finalized draft invoice ${invoice.id}`);
              } catch (err) {
                console.log(`Could not finalize draft invoice ${invoice.id}:`, err);
                // Skip this draft
              }
            }
            // Skip drafts - they're not real invoices yet
            continue;
          }
          processedInvoices.push(invoice);
        }
        
        console.log('Processed invoices:', processedInvoices.map(inv => ({
          id: inv.id,
          number: inv.number,
          status: inv.status,
          has_url: !!inv.hosted_invoice_url
        })));
        
        billingHistory = processedInvoices.slice(0, 5).map(invoice => ({
          id: invoice.id,
          invoice_id: invoice.number || invoice.id,
          amount: (invoice.amount_paid || invoice.amount_due || 0) / 100,
          status: invoice.status || 'unknown',
          created_at: new Date(invoice.created * 1000).toISOString(),
          invoice_url: invoice.hosted_invoice_url,
          pdf_url: invoice.invoice_pdf,
          total: (invoice.total || invoice.amount_due || 0) / 100,
          currency: invoice.currency || 'usd'
        }));
      } catch (stripeError) {
        console.error('Error fetching Stripe invoices:', stripeError);
      }
    }

    // Check if customer has payment methods and get details
    let hasPaymentMethod = false;
    let paymentMethodDetails = null;
    console.log('[Billing API] Checking payment methods for customer:', user?.stripe_customer_id);
    if (user?.stripe_customer_id) {
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2025-06-30.basil'
        });
        
        // Check for attached payment methods - try multiple approaches
        const paymentMethods = await stripe.paymentMethods.list({
          customer: user.stripe_customer_id,
          type: 'card'
        });
        
        // Also check all payment method types
        const allPaymentMethods = await stripe.paymentMethods.list({
          customer: user.stripe_customer_id
        });
        
        // Check customer's default payment method
        const customer = await stripe.customers.retrieve(user.stripe_customer_id);
        const hasDefaultPaymentMethod = !!(customer as any).invoice_settings?.default_payment_method || !!(customer as any).default_source;
        
        // Only check actual payment methods, not setup intent history
        hasPaymentMethod = paymentMethods.data.length > 0 ||
                          allPaymentMethods.data.length > 0 ||
                          hasDefaultPaymentMethod;
        console.log('[Billing API] Payment methods check:', {
          cardMethods: paymentMethods.data.length,
          allMethods: allPaymentMethods.data.length,
          hasDefault: hasDefaultPaymentMethod,
          result: hasPaymentMethod
        });
        
        // Get payment method details if available
        if (paymentMethods.data.length > 0) {
          const primaryCard = paymentMethods.data[0];
          paymentMethodDetails = {
            type: 'card',
            card: {
              brand: primaryCard.card?.brand || 'card',
              last4: primaryCard.card?.last4 || '****',
              expMonth: primaryCard.card?.exp_month,
              expYear: primaryCard.card?.exp_year
            }
          };
        } else if ((customer as any).invoice_settings?.default_payment_method) {
          // Fetch the default payment method details
          try {
            const defaultPm = await stripe.paymentMethods.retrieve(
              (customer as any).invoice_settings.default_payment_method
            );
            if (defaultPm.card) {
              paymentMethodDetails = {
                type: 'card',
                card: {
                  brand: defaultPm.card.brand,
                  last4: defaultPm.card.last4,
                  expMonth: defaultPm.card.exp_month,
                  expYear: defaultPm.card.exp_year
                }
              };
            }
          } catch (e) {
            // Ignore error fetching payment method details
          }
        }
        
      } catch (error: any) {
        console.error('[Billing API] Error checking payment methods:', error?.message || error);
        hasPaymentMethod = false;
      }
    } else {
      console.log('[Billing API] No stripe_customer_id, skipping payment check');
    }

    // Lazy upgrade: free user with payment method AND active subscription → postpaid
    // Must have BOTH payment method and subscription to upgrade (avoid upgrade/downgrade loop)
    let hasActiveSubscriptionForUpgrade = false;
    if (user?.billing_mode === 'free' && hasPaymentMethod && user?.stripe_customer_id) {
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2025-06-30.basil'
        });
        const subs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'active',
          limit: 1
        });
        hasActiveSubscriptionForUpgrade = subs.data.length > 0;
      } catch (e) {
        console.error('[Billing API] Failed to check subscription for upgrade:', e);
      }

      if (hasActiveSubscriptionForUpgrade) {
        console.log(`[Billing API] Lazy upgrading user ${userId} from free to postpaid`);
        await supabaseAdmin
          .from('users')
          .update({ billing_mode: 'postpaid', downgrade_deadline: null })
          .eq('id', userId);
        user.billing_mode = 'postpaid';

        // Update maxNumProjects from 1 to 5 in Hopsworks
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
              const { getHopsworksUserById } = await import('../../lib/hopsworks-api');
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
                console.log(`[Billing API] Updated maxNumProjects to 5 for user ${userId}`);
              }
            }
          }
        } catch (upgradeError) {
          console.error(`[Billing API] Failed to update maxNumProjects:`, upgradeError);
          // Log to health_check_failures for tracking - sync-user will fix on next login
          try {
            await supabaseAdmin.from('health_check_failures').insert({
              user_id: userId,
              email: user?.email,
              check_type: 'lazy_upgrade_maxnumprojects',
              error_message: 'Lazy upgrade succeeded but maxNumProjects update failed',
              details: { error: String(upgradeError), expected: 5 }
            });
          } catch {} // Don't fail if logging fails
        }
      }
    }

    // Lazy downgrade: postpaid without payment method OR without active subscription → free
    let downgradeInfo: { deadline: string | null; projectCount: number } | null = null;
    if (user?.billing_mode === 'postpaid' && user?.stripe_customer_id) {
      // Check if subscription is still active in Stripe
      let hasActiveSubscription = false;
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2025-06-30.basil'
        });

        const subs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'active',
          limit: 1
        });
        hasActiveSubscription = subs.data.length > 0;
        console.log(`[Billing API] Subscription check: hasActive=${hasActiveSubscription}, count=${subs.data.length}, ids=${subs.data.map(s => s.id).join(',')}`);
      } catch (e) {
        console.error('[Billing API] Failed to check Stripe subscription:', e);
      }

      // Downgrade if no payment method OR no active subscription
      if (!hasPaymentMethod || !hasActiveSubscription) {
        const reason = !hasPaymentMethod ? 'no payment method' : 'no active subscription';
        console.log(`[Billing API] Lazy downgrading user ${userId} from postpaid to free (${reason})`);

        // Sync projects before counting — user_projects may be stale (last synced at login)
        try {
          const syncResult = await syncUserProjects(userId);
          if (!syncResult.success) {
            console.error(`[Billing API] Project sync failed for ${userId}: ${syncResult.error} — proceeding with stale data`);
          }
        } catch (e) {
          console.error(`[Billing API] Project sync threw for ${userId}:`, e);
        }

        // Get project count from our DB — Hopsworks numActiveProjects includes deleted projects
        let projectCount = 0;
        try {
          const { data: activeProjects } = await supabaseAdmin
            .from('user_projects')
            .select('project_id')
            .eq('user_id', userId)
            .eq('status', 'active');
          projectCount = activeProjects?.length || 0;
        } catch (e) {
          console.error('[Billing API] Failed to get project count:', e);
        }

        // Set deadline if user has more than 1 project
        const deadline = projectCount > 1
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
          : null;

        // Update user to free
        await supabaseAdmin
          .from('users')
          .update({
            billing_mode: 'free',
            downgrade_deadline: deadline
          })
          .eq('id', userId);
        user.billing_mode = 'free';
        user.downgrade_deadline = deadline;

        // Update maxNumProjects to 1 in Hopsworks
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
              // Only bump UP - quota workaround may have set it higher than 1
              const { getHopsworksUserById } = await import('../../lib/hopsworks-api');
              const hwUser = await getHopsworksUserById(
                { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                assignment.hopsworks_user_id
              );
              if (hwUser && (hwUser.maxNumProjects ?? 0) < 1) {
                await updateUserProjectLimit(
                  { apiUrl: cluster.api_url, apiKey: cluster.api_key },
                  assignment.hopsworks_user_id,
                  1
                );
                console.log(`[Billing API] Updated maxNumProjects to 1 for user ${userId}`);
              }
            }
          }
        } catch (downgradeError) {
          console.error(`[Billing API] Failed to update maxNumProjects on downgrade:`, downgradeError);
        }

        // Send alert to team
        if (projectCount > 1) {
          try {
            await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/alerts/downgrade`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
              },
              body: JSON.stringify({
                userId,
                email: user.email,
                projectCount,
                deadline
              })
            });
          } catch (alertError) {
            console.error('[Billing API] Failed to send downgrade alert:', alertError);
          }
        }

        downgradeInfo = { deadline, projectCount };
        console.log(`[Billing API] User ${userId} downgraded to free. Projects: ${projectCount}, Deadline: ${deadline || 'none'}`);
      }
    }

    // Auto-suspend: free user past deadline with >1 project
    if (user?.billing_mode === 'free' && user?.downgrade_deadline && user?.status !== 'suspended') {
      const deadline = new Date(user.downgrade_deadline);
      if (deadline < new Date()) {
        // Sync projects before counting — user_projects may be stale (last synced at login)
        try {
          const syncResult = await syncUserProjects(userId);
          if (!syncResult.success) {
            console.error(`[Billing API] Project sync failed for ${userId}: ${syncResult.error} — proceeding with stale data`);
          }
        } catch (e) {
          console.error(`[Billing API] Project sync threw for ${userId}:`, e);
        }

        // Check project count from our DB — Hopsworks numActiveProjects includes deleted projects
        let currentProjectCount = 0;
        try {
          const { data: activeProjects } = await supabaseAdmin
            .from('user_projects')
            .select('project_id')
            .eq('user_id', userId)
            .eq('status', 'active');
          currentProjectCount = activeProjects?.length || 0;
        } catch (e) {
          console.error('[Billing API] Failed to get project count for suspension check:', e);
        }

        if (currentProjectCount > 1) {
          console.log(`[Billing API] Auto-suspending user ${userId}: deadline passed, still has ${currentProjectCount} projects`);
          await supabaseAdmin
            .from('users')
            .update({ status: 'suspended' })
            .eq('id', userId);
          user.status = 'suspended';
        } else {
          // User complied - clear deadline
          console.log(`[Billing API] User ${userId} complied with free tier (${currentProjectCount} projects) - clearing deadline`);
          await supabaseAdmin
            .from('users')
            .update({ downgrade_deadline: null })
            .eq('id', userId);
          user.downgrade_deadline = null;
        }
      }
    }

    // Prevent caching of billing data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    console.log('[Billing API] Response:', {
      hasPaymentMethod,
      termsAcceptedAt: user?.terms_accepted_at,
      isSuspended: user?.status === 'suspended',
      billingMode: user?.billing_mode
    });

    return res.status(200).json({
      billingMode: user?.billing_mode ?? null,
      hasPaymentMethod,
      isSuspended: user?.status === 'suspended',
      termsAcceptedAt: user?.terms_accepted_at || null,
      marketingConsent: user?.marketing_consent || false,
      paymentMethodDetails,
      subscriptionStatus: null, // Column doesn't exist in DB
      prepaidEnabled: user?.feature_flags?.prepaid_enabled || false,
      spendingCap: user?.spending_cap || null,
      downgradeDeadline: user?.downgrade_deadline || null,
      downgradeInfo, // Only set during lazy downgrade
      currentUsage: {
        cpuHours: currentMonthTotals.cpuHours.toFixed(2),
        gpuHours: currentMonthTotals.gpuHours.toFixed(2),
        ramGbHours: currentMonthTotals.ramGbHours.toFixed(2),
        onlineStorageGB: onlineStorageGB < 0.1 ? (onlineStorageGB * 1024).toFixed(0) + 'MB' : onlineStorageGB.toFixed(2) + 'GB',
        offlineStorageGB: offlineStorageGB < 0.1 ? (offlineStorageGB * 1024).toFixed(0) + 'MB' : offlineStorageGB.toFixed(2) + 'GB',
        currentMonth: {
          computeCost: (
            currentMonthTotals.cpuHours * DEFAULT_RATES.CPU_HOUR +
            currentMonthTotals.gpuHours * DEFAULT_RATES.GPU_HOUR +
            currentMonthTotals.ramGbHours * DEFAULT_RATES.RAM_GB_HOUR
          ),
          storageCost: Math.max(0, currentMonthTotals.totalCost - (
            currentMonthTotals.cpuHours * DEFAULT_RATES.CPU_HOUR +
            currentMonthTotals.gpuHours * DEFAULT_RATES.GPU_HOUR +
            currentMonthTotals.ramGbHours * DEFAULT_RATES.RAM_GB_HOUR
          )),
          total: currentMonthTotals.totalCost
        }
      },
      creditBalance,
      invoices: billingHistory?.map(bill => ({
        id: bill.id,
        invoice_number: bill.invoice_id,
        amount: bill.amount,
        status: bill.status,
        created_at: bill.created_at,
        invoice_url: bill.invoice_url,
        pdf_url: bill.pdf_url,
        total: bill.total,
        currency: bill.currency
      })) || [],
      historicalUsage: historicalData?.map(day => ({
        date: day.date,
        cpu_hours: day.opencost_cpu_hours || 0,
        gpu_hours: day.opencost_gpu_hours || 0,
        storage_gb: (day.online_storage_gb || 0) + (day.offline_storage_gb || 0),
        total_cost: day.total_cost || 0
      })) || [],
      // Display rates (actual billing happens via Stripe for postpaid)
      rates: {
        cpu_hour: DEFAULT_RATES.CPU_HOUR,
        gpu_hour: DEFAULT_RATES.GPU_HOUR,
        ram_gb_hour: DEFAULT_RATES.RAM_GB_HOUR,
        storage_online_gb: DEFAULT_RATES.STORAGE_ONLINE_GB,
        storage_offline_gb: DEFAULT_RATES.STORAGE_OFFLINE_GB,
        network_egress_gb: DEFAULT_RATES.NETWORK_EGRESS_GB
      }
    });
  } catch (error) {
    console.error('Error fetching billing:', error);
    return res.status(500).json({ error: 'Failed to fetch billing data' });
  }
}
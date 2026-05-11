import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { CreditCard, AlertTriangle, ArrowRight, Check } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useBilling } from '@/contexts/BillingContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function BillingSetup() {
  const { user, loading: authLoading, synced } = useAuth();
  const {
    billing,
    loading: billingLoading,
    error: billingError,
    refetch: refetchBilling,
  } = useBilling();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !synced || billingLoading) return;

    if (!user) {
      router.push('/');
      return;
    }

    if (billing?.isTeamMember) {
      router.push('/dashboard');
      return;
    }

    if (
      (billing?.billingMode === 'prepaid' || billing?.billingMode === 'free') &&
      !billing?.isSuspended &&
      billing?.termsAcceptedAt
    ) {
      router.push('/dashboard');
      return;
    }

    if (
      billing?.hasPaymentMethod &&
      !billing?.isSuspended &&
      billing?.termsAcceptedAt
    ) {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, synced, billingLoading, user, billing, router]);

  const isReady =
    synced && !billingLoading && user && billing && !billing.isTeamMember;
  const needsTermsAcceptance = !billing?.termsAcceptedAt;
  const hasPaymentButNeedsTerms =
    (billing?.hasPaymentMethod || billing?.billingMode === 'prepaid') &&
    needsTermsAcceptance &&
    !billing?.isSuspended;

  const handleSetupPayment = async () => {
    setLoading(true);

    try {
      if (needsTermsAcceptance && termsAccepted) {
        const consentResponse = await fetch('/api/user/accept-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketingConsent }),
        });

        if (!consentResponse.ok) {
          const errorData = await consentResponse.json().catch(() => ({}));
          console.error('Failed to save consent:', errorData);
          setError(
            errorData.error || 'Failed to save preferences. Please try again.',
          );
          setLoading(false);
          return;
        }
      }

      const response = await fetch('/api/billing/setup-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to set up payment');
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (data.portalUrl) {
        window.location.href = data.portalUrl;
      }
    } catch (err) {
      console.error('Error setting up payment:', err);
      setError('Failed to set up payment. Please try again.');
      setLoading(false);
    }
  };

  const handleStartFree = async () => {
    setSavingConsent(true);

    if (needsTermsAcceptance) {
      if (!termsAccepted) {
        setSavingConsent(false);
        return;
      }
      try {
        const response = await fetch('/api/user/accept-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketingConsent }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Failed to save consent:', errorData);
          setError(
            errorData.error || 'Failed to save preferences. Please try again.',
          );
          setSavingConsent(false);
          return;
        }
      } catch (consentErr) {
        console.error('Error saving consent:', consentErr);
        setError('Network error. Please check your connection and try again.');
        setSavingConsent(false);
        return;
      }
    }

    try {
      const response = await fetch('/api/billing/start-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => ({ error: 'Server error' }));
        console.error('Failed to start free:', data.error);
        if (response.status === 400) {
          setError(
            data.error || 'Cannot switch to free tier. Please contact support.',
          );
          setSavingConsent(false);
          return;
        }
      }
    } catch (err) {
      console.error('Error calling start-free:', err);
    }

    try {
      await refetchBilling();
    } catch (err) {
      console.error('Failed to refetch billing, continuing to dashboard:', err);
    }
    setSavingConsent(false);

    sessionStorage.removeItem('payment_required');
    router.push('/dashboard');
  };

  const consentBlock = (
    <div className="space-y-3 mb-6 p-4 bg-muted rounded-lg border border-border">
      <p className="text-sm font-semibold mb-3">Please accept to continue:</p>

      <div className="flex items-start gap-3">
        <Checkbox
          id="terms"
          checked={termsAccepted}
          onCheckedChange={(c) => setTermsAccepted(c === true)}
          className="mt-0.5"
        />
        <Label htmlFor="terms" className="text-sm font-normal cursor-pointer">
          I agree to the{' '}
          <Link
            href="/terms"
            target="_blank"
            className="text-primary hover:underline"
          >
            Terms of Service
          </Link>
          ,{' '}
          <Link
            href="/aup"
            target="_blank"
            className="text-primary hover:underline"
          >
            Acceptable Use Policy
          </Link>
          , and{' '}
          <Link
            href="/privacy"
            target="_blank"
            className="text-primary hover:underline"
          >
            Privacy Policy
          </Link>
        </Label>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="marketing"
          checked={marketingConsent}
          onCheckedChange={(c) => setMarketingConsent(c === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="marketing"
          className="text-sm font-normal cursor-pointer text-muted-foreground"
        >
          I would like to receive product updates and marketing communications
          (optional)
        </Label>
      </div>
    </div>
  );

  if (!isReady) {
    const showError = !billingLoading && billingError;

    return (
      <>
        <Head>
          <title>Set Up Billing - Hopsworks</title>
        </Head>
        <div className="min-h-screen bg-muted">
          <Navbar />
          <div className="container mx-auto px-4 py-12 max-w-2xl">
            <Card className="p-8">
              {showError ? (
                <div className="text-center">
                  <AlertTriangle
                    size={32}
                    className="text-destructive mx-auto mb-4"
                  />
                  <p className="font-semibold text-destructive mb-2">
                    Failed to load billing information
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {billingError ||
                      'Please try again or contact support.'}
                  </p>
                  <Button
                    onClick={() => refetchBilling()}
                    variant="secondary"
                    disabled={billingLoading}
                    loading={billingLoading}
                  >
                    {billingLoading ? 'Retrying...' : 'Try Again'}
                  </Button>
                </div>
              ) : (
                <p>Loading...</p>
              )}
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Set Up Billing - Hopsworks</title>
      </Head>
      <div className="min-h-screen bg-muted">
        <Navbar />
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          {billing?.isSuspended && (
            <Card className={cn('p-4 mb-4 border-destructive bg-destructive/10')}>
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">
                    Account Suspended
                  </p>
                  <p className="text-sm text-destructive/90">
                    Your payment method was removed. Add a new payment method
                    below to restore access.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {error && (
            <Card className="p-4 mb-4 border-destructive bg-destructive/10">
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">Error</p>
                  <p className="text-sm text-destructive/90">{error}</p>
                </div>
              </div>
            </Card>
          )}

          <Card className="p-8">
            {hasPaymentButNeedsTerms ? (
              <>
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-quartz-primary-shade2 rounded-lg">
                    <Check size={32} className="text-primary" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold mb-1">
                      Almost There!
                    </h1>
                    <p className="text-muted-foreground">
                      Just accept our terms to access your cluster
                    </p>
                  </div>
                </div>

                <div className="border-t pt-6">
                  {consentBlock}

                  <Button
                    size="lg"
                    className="w-full"
                    onClick={handleStartFree}
                    loading={savingConsent}
                    disabled={savingConsent || !termsAccepted}
                  >
                    {savingConsent ? (
                      'Setting up your account...'
                    ) : (
                      <>
                        <Check size={18} />
                        Continue to Dashboard
                        <ArrowRight size={18} />
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-quartz-label-yellow-shade2 rounded-lg">
                    <CreditCard
                      size={32}
                      className="text-quartz-label-orange"
                    />
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold mb-1">
                      Complete Your Setup
                    </h1>
                    <p className="text-muted-foreground">
                      Add a payment method to access your Hopsworks cluster
                    </p>
                  </div>
                </div>

                <div className="border-t pt-6">
                  <div className="bg-quartz-label-blue-shade2 p-4 rounded-lg mb-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle
                        size={20}
                        className="text-quartz-label-blue mt-1 shrink-0"
                      />
                      <div>
                        <p className="font-semibold text-quartz-label-blue mb-2">
                          Payment Required for Cluster Access
                        </p>
                        <p className="text-sm">
                          To provision and access your Hopsworks cluster, you
                          need to set up a payment method. You&apos;ll only be
                          charged for the resources you actually use.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 mb-6">
                    <h3 className="text-lg font-semibold">
                      What happens next:
                    </h3>
                    <div className="pl-4 space-y-2">
                      {[
                        "You'll be redirected to our secure payment processor (Stripe)",
                        'Add your payment information (no charges yet)',
                        'Your cluster will be automatically provisioned',
                        'Start building with pay-as-you-go pricing',
                      ].map((step, i) => (
                        <div key={step} className="flex items-center gap-2">
                          <span className="text-2xl text-muted-foreground font-mono">
                            {i + 1}.
                          </span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-muted p-4 rounded-lg mb-6">
                    <h4 className="text-sm font-semibold mb-2">
                      Pricing Overview
                    </h4>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      <li>
                        • Compute: $0.35 per credit (1 vCPU hour + 0.1 GB RAM)
                      </li>
                      <li>• Online Storage: $0.50/GB per month</li>
                      <li>• Offline Storage: $0.03/GB per month</li>
                      <li>• No upfront costs or minimum charges</li>
                      <li>
                        • Set a monthly spending cap anytime from your dashboard
                      </li>
                    </ul>
                  </div>

                  {needsTermsAcceptance && consentBlock}

                  <div className="space-y-4">
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={handleSetupPayment}
                      loading={loading}
                      disabled={
                        loading ||
                        savingConsent ||
                        (needsTermsAcceptance && !termsAccepted)
                      }
                    >
                      {loading ? (
                        'Redirecting to Stripe...'
                      ) : (
                        <>
                          <CreditCard size={18} />
                          Add Payment Method
                          <ArrowRight size={18} />
                        </>
                      )}
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="px-4 bg-card text-sm text-muted-foreground">
                          or
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      size="lg"
                      className="w-full"
                      onClick={handleStartFree}
                      loading={savingConsent}
                      disabled={
                        loading ||
                        savingConsent ||
                        (needsTermsAcceptance && !termsAccepted)
                      }
                    >
                      {savingConsent ? (
                        'Setting up your account...'
                      ) : (
                        <>
                          Start for Free
                          <ArrowRight size={18} />
                        </>
                      )}
                    </Button>
                    <p className="text-sm text-muted-foreground text-center">
                      1 project included, no credit card required
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground text-center mt-6">
                    You can upgrade anytime from your dashboard. Payment
                    information is securely processed by Stripe.
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

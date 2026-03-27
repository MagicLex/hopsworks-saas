import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useBilling } from '@/contexts/BillingContext';
import { Box, Flex, Title, Text, Button, Card } from 'tailwind-quartz';
import { CreditCard, AlertTriangle, ArrowRight, Check } from 'lucide-react';
import Navbar from '@/components/Navbar';

export default function BillingSetup() {
  const { user, loading: authLoading, synced } = useAuth();
  const { billing, loading: billingLoading, error: billingError, refetch: refetchBilling } = useBilling();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wait for everything to load then check if we should redirect
  useEffect(() => {
    if (authLoading || !synced || billingLoading) return;

    if (!user) {
      router.push('/');
      return;
    }

    // Team members go to dashboard
    if (billing?.isTeamMember) {
      router.push('/dashboard');
      return;
    }

    // Prepaid and free users with terms accepted go to dashboard
    if ((billing?.billingMode === 'prepaid' || billing?.billingMode === 'free') && !billing?.isSuspended && billing?.termsAcceptedAt) {
      router.push('/dashboard');
      return;
    }

    // Postpaid users with payment method AND terms accepted go to dashboard
    if (billing?.hasPaymentMethod && !billing?.isSuspended && billing?.termsAcceptedAt) {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, synced, billingLoading, user, billing, router]);

  // Derived state - IMPORTANT: require billing to be loaded (not null) before showing interactive UI
  // If billing API fails, we should show loading/error state, not a broken interactive form
  const isReady = synced && !billingLoading && user && billing && !billing.isTeamMember;
  const needsTermsAcceptance = !billing?.termsAcceptedAt;
  // Only show simplified "just accept terms" view for prepaid or users with payment method
  // Free users should see the full view with both "Add Payment" and "Start for Free" options
  const hasPaymentButNeedsTerms = (billing?.hasPaymentMethod || billing?.billingMode === 'prepaid') && needsTermsAcceptance && !billing?.isSuspended;

  const handleSetupPayment = async () => {
    setLoading(true);

    try {
      // Save consent BEFORE redirecting to Stripe (user won't come back to this page)
      if (needsTermsAcceptance && termsAccepted) {
        const consentResponse = await fetch('/api/user/accept-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketingConsent })
        });

        if (!consentResponse.ok) {
          const errorData = await consentResponse.json().catch(() => ({}));
          console.error('Failed to save consent:', errorData);
          setError(errorData.error || 'Failed to save preferences. Please try again.');
          setLoading(false);
          return;
        }
      }

      const response = await fetch('/api/billing/setup-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to set up payment');
      }

      // Redirect to Stripe Checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (data.portalUrl) {
        // User already has payment method, go to portal
        window.location.href = data.portalUrl;
      }
    } catch (error) {
      console.error('Error setting up payment:', error);
      setError('Failed to set up payment. Please try again.');
      setLoading(false);
    }
  };

  const handleStartFree = async () => {
    setSavingConsent(true);

    // If user hasn't accepted terms yet, save consent first
    if (needsTermsAcceptance) {
      if (!termsAccepted) { setSavingConsent(false); return; } // Should not happen due to disabled button
      try {
        const response = await fetch('/api/user/accept-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketingConsent })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Failed to save consent:', errorData);
          setError(errorData.error || 'Failed to save preferences. Please try again.');
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

    // Switch to free tier and assign cluster
    try {
      const response = await fetch('/api/billing/start-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Server error' }));
        console.error('Failed to start free:', data.error);
        // Block on 400 errors (business logic) - these indicate the action cannot be completed
        // 400 = client error (e.g., prepaid user trying to switch, already free, etc.)
        if (response.status === 400) {
          setError(data.error || 'Cannot switch to free tier. Please contact support.');
          setSavingConsent(false);
          return;
        }
        // 500+ errors: server issue, still try to redirect (user state might be ok)
        // If redirect fails, dashboard will handle it
      }
    } catch (err) {
      console.error('Error calling start-free:', err);
      // Network errors shouldn't block if terms were accepted - user can be redirected
    }

    // Refetch billing to update context before redirect
    try {
      await refetchBilling();
    } catch (err) {
      console.error('Failed to refetch billing, continuing to dashboard:', err);
      // Don't block - dashboard will sync billing context on load
    }
    setSavingConsent(false);

    sessionStorage.removeItem('payment_required');
    router.push('/dashboard');
  };

  if (!isReady) {
    // Show error state if billing failed to load (not just loading)
    const showError = !billingLoading && billingError;

    return (
      <>
        <Head>
          <title>Set Up Billing - Hopsworks</title>
        </Head>
        <Box className="min-h-screen bg-gray-50">
          <Navbar />
          <Box className="container mx-auto px-4 py-12 max-w-2xl">
            <Card className="p-8">
              {showError ? (
                <Box className="text-center">
                  <AlertTriangle size={32} className="text-red-500 mx-auto mb-4" />
                  <Text className="font-semibold text-red-800 mb-2">Failed to load billing information</Text>
                  <Text className="text-sm text-gray-600 mb-4">{billingError || 'Please try again or contact support.'}</Text>
                  <Button onClick={() => refetchBilling()} intent="secondary" disabled={billingLoading}>
                    {billingLoading ? 'Retrying...' : 'Try Again'}
                  </Button>
                </Box>
              ) : (
                <Text>Loading...</Text>
              )}
            </Card>
          </Box>
        </Box>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Set Up Billing - Hopsworks</title>
      </Head>
      <Box className="min-h-screen bg-gray-50">
        <Navbar />
        <Box className="container mx-auto px-4 py-12 max-w-2xl">
          {billing?.isSuspended && (
            <Card className="p-4 mb-4 border-red-500 bg-red-50">
              <Flex align="center" gap={12}>
                <AlertTriangle size={20} className="text-red-600" />
                <Box>
                  <Text className="font-semibold text-red-800">Account Suspended</Text>
                  <Text className="text-sm text-red-700">Your payment method was removed. Add a new payment method below to restore access.</Text>
                </Box>
              </Flex>
            </Card>
          )}

          {error && (
            <Card className="p-4 mb-4 border-red-500 bg-red-50">
              <Flex align="center" gap={12}>
                <AlertTriangle size={20} className="text-red-600" />
                <Box>
                  <Text className="font-semibold text-red-800">Error</Text>
                  <Text className="text-sm text-red-700">{error}</Text>
                </Box>
              </Flex>
            </Card>
          )}

          <Card className="p-8">
            {hasPaymentButNeedsTerms ? (
              /* Simplified view: payment done, just need terms acceptance */
              <>
                <Flex align="center" gap={16} className="mb-6">
                  <Box className="p-3 bg-green-100 rounded-lg">
                    <Check size={32} className="text-green-700" />
                  </Box>
                  <Box>
                    <Title as="h1" className="text-2xl mb-1">Almost There!</Title>
                    <Text className="text-gray-600">Just accept our terms to access your cluster</Text>
                  </Box>
                </Flex>

                <Box className="border-t pt-6">
                  <Box className="space-y-3 mb-6 p-4 bg-gray-50 rounded-lg border">
                    <Text className="text-sm font-semibold text-gray-700 mb-3">Please accept to continue:</Text>
                    <label className="flex items-start gap-3 cursor-pointer group">
                      <Box className="relative mt-0.5">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          className="sr-only peer"
                        />
                        <Box className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                          termsAccepted
                            ? 'bg-[#1eb182] border-[#1eb182]'
                            : 'border-gray-300 group-hover:border-gray-400'
                        }`}>
                          {termsAccepted && <Check size={14} className="text-white" />}
                        </Box>
                      </Box>
                      <Text className="text-sm text-gray-700 font-mono">
                        I agree to the{' '}
                        <Link href="/terms" target="_blank" className="text-[#1eb182] hover:underline">Terms of Service</Link>,{' '}
                        <Link href="/aup" target="_blank" className="text-[#1eb182] hover:underline">Acceptable Use Policy</Link>,{' '}
                        and{' '}
                        <Link href="/privacy" target="_blank" className="text-[#1eb182] hover:underline">Privacy Policy</Link>
                      </Text>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <Box className="relative mt-0.5">
                        <input
                          type="checkbox"
                          checked={marketingConsent}
                          onChange={(e) => setMarketingConsent(e.target.checked)}
                          className="sr-only peer"
                        />
                        <Box className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                          marketingConsent
                            ? 'bg-[#1eb182] border-[#1eb182]'
                            : 'border-gray-300 group-hover:border-gray-400'
                        }`}>
                          {marketingConsent && <Check size={14} className="text-white" />}
                        </Box>
                      </Box>
                      <Text className="text-sm text-gray-600 font-mono">
                        I would like to receive product updates and marketing communications (optional)
                      </Text>
                    </label>
                  </Box>

                  <Button
                    intent="primary"
                    size="lg"
                    className="w-full"
                    onClick={handleStartFree}
                    isLoading={savingConsent}
                    disabled={savingConsent || !termsAccepted}
                  >
                    <Check size={18} />
                    Continue to Dashboard
                    <ArrowRight size={18} />
                  </Button>
                </Box>
              </>
            ) : (
              /* Full view: need payment method setup */
              <>
                <Flex align="center" gap={16} className="mb-6">
                  <Box className="p-3 bg-yellow-100 rounded-lg">
                    <CreditCard size={32} className="text-yellow-700" />
                  </Box>
                  <Box>
                    <Title as="h1" className="text-2xl mb-1">Complete Your Setup</Title>
                    <Text className="text-gray-600">Add a payment method to access your Hopsworks cluster</Text>
                  </Box>
                </Flex>

                <Box className="border-t pt-6">
                  <Box className="bg-blue-50 p-4 rounded-lg mb-6">
                    <Flex align="start" gap={12}>
                      <AlertTriangle size={20} className="text-blue-600 mt-1" />
                      <Box>
                        <Text className="font-semibold text-blue-900 mb-2">
                          Payment Required for Cluster Access
                        </Text>
                        <Text className="text-sm text-blue-800">
                          To provision and access your Hopsworks cluster, you need to set up a payment method.
                          You&apos;ll only be charged for the resources you actually use.
                        </Text>
                      </Box>
                    </Flex>
                  </Box>

                  <Box className="space-y-4 mb-6">
                    <Title as="h3" className="text-lg">What happens next:</Title>
                    <Box className="pl-4 space-y-2">
                      <Flex align="center" gap={8}>
                        <Text className="text-2xl text-gray-400">1.</Text>
                        <Text>You&apos;ll be redirected to our secure payment processor (Stripe)</Text>
                      </Flex>
                      <Flex align="center" gap={8}>
                        <Text className="text-2xl text-gray-400">2.</Text>
                        <Text>Add your payment information (no charges yet)</Text>
                      </Flex>
                      <Flex align="center" gap={8}>
                        <Text className="text-2xl text-gray-400">3.</Text>
                        <Text>Your cluster will be automatically provisioned</Text>
                      </Flex>
                      <Flex align="center" gap={8}>
                        <Text className="text-2xl text-gray-400">4.</Text>
                        <Text>Start building with pay-as-you-go pricing</Text>
                      </Flex>
                    </Box>
                  </Box>

                  <Box className="bg-gray-50 p-4 rounded-lg mb-6">
                    <Title as="h4" className="text-sm font-semibold mb-2">Pricing Overview</Title>
                    <Box className="space-y-1">
                      <Text className="text-sm text-gray-600">• Compute: $0.35 per credit (1 vCPU hour + 0.1 GB RAM)</Text>
                      <Text className="text-sm text-gray-600">• Online Storage: $0.50/GB per month</Text>
                      <Text className="text-sm text-gray-600">• Offline Storage: $0.03/GB per month</Text>
                      <Text className="text-sm text-gray-600">• No upfront costs or minimum charges</Text>
                      <Text className="text-sm text-gray-600">• Set a monthly spending cap anytime from your dashboard</Text>
                    </Box>
                  </Box>

                  {/* Legal consent checkboxes - only if user hasn't accepted yet */}
                  {needsTermsAcceptance && (
                    <Box className="space-y-3 mb-6 p-4 bg-gray-50 rounded-lg border">
                      <Text className="text-sm font-semibold text-gray-700 mb-3">Please accept to continue:</Text>
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <Box className="relative mt-0.5">
                          <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(e) => setTermsAccepted(e.target.checked)}
                            className="sr-only peer"
                          />
                          <Box className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                            termsAccepted
                              ? 'bg-[#1eb182] border-[#1eb182]'
                              : 'border-gray-300 group-hover:border-gray-400'
                          }`}>
                            {termsAccepted && <Check size={14} className="text-white" />}
                          </Box>
                        </Box>
                        <Text className="text-sm text-gray-700 font-mono">
                          I agree to the{' '}
                          <Link href="/terms" target="_blank" className="text-[#1eb182] hover:underline">Terms of Service</Link>,{' '}
                          <Link href="/aup" target="_blank" className="text-[#1eb182] hover:underline">Acceptable Use Policy</Link>,{' '}
                          and{' '}
                          <Link href="/privacy" target="_blank" className="text-[#1eb182] hover:underline">Privacy Policy</Link>
                        </Text>
                      </label>

                      <label className="flex items-start gap-3 cursor-pointer group">
                        <Box className="relative mt-0.5">
                          <input
                            type="checkbox"
                            checked={marketingConsent}
                            onChange={(e) => setMarketingConsent(e.target.checked)}
                            className="sr-only peer"
                          />
                          <Box className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                            marketingConsent
                              ? 'bg-[#1eb182] border-[#1eb182]'
                              : 'border-gray-300 group-hover:border-gray-400'
                          }`}>
                            {marketingConsent && <Check size={14} className="text-white" />}
                          </Box>
                        </Box>
                        <Text className="text-sm text-gray-600 font-mono">
                          I would like to receive product updates and marketing communications (optional)
                        </Text>
                      </label>
                    </Box>
                  )}

                  <Box className="space-y-4">
                    <Button
                      intent="primary"
                      size="lg"
                      className="w-full"
                      onClick={handleSetupPayment}
                      isLoading={loading}
                      disabled={loading || (needsTermsAcceptance && !termsAccepted)}
                    >
                      <CreditCard size={18} />
                      Add Payment Method
                      <ArrowRight size={18} />
                    </Button>

                    <Box className="relative">
                      <Box className="absolute inset-0 flex items-center">
                        <Box className="w-full border-t border-gray-200" />
                      </Box>
                      <Box className="relative flex justify-center">
                        <Text className="px-4 bg-white text-sm text-gray-500">or</Text>
                      </Box>
                    </Box>

                    <Button
                      intent="secondary"
                      size="lg"
                      className="w-full"
                      onClick={handleStartFree}
                      disabled={loading || savingConsent || (needsTermsAcceptance && !termsAccepted)}
                      isLoading={savingConsent}
                    >
                      Start for Free
                      <ArrowRight size={18} />
                    </Button>
                    <Text className="text-sm text-gray-500 text-center">
                      1 project included, no credit card required
                    </Text>
                  </Box>

                  <Text className="text-xs text-gray-400 text-center mt-6">
                    You can upgrade anytime from your dashboard.
                    Payment information is securely processed by Stripe.
                  </Text>
                </Box>
              </>
            )}
          </Card>
        </Box>
      </Box>
    </>
  );
}
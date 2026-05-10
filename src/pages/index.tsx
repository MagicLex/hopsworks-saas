import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import posthog from 'posthog-js';

import { BillingToggle } from '@/components/BillingToggle';
import { DeploymentCard } from '@/components/DeploymentCard';
import { deploymentOptions, DeploymentOption } from '@/data/deployments';
import Layout from '@/components/Layout';
import { DeployModal } from '@/components/DeployModal';
import { useAuth } from '@/contexts/AuthContext';
import { usePricing } from '@/contexts/PricingContext';
import { MatrixText } from '@/components/MatrixText';
import { HopsSpinner } from '@/components/HopsSpinner';
import { cn } from '@/lib/utils';

export default function Home() {
  const { pricing } = usePricing();
  const [isYearly] = useState(false);
  const [selectedDeployment, setSelectedDeployment] =
    useState<DeploymentOption | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [corporateRef, setCorporateRef] = useState<string | null>(null);
  const [corporateCompanyName, setCorporateCompanyName] = useState<
    string | null
  >(null);
  const [corporateLogo, setCorporateLogo] = useState<string | null>(null);
  const [corporateError, setCorporateError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const { user, loading, synced, syncResult } = useAuth();
  const router = useRouter();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const loadingMessages = [
    'Brewing coffee for Hops...',
    'Feeding the feature store...',
    'Polishing the pipelines...',
    'Syncing your features...',
    'Preparing your workspace...',
    'Waking up your cluster...',
  ];

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    const tier = urlParams.get('tier');
    if (tier === 'free' || tier === 'payg') {
      const deployment = deploymentOptions.find((d) => d.id === tier);
      if (deployment) {
        setSelectedDeployment(deployment);
        setIsModalOpen(true);
      }
    }

    const ref = urlParams.get('corporate_ref');
    if (ref) {
      fetch('/api/auth/validate-corporate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: ref, checkDealOnly: true }),
      })
        .then((res) =>
          res.json().then((data) => ({
            ok: res.ok,
            status: res.status,
            data,
          })),
        )
        .then(({ ok, status, data }) => {
          if (status === 404) {
            setCorporateError(`Invalid corporate reference: ${ref}`);
            window.history.replaceState({}, '', window.location.pathname);
          } else if (ok && data.valid) {
            setCorporateRef(ref);
            setCorporateCompanyName(data.companyName || data.dealName);
            setCorporateLogo(
              data.companyDomain
                ? `https://logo.clearbit.com/${data.companyDomain}`
                : data.companyLogo,
            );
            sessionStorage.setItem('corporate_ref', ref);
          }
        })
        .catch((err) => {
          console.error('Failed to validate corporate ref:', err);
          setCorporateError(
            'Unable to validate corporate reference. Please try again or contact support.',
          );
        });
    }

    const promo = urlParams.get('promo');
    if (promo) {
      fetch('/api/auth/validate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoCode: promo }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setPromoCode(data.promoCode);
            sessionStorage.setItem('promo_code', data.promoCode);
          } else {
            setPromoError(data.error || 'Invalid promotional code');
            window.history.replaceState({}, '', window.location.pathname);
          }
        })
        .catch((err) => {
          console.error('Failed to validate promo code:', err);
          setPromoError(
            'Unable to validate promotional code. Please try again or contact support.',
          );
        });
    }
  }, []);

  useEffect(() => {
    if (loading || (user && !synced)) return;

    if (user && synced) {
      if (syncResult?.isSuspended) {
        router.push('/billing-setup');
      } else if (syncResult?.needsPayment) {
        router.push('/billing-setup');
      } else {
        router.push('/dashboard');
      }
    } else if (!user) {
      posthog.capture('landing_page_viewed', {
        hasCorporateRef: !!corporateRef,
        hasPromoCode: !!promoCode,
        source: 'homepage',
      });
    }
  }, [user, loading, synced, syncResult, router, corporateRef, promoCode]);

  const handleDeploy = (deployment: DeploymentOption) => {
    if (deployment.buttonStyle === 'enterprise') {
      window.open('https://www.hopsworks.ai/contact/main', '_blank');
    } else {
      setSelectedDeployment(deployment);
      setIsModalOpen(true);
    }
  };

  useEffect(() => {
    if (!user || synced) return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [user, synced, loadingMessages.length]);

  if (user && !synced) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <HopsSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-muted-foreground font-mono">
            {loadingMessages[loadingMessageIndex]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          Hopsworks - Pay-As-You-Go ML Platform | Feature Store & MLOps
        </title>
        <meta
          name="description"
          content={`Start using Hopsworks instantly. Enterprise-grade feature store, ML pipelines, and model deployment. Pay only for what you use - $${pricing.compute_credits.toFixed(2)}/credit. No upfront costs.`}
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="canonical" href="https://run.hopsworks.ai/" />

        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://run.hopsworks.ai/" />
        <meta property="og:title" content="Hopsworks - Pay-As-You-Go ML Platform" />
        <meta
          property="og:description"
          content="Enterprise-grade feature store and ML platform. Start instantly, pay only for what you use."
        />
        <meta
          property="og:image"
          content="https://cdn.prod.website-files.com/5f6353590bb01cacbcecfbac/60917a423cdde50b5a00feeb_og-hopsworks.png"
        />

        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content="https://run.hopsworks.ai/" />
        <meta property="twitter:title" content="Hopsworks - Pay-As-You-Go ML Platform" />
        <meta
          property="twitter:description"
          content="Enterprise-grade feature store and ML platform. Start instantly, pay only for what you use."
        />
        <meta
          property="twitter:image"
          content="https://cdn.prod.website-files.com/5f6353590bb01cacbcecfbac/60917a423cdde50b5a00feeb_og-hopsworks.png"
        />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Hopsworks',
              applicationCategory: 'DeveloperApplication',
              operatingSystem: 'Web',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
                priceSpecification: [
                  {
                    '@type': 'UnitPriceSpecification',
                    price: String(pricing.compute_credits),
                    priceCurrency: 'USD',
                    unitText: 'credit',
                  },
                ],
              },
              description:
                'Enterprise-grade feature store, ML pipelines, and model deployment platform. Pay-as-you-go pricing with no upfront costs.',
              url: 'https://run.hopsworks.ai',
              featureList: [
                'Feature Store',
                'Model Registry',
                'ML Pipelines',
                'Real-time Feature Serving',
                'Jupyter Notebooks',
                'Model Deployment',
                'Auto-scaling Infrastructure',
              ],
              screenshot:
                'https://cdn.prod.website-files.com/5f6353590bb01cacbcecfbac/60917a423cdde50b5a00feeb_og-hopsworks.png',
              creator: {
                '@type': 'Organization',
                name: 'Hopsworks',
                url: 'https://www.hopsworks.ai',
              },
            }),
          }}
        />
      </Head>

      <Layout className="py-16 px-5">
        <div className="max-w-6xl mx-auto">
          {(corporateRef || corporateError) && (
            <div
              className={cn(
                'mb-6 p-4 rounded-lg border',
                corporateError
                  ? 'bg-destructive/10 border-destructive'
                  : 'bg-quartz-primary-shade2 border-primary',
              )}
            >
              {corporateError ? (
                <p className="text-destructive font-mono text-sm">
                  ❌ {corporateError}
                </p>
              ) : (
                <div className="flex items-center gap-3">
                  {corporateLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={corporateLogo}
                      alt={corporateCompanyName || ''}
                      className="h-10 w-10 object-contain rounded"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex flex-col gap-1">
                    <p className="text-primary font-mono text-sm font-semibold">
                      ✓ Welcome {corporateCompanyName}
                    </p>
                    <p className="text-primary/80 font-mono text-xs">
                      Full platform access unlocked. Sign in with your{' '}
                      {corporateCompanyName &&
                      (corporateCompanyName.toLowerCase().includes('inc') ||
                        corporateCompanyName.toLowerCase().includes('corp') ||
                        corporateCompanyName.toLowerCase().includes('ltd'))
                        ? 'company'
                        : corporateCompanyName}{' '}
                      email.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          {(promoCode || promoError) && (
            <div
              className={cn(
                'mb-6 p-4 rounded-lg border',
                promoError
                  ? 'bg-destructive/10 border-destructive'
                  : 'bg-quartz-label-blue-shade2 border-quartz-label-blue',
              )}
            >
              {promoError ? (
                <p className="text-destructive font-mono text-sm">
                  ❌ {promoError}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-quartz-label-blue font-mono text-sm font-semibold">
                    ✓ Promotional Code Applied: {promoCode}
                  </p>
                  <p className="text-quartz-label-blue font-mono text-xs">
                    Full platform access unlocked. No payment required.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="mb-12">
            <h1 className="text-2xl font-semibold mb-2">
              Start with Hopsworks
            </h1>
            <p className="text-sm text-muted-foreground mb-2">
              <MatrixText text="Storage" /> for features & AI data —{' '}
              <MatrixText text="Compute" /> for training & inference —{' '}
              <MatrixText text="Query" /> for analytics & serving
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              Pay only for what you use.
            </p>
          </div>

          <div className="flex flex-col gap-5">
            {deploymentOptions.map((deployment) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                isYearly={isYearly}
                onDeploy={handleDeploy}
                isCorporate={!!(corporateRef || promoCode)}
              />
            ))}
          </div>
        </div>
      </Layout>

      <DeployModal
        isOpen={isModalOpen}
        deployment={selectedDeployment}
        onClose={() => setIsModalOpen(false)}
        corporateRef={corporateRef}
        promoCode={promoCode}
      />
    </>
  );
}

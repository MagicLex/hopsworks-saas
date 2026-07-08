import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { Button } from '@/components/ui/button';

// Global onboarding gate mounted above every page. Pages only mount when the
// server-resolved onboarding state is 'ready', so their data hooks never fire
// against a half-created account (no more 404 cascades from a user that has
// no DB row, no billing_mode, or no cluster yet).

// Anonymous browsing and legal pages must stay reachable at any state — the
// consent step links to /terms, /aup, /privacy.
const PUBLIC_PATHS = new Set(['/', '/pricing', '/terms', '/privacy', '/aup', '/dpa']);

// Pages that ARE onboarding steps or run their own flow.
const SELF_MANAGED_PATHS = new Set(['/billing-setup', '/team/accept-invite', '/team/joining', '/admin47392']);

function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <div className="max-w-md w-full bg-white rounded-lg border p-8 text-center flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  );
}

function EmailUnverifiedStep() {
  const { user, signOut } = useAuth();
  return (
    <StepShell>
      <h1 className="text-xl font-semibold">Verify your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a verification link to <span className="font-medium">{user?.email}</span>.
        Click it, then continue. Check your spam folder if you don&apos;t see it.
      </p>
      <button
        onClick={() => {
          // Re-run the Auth0 authorize round trip: the live Auth0 session
          // reissues tokens with the refreshed email_verified claim, no
          // credentials prompt needed.
          sessionStorage.removeItem('user_synced_session');
          window.location.href = '/api/auth/login';
        }}
        className="w-full py-2.5 rounded bg-primary text-white text-sm font-medium hover:opacity-90"
      >
        I verified my email, continue
      </button>
      <button onClick={() => signOut()} className="text-xs text-muted-foreground hover:underline">
        Use a different account
      </button>
    </StepShell>
  );
}

function AccountMissingStep() {
  const { resync, syncing } = useAuth();
  return (
    <StepShell>
      <h1 className="text-xl font-semibold">Setting up your account</h1>
      <p className="text-sm text-muted-foreground">
        Your account could not be initialized. This is usually temporary.
      </p>
      <Button onClick={() => resync()} disabled={syncing} loading={syncing}>
        {syncing ? 'Retrying...' : 'Retry'}
      </Button>
    </StepShell>
  );
}

function AssigningClusterStep() {
  const { stalled, retrying, retryCluster } = useOnboarding();
  return (
    <StepShell>
      <h1 className="text-xl font-semibold">Provisioning your cluster</h1>
      {stalled ? (
        <>
          <p className="text-sm text-muted-foreground">
            This is taking longer than expected. You can retry now, or contact
            support@hopsworks.ai if the problem persists.
          </p>
          <Button onClick={() => retryCluster()} disabled={retrying} loading={retrying}>
            {retrying ? 'Retrying...' : 'Retry cluster setup'}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Your Hopsworks cluster access is being set up. This usually takes a
            few seconds.
          </p>
          <div className="flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </>
      )}
    </StepShell>
  );
}

function DeletedStep() {
  const { signOut } = useAuth();
  return (
    <StepShell>
      <h1 className="text-xl font-semibold">Account deleted</h1>
      <p className="text-sm text-muted-foreground">
        This account has been deleted. Contact support@hopsworks.ai if you
        believe this is an error.
      </p>
      <Button onClick={() => signOut()}>Sign out</Button>
    </StepShell>
  );
}

export default function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { state, detail, loading } = useOnboarding();
  const router = useRouter();

  const bypass =
    !user || PUBLIC_PATHS.has(router.pathname) || SELF_MANAGED_PATHS.has(router.pathname);

  // Terms/plan selection, payment setup, and suspension recovery all live on
  // /billing-setup — route there instead of duplicating the UI here.
  const needsBillingSetup =
    state === 'needs_payment' || state === 'suspended' || (state === 'needs_account' && detail === 'terms_or_plan');

  useEffect(() => {
    // Never route on a stale state: while a refetch is in flight the previous
    // resolution may already be obsolete (e.g. right after start-free).
    if (!bypass && !loading && needsBillingSetup) {
      router.replace('/billing-setup');
    }
  }, [bypass, loading, needsBillingSetup, router]);

  if (bypass) {
    return <>{children}</>;
  }

  if (authLoading || loading || state === null) {
    return <FullScreenLoader />;
  }

  switch (state) {
    case 'ready':
      return <>{children}</>;
    case 'email_unverified':
      return <EmailUnverifiedStep />;
    case 'needs_account':
      return detail === 'account_missing' ? <AccountMissingStep /> : <FullScreenLoader />;
    case 'needs_payment':
    case 'suspended':
      return <FullScreenLoader />; // redirecting to /billing-setup
    case 'assigning_cluster':
      return <AssigningClusterStep />;
    case 'deleted':
      return <DeletedStep />;
    default:
      return <>{children}</>;
  }
}

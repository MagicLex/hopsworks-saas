import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from './AuthContext';
import type { OnboardingState, OnboardingDetail } from '@/lib/onboarding';

interface OnboardingInfo {
  state: OnboardingState;
  detail?: OnboardingDetail;
  hasAccount: boolean;
}

interface OnboardingContextType {
  state: OnboardingState | null; // null until first fetch completes
  detail: OnboardingDetail | null;
  hasAccount: boolean;
  loading: boolean;
  // True when assigning_cluster polling exhausted its budget without success.
  stalled: boolean;
  retrying: boolean;
  refetch: () => Promise<void>;
  retryCluster: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

// Bounded polling while the cluster assignment completes: 4s x 20 = 80s,
// then surface a retry button instead of spinning forever.
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 20;

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, synced } = useAuth();
  const router = useRouter();
  const [info, setInfo] = useState<OnboardingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [stalled, setStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pollCount = useRef(0);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/user/onboarding', { cache: 'no-store' });
      if (!res.ok) throw new Error(`onboarding fetch failed: ${res.status}`);
      const data: OnboardingInfo = await res.json();
      setInfo(data);
    } catch (err) {
      console.error('Failed to fetch onboarding state:', err);
      // Leave previous state in place; a transient failure must not eject
      // a ready user back into the gate.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setInfo(null);
      setLoading(false);
      setStalled(false);
      pollCount.current = 0;
      return;
    }
    if (!synced) {
      setLoading(true);
      return;
    }
    setLoading(true);
    fetchState();
  }, [user?.sub, synced, fetchState]);

  // Refetch on navigation while not ready: transitions happen via API calls
  // from step pages (billing-setup), and the redirect that follows is the
  // natural refresh point. loading flips on routeChangeStart — child effects
  // (the gate) run before this provider's own effects, so an effect keyed on
  // pathname would let the gate route on the stale pre-transition state
  // (billing-setup <-> dashboard ping-pong).
  useEffect(() => {
    if (!user || !synced || !info || info.state === 'ready') return;
    const onRouteChangeStart = () => setLoading(true);
    const onRouteChangeComplete = () => fetchState();
    router.events.on('routeChangeStart', onRouteChangeStart);
    router.events.on('routeChangeComplete', onRouteChangeComplete);
    return () => {
      router.events.off('routeChangeStart', onRouteChangeStart);
      router.events.off('routeChangeComplete', onRouteChangeComplete);
    };
  }, [user, synced, info, fetchState, router.events]);

  // Poll while the cluster assignment is in flight.
  useEffect(() => {
    if (info?.state !== 'assigning_cluster') {
      pollCount.current = 0;
      setStalled(false);
      return;
    }
    if (pollCount.current >= POLL_MAX_ATTEMPTS) {
      setStalled(true);
      return;
    }
    const timer = setTimeout(() => {
      pollCount.current += 1;
      fetchState();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [info, fetchState]);

  const retryCluster = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch('/api/user/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry_cluster' }),
      });
      if (res.ok) {
        const data: OnboardingInfo = await res.json();
        setInfo(data);
        pollCount.current = 0;
        setStalled(false);
      }
    } catch (err) {
      console.error('Cluster retry failed:', err);
    } finally {
      setRetrying(false);
    }
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        state: info?.state ?? null,
        detail: info?.detail ?? null,
        hasAccount: info?.hasAccount ?? false,
        loading,
        stalled,
        retrying,
        refetch: fetchState,
        retryCluster,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};

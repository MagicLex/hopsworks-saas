import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useRouter } from 'next/router';

interface AuthContextType {
  user: any;
  loading: boolean;
  syncing: boolean;
  synced: boolean;
  signIn: (corporateRef?: string, promoCode?: string, mode?: 'login' | 'signup') => void;
  signOut: () => void;
  // Clears the per-session sync marker and re-runs sync-user. Used by the
  // onboarding gate to retry a failed account creation.
  resync: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  // Bumped by resync() to force the sync effect to re-run.
  const [syncEpoch, setSyncEpoch] = useState(0);

  useEffect(() => {
    if (!user || isLoading) {
      // Reset sync state when user logs out
      if (!user && !isLoading) {
        setSynced(false);
        setSyncing(false);
      }
      return;
    }

    // Force re-sync after payment setup (user returns from Stripe checkout).
    // synced flips false→true so downstream consumers (onboarding state,
    // billing) refetch once the fresh sync lands.
    if (router.query.payment === 'success') {
      sessionStorage.removeItem('user_synced_session');
      setSynced(false);
      const { payment, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
      return; // effect re-runs after query replace
    }

    // Check if we've already synced this session
    const syncedThisSession = sessionStorage.getItem('user_synced_session');
    if (syncedThisSession === user.sub) {
      setSynced(true);
      return;
    }

    setSyncing(true);
    sessionStorage.setItem('user_synced_session', user.sub!);

    // Terms relay for the team-invite flow (set by accept-invite before the
    // Auth0 redirect). Corporate/promo refs travel in an httpOnly cookie set
    // by /api/auth/signup — no client-side relay.
    const termsAccepted = sessionStorage.getItem('terms_accepted') === 'true';
    const marketingConsent = sessionStorage.getItem('marketing_consent') === 'true';

    fetch('/api/auth/sync-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsAccepted, marketingConsent })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(errData => {
            throw new Error(errData.error || `Sync failed: ${res.status}`);
          });
        }
        return res.json();
      })
      .then(() => {
        sessionStorage.removeItem('terms_accepted');
        sessionStorage.removeItem('marketing_consent');
        setSyncing(false);
        setSynced(true);
      })
      .catch(err => {
        console.error('Failed to sync user:', err);
        sessionStorage.removeItem('user_synced_session');
        setSyncing(false);
        // Still mark as synced so the app doesn't hang — the onboarding
        // state endpoint reports the real situation (e.g. email_unverified).
        setSynced(true);
      });
  }, [user, isLoading, router.query.payment, syncEpoch]);

  const signIn = (corporateRef?: string, promoCode?: string, mode: 'login' | 'signup' = 'login') => {
    const params = new URLSearchParams();
    if (corporateRef) params.set('corporate_ref', corporateRef);
    if (promoCode) params.set('promo', promoCode);
    const qs = params.toString();
    router.push(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}${qs ? `?${qs}` : ''}`);
  };

  const signOut = () => {
    sessionStorage.removeItem('user_synced_session');
    setSynced(false);
    setSyncing(false);
    router.push('/api/auth/logout');
  };

  const resync = () => {
    sessionStorage.removeItem('user_synced_session');
    setSynced(false);
    setSyncEpoch(e => e + 1);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading: isLoading,
      syncing,
      synced,
      signIn,
      signOut,
      resync
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

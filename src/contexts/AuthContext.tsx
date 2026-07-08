import React, { createContext, useContext, useEffect, useState } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useRouter } from 'next/router';

interface SyncResult {
  needsPayment: boolean;
  isSuspended: boolean;
  isTeamMember: boolean;
}

interface AuthContextType {
  user: any;
  loading: boolean;
  syncing: boolean;
  synced: boolean;
  syncResult: SyncResult | null;
  emailVerificationRequired: boolean;
  signIn: (corporateRef?: string, promoCode?: string, mode?: 'login' | 'signup') => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, error, isLoading } = useUser();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

  useEffect(() => {
    if (!user || isLoading) {
      // Reset sync state when user logs out
      if (!user && !isLoading) {
        setSynced(false);
        setSyncing(false);
        setSyncResult(null);
      }
      return;
    }

    // Force re-sync after payment setup (user returns from Stripe checkout)
    if (router.query.payment === 'success') {
      sessionStorage.removeItem('user_synced_session');
      const { payment, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }

    // Check if we've already synced this session
    const syncedThisSession = sessionStorage.getItem('user_synced_session');
    if (syncedThisSession === user.sub) {
      // Already synced - mark as ready
      setSynced(true);
      return;
    }

    // Start syncing
    setSyncing(true);
    sessionStorage.setItem('user_synced_session', user.sub!);

    const corporateRef = sessionStorage.getItem('corporate_ref');
    const promoCode = sessionStorage.getItem('promo_code');
    const termsAccepted = sessionStorage.getItem('terms_accepted') === 'true';
    const marketingConsent = sessionStorage.getItem('marketing_consent') === 'true';

    fetch('/api/auth/sync-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corporateRef, promoCode, termsAccepted, marketingConsent })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(errData => {
            if (errData.emailVerificationRequired) {
              setEmailVerificationRequired(true);
            }
            throw new Error(errData.error || `Sync failed: ${res.status}`);
          });
        }
        return res.json();
      })
      .then(data => {
        // Clear registration data after successful sync
        sessionStorage.removeItem('corporate_ref');
        sessionStorage.removeItem('promo_code');
        sessionStorage.removeItem('terms_accepted');
        sessionStorage.removeItem('marketing_consent');

        // Store sync result for consumers to use
        setSyncResult({
          needsPayment: data.needsPayment,
          isSuspended: data.isSuspended,
          isTeamMember: data.isTeamMember,
        });

        setSyncing(false);
        setSynced(true);
      })
      .catch(err => {
        console.error('Failed to sync user:', err);
        sessionStorage.removeItem('user_synced_session');
        setSyncing(false);
        // Still mark as synced so the app doesn't hang - pages will handle errors
        setSynced(true);
      });
  }, [user, isLoading, router.query.payment]);

  const signIn = (corporateRef?: string, promoCode?: string, mode: 'login' | 'signup' = 'login') => {
    if (corporateRef) {
      sessionStorage.setItem('corporate_ref', corporateRef);
    }
    if (promoCode) {
      sessionStorage.setItem('promo_code', promoCode);
    }
    router.push(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login');
  };

  const signOut = () => {
    sessionStorage.removeItem('user_synced_session');
    setSynced(false);
    setSyncing(false);
    setSyncResult(null);
    setEmailVerificationRequired(false);
    router.push('/api/auth/logout');
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading: isLoading,
      syncing,
      synced,
      syncResult,
      emailVerificationRequired,
      signIn,
      signOut
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
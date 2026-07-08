import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useOnboarding } from './OnboardingContext';

interface CorporateContextType {
  isCorporate: boolean;
  companyName: string | null;
  companyLogo: string | null;
  loading: boolean;
}

const CorporateContext = createContext<CorporateContextType>({
  isCorporate: false,
  companyName: null,
  companyLogo: null,
  loading: true,
});

export const useCorporate = () => useContext(CorporateContext);

export const CorporateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isCorporate, setIsCorporate] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { hasAccount, loading: onboardingLoading } = useOnboarding();

  useEffect(() => {
    if (!user?.sub || (!onboardingLoading && !hasAccount)) {
      setIsCorporate(false);
      setCompanyName(null);
      setCompanyLogo(null);
      setLoading(false);
      return;
    }
    // Wait for the onboarding resolution: corporate-info 404s until the
    // users row exists.
    if (onboardingLoading) {
      return;
    }

    // Fetch corporate info
    fetch('/api/user/corporate-info')
      .then(res => res.json())
      .then(data => {
        if (data.isCorporate) {
          setIsCorporate(true);
          setCompanyName(data.companyName);
          setCompanyLogo(data.companyLogo);
        }
      })
      .catch(err => console.error('Failed to fetch corporate info:', err))
      .finally(() => setLoading(false));
  }, [user?.sub, hasAccount, onboardingLoading]);

  return (
    <CorporateContext.Provider value={{ isCorporate, companyName, companyLogo, loading }}>
      {children}
    </CorporateContext.Provider>
  );
};
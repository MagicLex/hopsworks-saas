import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { UserProvider } from '@auth0/nextjs-auth0/client';
import { AuthProvider } from '@/contexts/AuthContext';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { PricingProvider } from '@/contexts/PricingContext';
import { CorporateProvider } from '@/contexts/CorporateContext';
import { BillingProvider } from '@/contexts/BillingContext';
import OnboardingGate from '@/components/OnboardingGate';
import { Toaster } from '@/components/ui/sonner';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <UserProvider>
        <AuthProvider>
          <OnboardingProvider>
            <PricingProvider>
              <CorporateProvider>
                <BillingProvider>
                  <OnboardingGate>
                    <Component {...pageProps} />
                  </OnboardingGate>
                  <Toaster />
                </BillingProvider>
              </CorporateProvider>
            </PricingProvider>
          </OnboardingProvider>
        </AuthProvider>
      </UserProvider>
    </ThemeProvider>
  );
}

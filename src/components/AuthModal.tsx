import React, { useState, useEffect } from 'react';
import { LogIn, Building2 } from 'lucide-react';
import posthog from 'posthog-js';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  mode?: 'signin' | 'signup';
  corporateRef?: string;
  promoCode?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  mode = 'signup',
  corporateRef,
  promoCode,
}) => {
  const { signIn } = useAuth();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>(mode);
  const [isCorporate, setIsCorporate] = useState(false);
  const [isPromo, setIsPromo] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = corporateRef || urlParams.get('corporate_ref');
    if (ref) {
      setIsCorporate(true);
      sessionStorage.setItem('corporate_ref', ref);
    }

    const promo = promoCode || urlParams.get('promo');
    if (promo) {
      setIsPromo(true);
      sessionStorage.setItem('promo_code', promo);
    }
  }, [corporateRef, promoCode]);

  const handleSignIn = () => {
    const corporateRefValue = sessionStorage.getItem('corporate_ref');
    const promoCodeValue = sessionStorage.getItem('promo_code');

    posthog.capture('signup_initiated', {
      source: 'auth_modal',
      mode: authMode,
      hasCorporateRef: !!corporateRefValue,
      hasPromoCode: !!promoCodeValue,
    });

    signIn(
      corporateRefValue || undefined,
      promoCodeValue || undefined,
      authMode === 'signin' ? 'login' : 'signup',
    );
    onClose();
  };

  const message = isCorporate
    ? 'Corporate account registration. Your organization has a prepaid agreement with Hopsworks. Sign up to get instant access.'
    : isPromo
      ? 'Promotional access enabled. Sign up to get instant access with no payment required.'
      : authMode === 'signin'
        ? 'Welcome back! Sign in to access your Hopsworks instance.'
        : 'Create a new account to start using Hopsworks. No credit card required to sign up.';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn size={20} />
            {authMode === 'signin'
              ? 'Log In to Hopsworks'
              : 'Sign Up for Hopsworks'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <div
            className={cn(
              'rounded-lg border p-4 flex items-center gap-2',
              isCorporate || isPromo
                ? 'border-quartz-label-blue bg-quartz-label-blue-shade2'
                : 'border-primary bg-quartz-primary-shade2',
            )}
          >
            {isCorporate && (
              <Building2 size={16} className="text-quartz-label-blue shrink-0" />
            )}
            <span className="text-sm">{message}</span>
          </div>

          <div className="flex flex-col gap-4">
            <Button size="lg" onClick={handleSignIn} className="w-full">
              {authMode === 'signin'
                ? 'Log In with Auth0'
                : 'Sign Up with Auth0'}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              {authMode === 'signin'
                ? "Don't have an account? "
                : 'Already have an account? '}
              <button
                type="button"
                onClick={() =>
                  setAuthMode(authMode === 'signin' ? 'signup' : 'signin')
                }
                className="text-primary hover:underline font-medium"
              >
                {authMode === 'signin' ? 'Sign Up' : 'Log In'}
              </button>
            </div>

            <Button variant="ghost" size="default" onClick={onClose} className="w-full">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

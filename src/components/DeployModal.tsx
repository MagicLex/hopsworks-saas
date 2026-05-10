import React from 'react';
import { useRouter } from 'next/router';
import { Zap, Terminal, User, Activity, Gift } from 'lucide-react';
import posthog from 'posthog-js';

import { DeploymentOption } from '@/data/deployments';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { usePricing } from '@/contexts/PricingContext';
import { cn } from '@/lib/utils';

interface DeployModalProps {
  isOpen: boolean;
  deployment: DeploymentOption | null;
  onClose: () => void;
  corporateRef?: string | null;
  promoCode?: string | null;
}

export const DeployModal: React.FC<DeployModalProps> = ({
  isOpen,
  deployment,
  onClose,
  corporateRef,
  promoCode,
}) => {
  const { user, signIn } = useAuth();
  const router = useRouter();
  const { pricing } = usePricing();

  if (!deployment) return null;

  const handleStartNow = () => {
    posthog.capture('deploy_modal_opened', {
      hasCorporateRef: !!corporateRef,
      hasPromoCode: !!promoCode,
      isAuthenticated: !!user,
      deployment: deployment?.id,
    });

    if (!user) {
      posthog.capture('signup_initiated', {
        source: 'deploy_modal',
        hasCorporateRef: !!corporateRef,
        hasPromoCode: !!promoCode,
      });
      signIn(corporateRef || undefined, promoCode || undefined, 'signup');
    } else {
      router.push('/billing');
    }
  };

  const isFree = deployment?.id === 'free';
  const cta = isFree
    ? user
      ? 'Start Free'
      : 'Sign Up Free'
    : user
      ? 'Add Payment Method'
      : 'Sign Up';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="font-mono max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Terminal size={20} className="text-primary" />
            <span className="text-lg uppercase">Start with Hopsworks</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {user && (
            <Card className="border-quartz-label-blue bg-quartz-label-blue-shade2 p-4">
              <div className="flex items-center gap-2 mb-2">
                <User size={16} className="text-quartz-label-blue" />
                <h3 className="font-mono text-sm font-semibold">
                  Logged in as: {user.email}
                </h3>
              </div>
            </Card>
          )}

          <Card
            className={cn(
              'p-4',
              isFree
                ? 'border-border bg-muted'
                : 'border-primary bg-quartz-primary-shade2',
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              {isFree ? (
                <Gift size={16} className="text-muted-foreground" />
              ) : (
                <Activity size={16} className="text-primary" />
              )}
              <h3 className="font-mono text-sm uppercase font-semibold">
                {isFree ? 'Free Tier' : 'Pay-As-You-Go'}
              </h3>
            </div>
            <p className="text-sm font-mono text-foreground">
              {isFree
                ? 'Start learning with 1 project. No credit card required. Upgrade anytime.'
                : 'Start using Hopsworks immediately. Only pay for what you use. No upfront costs, cancel anytime.'}
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={16} className="text-primary" />
              <h3 className="font-mono text-sm uppercase text-muted-foreground font-semibold">
                Technical Capabilities
              </h3>
            </div>
            <div className="flex flex-col gap-2">
              {[
                'RonDB Online Store (<1ms latency)',
                'Spark, Flink, Pandas compute engines',
                'Delta Lake, Hudi, Iceberg formats',
                'JupyterLab with Python/Spark kernels',
                'KServe/vLLM model deployment',
                'Point-in-time correct training data',
                'BigQuery, Snowflake, S3 connectors',
              ].map((cap) => (
                <p key={cap} className="font-mono text-sm">
                  ✓ {cap}
                </p>
              ))}
            </div>
          </Card>

          <Card variant="muted" className="p-4">
            <h3 className="font-mono text-sm uppercase text-muted-foreground font-semibold mb-3">
              {isFree ? "What's Included" : 'Pricing'}
            </h3>
            <div className="flex flex-col gap-2">
              {isFree ? (
                <>
                  <div className="flex justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      Projects
                    </span>
                    <span className="font-mono font-semibold">1</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      Credit Card
                    </span>
                    <span className="font-mono font-semibold">Not required</span>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <p className="font-mono text-sm text-muted-foreground">
                      Upgrade to Pay-As-You-Go anytime for more projects
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      Hops Credits
                    </span>
                    <span className="font-mono">
                      ${pricing.compute_credits.toFixed(2)}/credit
                    </span>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <p className="font-mono text-sm text-muted-foreground">
                      {user
                        ? 'Add payment method to get started'
                        : 'Sign up and add payment method to get started'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button onClick={handleStartNow}>
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

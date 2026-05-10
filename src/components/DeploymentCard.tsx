import React from 'react';
import {
  Server,
  HardDrive,
  Cpu,
  Zap,
  Terminal,
  FileCode,
  Calendar,
  X,
} from 'lucide-react';

import { DeploymentOption } from '@/data/deployments';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePricing } from '@/contexts/PricingContext';
import { cn } from '@/lib/utils';

interface DeploymentCardProps {
  deployment: DeploymentOption;
  isYearly: boolean;
  onDeploy: (deployment: DeploymentOption) => void;
  isCorporate?: boolean;
}

export const DeploymentCard: React.FC<DeploymentCardProps> = ({
  deployment,
  isYearly,
  onDeploy,
  isCorporate = false,
}) => {
  const price = isYearly ? deployment.yearlyPrice : deployment.monthlyPrice;
  const { pricing } = usePricing();

  const getButtonText = () => {
    if (deployment.id === 'free') return 'Start Free';
    if (deployment.id === 'payg') return 'Get Started';
    if (deployment.buttonStyle === 'enterprise') return 'Contact Sales';
    return 'Join Cluster';
  };

  const getIconForCategory = (category: string) => {
    switch (category.toLowerCase()) {
      case 'compute':
        return Cpu;
      case 'storage':
        return HardDrive;
      case 'capabilities':
        return Zap;
      default:
        return Server;
    }
  };

  if (
    deployment.buttonStyle === 'enterprise' ||
    deployment.buttonStyle === 'free'
  ) {
    const isEnterprise = deployment.buttonStyle === 'enterprise';
    return (
      <Card className="p-6 bg-muted">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold mb-1">{deployment.name}</h3>
            <p className="text-sm text-muted-foreground">
              {isEnterprise
                ? 'Contact us for bespoke deployment solutions tailored to your needs'
                : deployment.subtitle}
            </p>
          </div>
          <Button
            onClick={() => onDeploy(deployment)}
            variant="outline"
            className="w-[150px] justify-center"
          >
            {isEnterprise ? 'Contact Sales' : 'Start Free'}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="relative">
      {deployment.isRecommended && (
        <div className="absolute -top-2.5 left-5 z-10">
          <span className="bg-background text-primary border border-primary px-2 py-0.5 text-[10px] font-mono tracking-wider rounded">
            recommended
          </span>
        </div>
      )}
      <Card
        className={cn(
          'flex flex-col transition-all hover:border-quartz-gray-shade1',
          deployment.isRecommended && 'border-primary',
        )}
      >
        <div className="flex" style={{ minHeight: '120px' }}>
          <div className="flex-none w-[180px] p-5 border-r border-border relative">
            <div className="absolute top-2 left-2">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full animate-pulse',
                  deployment.id === 'free' ? 'bg-muted-foreground' : 'bg-primary',
                )}
              />
            </div>
            <h4 className="text-base font-semibold mb-1">
              {isCorporate && deployment.id === 'payg'
                ? 'Corporate'
                : deployment.name}
            </h4>
            <div className="text-sm text-muted-foreground mb-2">
              {deployment.id === 'free' ? (
                <Badge className="font-mono font-semibold bg-foreground text-background">
                  $0
                </Badge>
              ) : deployment.id === 'payg' ? (
                isCorporate ? (
                  <Badge className="font-mono font-semibold">PREPAID</Badge>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono font-semibold">
                      ${pricing.compute_credits.toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      /credit
                    </span>
                  </div>
                )
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="font-mono font-semibold">${price}</span>
                  <span className="text-xs text-muted-foreground">/month</span>
                </div>
              )}
            </div>
            {deployment.subtitle && (
              <p className="text-xs text-muted-foreground mb-2">
                {deployment.subtitle}
              </p>
            )}
            <div className="inline-flex items-center px-2 py-0.5 bg-foreground text-background text-xs font-mono font-semibold uppercase tracking-wider">
              EU-WEST
            </div>
          </div>

          <div className="flex flex-1 p-5 gap-8">
            {Object.entries(deployment.specs).map(([category, items]) => {
              const Icon = getIconForCategory(category);
              return (
                <div key={category} className="flex-1">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon size={12} className="text-primary" />
                    <span className="text-xs uppercase tracking-wider font-mono text-muted-foreground">
                      {category}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {items.map((item, index) => {
                      let ItemIcon = Terminal;
                      if (item.includes('Jupyter')) ItemIcon = FileCode;
                      if (item.includes('orchestration'))
                        ItemIcon = Calendar;
                      if (item.includes('No')) ItemIcon = X;

                      return (
                        <div key={index} className="flex items-center gap-1.5">
                          <ItemIcon
                            size={10}
                            className={
                              item.includes('No')
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            }
                          />
                          <span
                            className="text-xs font-mono"
                            dangerouslySetInnerHTML={{
                              __html: item.replace(
                                /(\d+(?:GB|TB)?|^\d+x?\s*\w+|\d+)/g,
                                '<span class="text-primary font-semibold">$1</span>',
                              ),
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex-none px-6 flex items-center">
            <Button
              onClick={() => onDeploy(deployment)}
              variant={
                deployment.id === 'payg' || deployment.isRecommended
                  ? 'default'
                  : 'secondary'
              }
              className="whitespace-nowrap w-[150px] justify-center"
            >
              {getButtonText()}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

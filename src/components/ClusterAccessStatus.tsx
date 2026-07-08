import { AlertTriangle, CheckCircle } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ClusterAccessStatusProps {
  hasCluster: boolean;
  hasPaymentMethod: boolean;
  billingMode?: string;
  clusterName?: string;
  loading?: boolean;
  isTeamMember?: boolean;
}

const variantStyles = {
  success:
    'border-quartz-label-green bg-quartz-label-green-shade2 text-quartz-label-green',
  info: 'border-quartz-label-blue bg-quartz-label-blue-shade2 text-quartz-label-blue',
  warning:
    'border-quartz-label-orange bg-quartz-label-orange-shade2 text-quartz-label-orange',
} as const;

function StatusBox({
  variant,
  icon,
  children,
}: {
  variant: keyof typeof variantStyles;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4 flex items-start gap-3',
        variantStyles[variant],
      )}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 text-foreground">{children}</div>
    </div>
  );
}

export default function ClusterAccessStatus({
  hasCluster,
  hasPaymentMethod,
  billingMode,
  clusterName,
  loading = false,
  isTeamMember = false,
}: ClusterAccessStatusProps) {
  if (loading || billingMode === undefined) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-5" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </Card>
    );
  }

  if (hasCluster) {
    return (
      <StatusBox variant="success" icon={<CheckCircle size={20} />}>
        <div className="font-semibold">Cluster Access Active</div>
        <div className="text-sm">
          Connected to: {clusterName || 'Hopsworks Cluster'}
        </div>
      </StatusBox>
    );
  }

  if (isTeamMember) {
    return (
      <StatusBox variant="info" icon={<AlertTriangle size={20} />}>
        <div className="font-semibold mb-2">Setting Up Your Access</div>
        <div className="text-sm">
          Your cluster access is being configured. This usually takes a few
          moments.
        </div>
      </StatusBox>
    );
  }

  return (
    <StatusBox variant="warning" icon={<AlertTriangle size={20} />}>
      <div className="font-semibold mb-2">Cluster Access Pending</div>
      {!hasPaymentMethod ? (
        <>
          <div className="text-sm mb-4">
            Set up a payment method to get access to Hopsworks clusters.
          </div>
          <Link href="/billing">
            <Button>Set Up Payment</Button>
          </Link>
        </>
      ) : (
        <div className="text-sm">
          Your cluster access is being provisioned. This usually takes a few
          minutes.
        </div>
      )}
    </StatusBox>
  );
}

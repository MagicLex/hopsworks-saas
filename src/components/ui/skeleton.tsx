import * as React from 'react';

import { cn } from '@/lib/utils';

interface SkeletonProps extends React.ComponentProps<'div'> {
  isLoaded?: boolean;
}

function Skeleton({ className, isLoaded, children, ...props }: SkeletonProps) {
  if (isLoaded) return <>{children}</>;

  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };

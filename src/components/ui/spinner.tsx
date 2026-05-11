import * as React from 'react';

import { cn } from '@/lib/utils';

const sizeClasses = {
  sm: 'size-3',
  md: 'size-4',
  lg: 'size-6',
  xl: 'size-8',
} as const;

type SpinnerSize = keyof typeof sizeClasses;

function Spinner({
  className,
  size = 'md',
  ...props
}: Omit<React.ComponentProps<'div'>, 'size'> & { size?: SpinnerSize }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn(
        sizeClasses[size],
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent text-quartz-primary',
        className,
      )}
      {...props}
    />
  );
}

export { Spinner, type SpinnerSize };

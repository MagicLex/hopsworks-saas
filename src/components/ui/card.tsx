import * as React from 'react';

import { cn } from '@/lib/utils';

const cardVariants = {
  default: 'bg-card',
  muted: 'bg-muted',
} as const;

type CardVariant = keyof typeof cardVariants;

function Card({
  className,
  variant = 'default',
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ...props
}: React.ComponentProps<'div'> & { variant?: CardVariant }) {
  const interactive = !!onClick;
  const handleKeyDown = interactive
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }
    : onKeyDown;

  return (
    <div
      data-slot="card"
      data-variant={variant}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={role ?? (interactive ? 'button' : undefined)}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      className={cn(
        'rounded-lg border border-border text-card-foreground',
        cardVariants[variant],
        interactive &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 pt-6 pb-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-6 pb-6 first:pt-6', className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 pb-6', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
};

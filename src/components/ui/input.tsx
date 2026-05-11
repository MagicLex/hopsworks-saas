import * as React from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

interface InputProps extends React.ComponentProps<'input'> {
  label?: string;
  labelAction?: React.ReactNode;
  optional?: boolean;
  info?: string;
  intent?: 'default' | 'error';
}

function Input({
  className,
  type,
  label,
  labelAction,
  optional,
  info,
  intent,
  id: idProp,
  ...props
}: InputProps) {
  const autoId = React.useId();
  const inputId = idProp || autoId;

  const hasField = label || labelAction || optional || info;

  const input = (
    <input
      id={inputId}
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-muted px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        !hasField && className,
      )}
      aria-invalid={intent === 'error' || undefined}
      {...props}
    />
  );

  if (!hasField) return input;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || labelAction || optional) && (
        <div className="flex items-center gap-1">
          {label && <Label htmlFor={inputId}>{label}</Label>}
          {optional && (
            <span className="text-xs text-muted-foreground">(optional)</span>
          )}
          {labelAction}
        </div>
      )}
      {input}
      {info && (
        <span
          className={cn(
            'text-xs',
            intent === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {info}
        </span>
      )}
    </div>
  );
}

export { Input, type InputProps };

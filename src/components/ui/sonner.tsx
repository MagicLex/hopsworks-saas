import * as React from 'react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
} from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="top-right"
      richColors
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Spinner />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--quartz-label-green-shade2)',
          '--success-text': 'var(--quartz-label-green)',
          '--success-border': 'var(--quartz-label-green)',
          '--error-bg': 'var(--quartz-label-red-shade2)',
          '--error-text': 'var(--quartz-label-red)',
          '--error-border': 'var(--quartz-label-red)',
          '--warning-bg': 'var(--quartz-label-orange-shade2)',
          '--warning-text': 'var(--quartz-label-orange)',
          '--warning-border': 'var(--quartz-label-orange)',
          '--info-bg': 'var(--quartz-label-blue-shade2)',
          '--info-text': 'var(--quartz-label-blue)',
          '--info-border': 'var(--quartz-label-blue)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

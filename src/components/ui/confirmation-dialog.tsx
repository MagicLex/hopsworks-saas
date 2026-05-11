import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'default' | 'destructive';
  loading?: boolean;
  /** When set, user must type this string verbatim to enable the confirm button. */
  requireTypedConfirm?: string;
  onConfirm: () => void | Promise<void>;
}

function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  loading = false,
  requireTypedConfirm,
  onConfirm,
}: ConfirmationDialogProps) {
  const [typed, setTyped] = React.useState('');

  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const typedOk = !requireTypedConfirm || typed === requireTypedConfirm;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant={confirmVariant === 'destructive' ? 'destructive' : 'default'}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {requireTypedConfirm && (
          <Input
            label={`Type "${requireTypedConfirm}" to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={!typedOk || loading}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmationDialog };

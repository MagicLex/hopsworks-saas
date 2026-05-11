import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface BillingToggleProps {
  isYearly: boolean;
  onToggle: () => void;
}

export const BillingToggle: React.FC<BillingToggleProps> = ({
  isYearly,
  onToggle,
}) => {
  return (
    <div className="flex items-center gap-3 mb-8">
      <Label
        htmlFor="billing-toggle"
        className="text-muted-foreground cursor-pointer"
      >
        Monthly billing
      </Label>
      <Switch
        id="billing-toggle"
        checked={isYearly}
        onCheckedChange={onToggle}
      />
      <Label
        htmlFor="billing-toggle"
        className="text-muted-foreground cursor-pointer"
      >
        Annual billing (save 20%)
      </Label>
    </div>
  );
};

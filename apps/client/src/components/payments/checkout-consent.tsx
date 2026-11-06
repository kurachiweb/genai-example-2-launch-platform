import { useId } from 'react';

import { CHECKOUT_CONSENT_TEXT } from '../../../common-lib/payments/checkout-consent.ts';
import { Checkbox } from '../../../lib/components/ui/checkbox/checkbox.tsx';
import { CONSENT_REQUIRED_SUFFIX } from './checkout-messages.ts';

export interface CheckoutConsentProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

// 居住地を問わず、役務の即時提供への同意と撤回権を失う旨の了知を求める
export function CheckoutConsent({
  checked,
  onCheckedChange,
}: CheckoutConsentProps) {
  const checkboxId = useId();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
        aria-required
        className="mt-1"
      />
      <label htmlFor={checkboxId} className="text-sm leading-relaxed">
        {`${CHECKOUT_CONSENT_TEXT}${CONSENT_REQUIRED_SUFFIX}`}
      </label>
    </div>
  );
}

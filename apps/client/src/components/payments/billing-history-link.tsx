import { Link } from '@tanstack/react-router';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { BILLING_HISTORY_LINK_LABEL } from './checkout-messages.ts';

export function BillingHistoryLink() {
  return (
    <Button asChild variant="outline">
      <Link to="/settings/billing">{BILLING_HISTORY_LINK_LABEL}</Link>
    </Button>
  );
}

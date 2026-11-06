import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  BILLING_HISTORY_HREF,
  BILLING_HISTORY_LINK_LABEL,
} from './checkout-messages.ts';

// 決済履歴の経路は決済履歴の画面のタスクが作るため、型付きのLinkではなくパスで遷移する
export function BillingHistoryLink() {
  return (
    <Button asChild variant="outline">
      <PathLink href={BILLING_HISTORY_HREF}>
        {BILLING_HISTORY_LINK_LABEL}
      </PathLink>
    </Button>
  );
}

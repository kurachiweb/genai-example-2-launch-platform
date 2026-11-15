import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { BillingHistoryLink } from './billing-history-link.tsx';
import {
  CHECKOUT_NOT_FOUND_DESCRIPTION,
  CHECKOUT_NOT_FOUND_MESSAGE,
} from './checkout-messages.ts';
import { CheckoutPageFrame } from './checkout-page-frame.tsx';

export type CheckoutStatusPageState =
  | { readonly status: 'pending' }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly onRetry: () => void;
    }
  | { readonly status: 'not-found' };

export interface CheckoutStatusPageProps {
  readonly state: CheckoutStatusPageState;
}

function CheckoutStatusContent({ state }: CheckoutStatusPageProps) {
  switch (state.status) {
    case 'pending':
      return <LoadingSkeleton />;
    case 'error':
      return (
        <ErrorState
          message={errorMessageOf(state.error, CLIENT_PROFILE.contactAvailable)}
          onRetry={state.onRetry}
          contactHref={CONTACT_HREF}
        />
      );
    case 'not-found':
      return (
        <EmptyState
          title={CHECKOUT_NOT_FOUND_MESSAGE}
          description={CHECKOUT_NOT_FOUND_DESCRIPTION}
          action={<BillingHistoryLink />}
        />
      );
  }
}

// 決済画面の読み込み中・取得の失敗・見つからない表示。他人・存在しない購入は状態を明かさない
export function CheckoutStatusPage({ state }: CheckoutStatusPageProps) {
  return (
    <CheckoutPageFrame>
      <CheckoutStatusContent state={state} />
    </CheckoutPageFrame>
  );
}

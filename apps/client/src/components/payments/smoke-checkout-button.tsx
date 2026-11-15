import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientStartSmokeCheckoutDocument } from '../../graphql/generated/graphql.ts';
import { SettingsSection } from '../settings/settings-section.tsx';
import {
  SMOKE_CHECKOUT_DESCRIPTION,
  SMOKE_CHECKOUT_LABEL,
  SMOKE_CHECKOUT_PENDING_LABEL,
  SMOKE_CHECKOUT_SECTION_TITLE,
} from './payment-history-messages.ts';

// 疎通確認の購入を作って決済画面へ移る。prodでの表示の有無は呼び出し側が決め、APIサーバーも疎通確認の購入種別が無効な環境では拒否する
export function SmokeCheckoutButton() {
  const errorId = useId();
  const navigate = useNavigate();
  const startSmokeCheckout = useMutation({
    ...graphqlMutationOptions(ClientStartSmokeCheckoutDocument),
    onSuccess: async ({ startSmokeCheckout: { purchaseId } }) => {
      await navigate({
        to: '/checkout/$purchaseId',
        params: { purchaseId },
      });
    },
  });
  const pending = startSmokeCheckout.isPending;
  const failure = pending ? null : startSmokeCheckout.error;

  return (
    <SettingsSection
      title={SMOKE_CHECKOUT_SECTION_TITLE}
      description={SMOKE_CHECKOUT_DESCRIPTION}
    >
      <div className="flex flex-col items-start gap-3">
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          aria-describedby={failure === null ? undefined : errorId}
          onClick={() => {
            if (!pending) {
              startSmokeCheckout.mutate({ variables: {} });
            }
          }}
        >
          {pending ? SMOKE_CHECKOUT_PENDING_LABEL : SMOKE_CHECKOUT_LABEL}
        </Button>
        {failure === null ? null : (
          <FormMessage id={errorId} role="alert">
            {errorMessageOf(failure, CLIENT_PROFILE.contactAvailable)}
          </FormMessage>
        )}
      </div>
    </SettingsSection>
  );
}

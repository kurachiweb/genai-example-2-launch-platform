import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientStartUltrasCheckoutDocument } from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { LoginRequiredDialog } from '../auth/login-required-dialog.tsx';
import {
  PRICING_PAGE_HREF,
  ULTRAS_EMAIL_UNVERIFIED_REASON,
  ULTRAS_LOGIN_REQUIRED_DESCRIPTION,
  ULTRAS_LOGIN_REQUIRED_TITLE,
  ULTRAS_SUBSCRIBE_LABEL,
  ULTRAS_SUBSCRIBE_PENDING_LABEL,
} from './ultras-messages.ts';

export interface UltrasSubscribeButtonProps {
  readonly viewer: ClientViewer | null;
  readonly priceAvailable: boolean;
  readonly returnTo?: string;
  readonly priceUnavailableReasonId?: string;
}

const describedByOf = (
  ids: readonly (string | undefined)[],
): string | undefined => {
  const joined = ids.filter((id) => id !== undefined).join(' ');
  return joined === '' ? undefined : joined;
};

function useUltrasSubscription(viewer: ClientViewer | null) {
  const navigate = useNavigate();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const startCheckout = useMutation({
    ...graphqlMutationOptions(ClientStartUltrasCheckoutDocument),
    onSuccess: async ({ startUltrasCheckout: { purchaseId } }) => {
      await navigate({
        to: '/checkout/$purchaseId',
        params: { purchaseId },
      });
    },
  });
  const pending = startCheckout.isPending;

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する
  const handleClick = () => {
    if (pending) {
      return;
    }
    if (viewer === null) {
      setLoginDialogOpen(true);
      return;
    }
    startCheckout.mutate({ variables: {} });
  };

  return {
    pending,
    failure: pending ? null : startCheckout.error,
    loginDialogOpen,
    setLoginDialogOpen,
    handleClick,
  };
}

// 条件を満たすまで押せない間はdisabledにし、送信中はフォーカスのあるボタンの位置を失わないようaria-disabledにする
export function UltrasSubscribeButton({
  viewer,
  priceAvailable,
  returnTo = PRICING_PAGE_HREF,
  priceUnavailableReasonId,
}: UltrasSubscribeButtonProps) {
  const reasonId = useId();
  const errorId = useId();
  const emailUnverified = viewer !== null && !viewer.emailVerified;
  const { pending, failure, loginDialogOpen, setLoginDialogOpen, handleClick } =
    useUltrasSubscription(viewer);

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        type="button"
        disabled={emailUnverified || !priceAvailable}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        aria-describedby={describedByOf([
          emailUnverified ? reasonId : undefined,
          priceAvailable ? undefined : priceUnavailableReasonId,
          failure === null ? undefined : errorId,
        ])}
        onClick={handleClick}
      >
        {pending ? ULTRAS_SUBSCRIBE_PENDING_LABEL : ULTRAS_SUBSCRIBE_LABEL}
      </Button>
      {emailUnverified ? (
        <FormMessage id={reasonId}>
          {ULTRAS_EMAIL_UNVERIFIED_REASON}
        </FormMessage>
      ) : null}
      {failure === null ? null : (
        <FormMessage id={errorId} role="alert">
          {errorMessageOf(failure, CLIENT_PROFILE.contactAvailable)}
        </FormMessage>
      )}
      {viewer === null ? (
        <LoginRequiredDialog
          open={loginDialogOpen}
          onOpenChange={setLoginDialogOpen}
          title={ULTRAS_LOGIN_REQUIRED_TITLE}
          description={ULTRAS_LOGIN_REQUIRED_DESCRIPTION}
          returnTo={returnTo}
        />
      ) : null}
    </div>
  );
}

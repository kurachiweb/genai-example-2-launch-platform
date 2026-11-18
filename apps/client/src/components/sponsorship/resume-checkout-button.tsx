import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { resumeSponsorshipCheckoutMutationOptions } from '../../graphql/sponsorship.ts';
import { SPONSORSHIP_APPLY_BOT_ACTION } from './bot-actions.ts';
import {
  RESUME_SPONSORSHIP_CHECKOUT_LABEL,
  SPONSORSHIP_SUBMIT_PENDING_LABEL,
  sponsorshipErrorMessageOf,
} from './sponsorship-messages.ts';

export interface ResumeCheckoutButtonProps {
  readonly sponsorshipId: string;
  // 申込の状態が一覧の表示から変わっていた時に、通知の後で呼ぶ。一覧を取り直してボタンを消す
  readonly onStale: () => void;
}

// 開始日の経過と日次の処理による削除は、一覧の表示が古いことを示すため、通知して一覧を取り直す
const STALE_ERROR_CODES: ReadonlySet<string> = new Set([
  'sponsorship_not_payable',
  'sponsorship_not_found',
]);

const errorCodeOf = (error: unknown): string | undefined =>
  error instanceof GraphQLClientError ? error.code : undefined;

const messageOf = (error: unknown): string =>
  sponsorshipErrorMessageOf(errorCodeOf(error)) ??
  errorMessageOf(error, CLIENT_PROFILE.contactAvailable);

// 未決済の申込の新しい決済を始めて決済画面へ移る。送信中はフォーカスの位置を失わないようaria-disabledにし、決済サービスの障害の後は再読み込みまで無効にする
export function ResumeCheckoutButton({
  sponsorshipId,
  onStale,
}: ResumeCheckoutButtonProps) {
  const turnstile = useTurnstileToken();
  const navigate = useNavigate();
  const resume = useMutation(resumeSponsorshipCheckoutMutationOptions());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [paymentsUnavailable, setPaymentsUnavailable] = useState(false);
  const unavailableId = useId();
  const errorId = useId();

  const handleError = (error: unknown): void => {
    const code = errorCodeOf(error);
    if (code === 'payments_unavailable') {
      setPaymentsUnavailable(true);
      return;
    }
    if (code !== undefined && STALE_ERROR_CODES.has(code)) {
      notify.error(messageOf(error));
      onStale();
      return;
    }
    setFailure(messageOf(error));
  };

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する
  const handleClick = async (): Promise<void> => {
    if (pending) {
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const { resumeSponsorshipCheckout } = await sendWithTurnstile(
        turnstile,
        (turnstileToken) =>
          resume.mutateAsync({
            variables: { id: sponsorshipId },
            turnstileToken,
          }),
      );
      await navigate({
        to: '/checkout/$purchaseId',
        params: { purchaseId: resumeSponsorshipCheckout.purchaseId },
      });
    } catch (error) {
      handleError(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        className="w-fit"
        disabled={paymentsUnavailable}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        aria-describedby={
          paymentsUnavailable
            ? unavailableId
            : failure === null
              ? undefined
              : errorId
        }
        onClick={() => {
          void handleClick();
        }}
      >
        {pending
          ? SPONSORSHIP_SUBMIT_PENDING_LABEL
          : RESUME_SPONSORSHIP_CHECKOUT_LABEL}
      </Button>
      {paymentsUnavailable ? (
        <UnavailableNotice
          id={unavailableId}
          reason={PAYMENTS_UNAVAILABLE_REASON}
          className="text-xs"
        />
      ) : null}
      {failure === null ? null : (
        <FormMessage id={errorId} role="alert">
          {failure}
        </FormMessage>
      )}
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={SPONSORSHIP_APPLY_BOT_ACTION}
      />
    </div>
  );
}

import { type UseMutationOptions, useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { TrophyIcon } from 'lucide-react';
import { useId } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { GraphQLMutationInput } from '../../../lib/start/graphql/graphql-query-options.ts';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { PRICING_HREF } from '../layout/site-links.ts';
import { PRICING_LINK_LABEL } from '../product/launch-messages.ts';
import { UltrasPromotionGate } from '../ultras/ultras-promotion-gate.tsx';
import {
  ENTRY_FEE_PREFIX,
  ENTRY_PENDING_LABEL,
  ENTRY_ULTRAS_GUIDE_SUFFIX,
  type TournamentEntryCopy,
} from './tournament-copy.ts';

// 種類の参加費の購入を作る変更と、その結果から決済画面へ移る購入のIDを取り出す関数
export interface TournamentEntryCheckoutStart<TData> {
  readonly mutationOptions: UseMutationOptions<
    TData,
    Error,
    GraphQLMutationInput<{ readonly launchId: string }>
  >;
  readonly purchaseIdOf: (data: TData) => string;
}

export interface TournamentEntryCheckoutProps<TData> {
  readonly launchId: string;
  // 参加費(税込のUSDの最小単位)。照会できなければnull
  readonly feeAmount: number | null;
  // 決済を始められる枠でUltrasの特典を受けていない。表示はUltrasの導線の機能フラグにも従う
  readonly ultrasGuide: boolean;
  // プロダクトを表示できない間など、受付中でも決済を始められない理由の文言。無ければnull
  readonly blockedReason: string | null;
  readonly copy: Pick<TournamentEntryCopy, 'entryButton' | 'closedMessage'>;
  readonly checkout: TournamentEntryCheckoutStart<TData>;
}

const isErrorCode = (error: unknown, code: string): boolean =>
  error instanceof GraphQLClientError && error.code === code;

// 受付期限の後の開始は決済の機能がcheckout_closedで拒否するが、参加費の導線では決済の文言ではなく参加受付の終了として示す。種類の拒否の理由はサーバーの文言を示す
const rejectionMessageOf = (error: unknown, closedMessage: string): string =>
  isErrorCode(error, 'checkout_closed')
    ? closedMessage
    : errorMessageOf(error, CLIENT_PROFILE.contactAvailable);

const describedByOf = (
  ids: readonly (string | undefined)[],
): string | undefined => {
  const joined = ids.filter((id) => id !== undefined).join(' ');
  return joined === '' ? undefined : joined;
};

function UltrasGuide() {
  return (
    <UltrasPromotionGate>
      <p className="text-xs text-muted-foreground">
        <span translate="no">Ultras</span>
        {ENTRY_ULTRAS_GUIDE_SUFFIX}
        <PathLink
          href={PRICING_HREF}
          className={cn(INLINE_LINK_CLASS_NAME, 'ml-1')}
        >
          {PRICING_LINK_LABEL}
        </PathLink>
      </p>
    </UltrasPromotionGate>
  );
}

// 参加費の購入を作って決済画面へ移る。決済を始められない理由がある間・参加費を照会できない間・決済サービスの障害の後はボタンを無効にし、送信中はフォーカスの位置を失わないようaria-disabledにする
export function TournamentEntryCheckout<TData>({
  launchId,
  feeAmount,
  ultrasGuide,
  blockedReason,
  copy,
  checkout,
}: TournamentEntryCheckoutProps<TData>) {
  const navigate = useNavigate();
  const unavailableId = useId();
  const errorId = useId();
  const startCheckout = useMutation({
    ...checkout.mutationOptions,
    onSuccess: async (data) => {
      await navigate({
        to: '/checkout/$purchaseId',
        params: { purchaseId: checkout.purchaseIdOf(data) },
      });
    },
  });
  const pending = startCheckout.isPending;
  const failure = pending ? null : startCheckout.error;
  const unavailable =
    blockedReason !== null ||
    feeAmount === null ||
    isErrorCode(failure, 'payments_unavailable');
  const rejection =
    failure === null || unavailable
      ? null
      : rejectionMessageOf(failure, copy.closedMessage);

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する
  const handleClick = () => {
    if (!pending) {
      startCheckout.mutate({ variables: { launchId } });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        className="h-auto w-full flex-col gap-0 py-2 whitespace-normal"
        disabled={unavailable}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        aria-describedby={describedByOf([
          unavailable ? unavailableId : undefined,
          rejection === null ? undefined : errorId,
        ])}
        onClick={handleClick}
      >
        <span className="inline-flex items-center gap-2">
          <TrophyIcon aria-hidden="true" />
          {pending ? ENTRY_PENDING_LABEL : copy.entryButton}
        </span>
        {feeAmount !== null && (
          <span className="text-xs font-normal opacity-85">
            {ENTRY_FEE_PREFIX}
            <MoneyText amount={feeAmount} />
          </span>
        )}
      </Button>
      {unavailable && (
        <UnavailableNotice
          id={unavailableId}
          reason={blockedReason ?? PAYMENTS_UNAVAILABLE_REASON}
          className="text-xs"
        />
      )}
      {rejection !== null && (
        <FormMessage id={errorId} role="alert">
          {rejection}
        </FormMessage>
      )}
      {ultrasGuide && <UltrasGuide />}
    </div>
  );
}

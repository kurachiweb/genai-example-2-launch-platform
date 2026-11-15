import { useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import {
  ULTRAS_PLAN_STATUS_LABELS,
  type UltrasPlanStatus,
} from '../../../common-lib/ultras/plan-status.ts';
import type {
  ClientUltrasOfferQuery,
  ClientViewerUltrasQuery,
} from '../../graphql/generated/graphql.ts';
import { toUltrasPlanStatus } from '../../graphql/ultras.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { SettingsSection } from '../settings/settings-section.tsx';
import {
  PLAN_ACTIVE_GUIDANCE,
  PLAN_BENEFIT_ENDS_AT_LABEL,
  PLAN_CANCELED_AT_LABEL,
  PLAN_CANCELED_GUIDANCE,
  PLAN_NEXT_RENEWAL_AT_LABEL,
  PLAN_NOT_SUBSCRIBED_MESSAGE,
  PLAN_PAST_DUE_GUIDANCE,
  PLAN_PROMOTION_CLOSED_MESSAGE,
  PLAN_STARTED_AT_LABEL,
  PLAN_STATUS_SECTION_TITLE,
} from './plan-messages.ts';
import { UltrasBenefitList } from './ultras-benefit-list.tsx';
import { PLAN_PAGE_HREF, ULTRAS_PLAN_STATUS_LABEL } from './ultras-messages.ts';
import { UltrasPriceLine } from './ultras-price-line.tsx';
import { UltrasSubscribeButton } from './ultras-subscribe-button.tsx';

export type UltrasPlanView = NonNullable<
  NonNullable<ClientViewerUltrasQuery['viewerUltras']>['plan']
>;

export type UltrasPriceView = NonNullable<
  ClientUltrasOfferQuery['ultrasOffer']['price']
>;

export interface PlanStatusPanelProps {
  readonly viewer: ClientViewer;
  readonly plan: UltrasPlanView | null;
  readonly promotionEnabled: boolean;
  readonly price: UltrasPriceView | null;
}

type SubscribedStatus = Exclude<UltrasPlanStatus, 'ended'>;

interface DateItem {
  readonly term: string;
  readonly value: string | null;
}

interface PresentDateItem extends DateItem {
  readonly value: string;
}

const GUIDANCE: Readonly<Record<SubscribedStatus, string>> = Object.freeze({
  active: PLAN_ACTIVE_GUIDANCE,
  past_due: PLAN_PAST_DUE_GUIDANCE,
  canceled: PLAN_CANCELED_GUIDANCE,
});

// 加入状態ごとに示す日時の項目。解約済みは解約の操作と特典の終了、それ以外は加入の開始と次回の更新
const dateItemsOf = (
  plan: UltrasPlanView,
  status: SubscribedStatus,
): readonly DateItem[] =>
  status === 'canceled'
    ? [
        { term: PLAN_CANCELED_AT_LABEL, value: plan.canceledAt },
        { term: PLAN_BENEFIT_ENDS_AT_LABEL, value: plan.benefitEndsAt },
      ]
    : [
        { term: PLAN_STARTED_AT_LABEL, value: plan.startedAt },
        { term: PLAN_NEXT_RENEWAL_AT_LABEL, value: plan.currentPeriodEndsAt },
      ];

const isPresent = (item: DateItem): item is PresentDateItem =>
  item.value !== null;

function PlanDateList({ items }: { readonly items: readonly DateItem[] }) {
  const present = items.filter(isPresent);
  if (present.length === 0) {
    return null;
  }
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
      {present.map(({ term, value }) => (
        <div key={term} className="contents">
          <dt className="text-sm font-bold text-muted-foreground">{term}</dt>
          <dd className="font-medium">
            <DateTime value={value} format="longDateTime" />
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface SubscribedDetailsProps {
  readonly plan: UltrasPlanView;
  readonly status: SubscribedStatus;
  readonly amount: MinorUnitAmount | null;
}

function SubscribedDetails({ plan, status, amount }: SubscribedDetailsProps) {
  return (
    <>
      <p>{GUIDANCE[status]}</p>
      <PlanDateList items={dateItemsOf(plan, status)} />
      {status === 'active' ? <UltrasBenefitList amount={amount} /> : null}
    </>
  );
}

interface UnsubscribedActionsProps {
  readonly viewer: ClientViewer;
  readonly promotionEnabled: boolean;
  readonly amount: MinorUnitAmount | null;
}

// 加入の導線は料金ページと同じ形にし、価格が無いときの文言を加入のボタンの無効の理由として結び付ける
function UnsubscribedActions({
  viewer,
  promotionEnabled,
  amount,
}: UnsubscribedActionsProps) {
  const priceReasonId = useId();
  return (
    <>
      <p>{PLAN_NOT_SUBSCRIBED_MESSAGE}</p>
      {promotionEnabled ? (
        <>
          <UltrasPriceLine
            amount={amount}
            unavailableReasonId={priceReasonId}
          />
          <UltrasSubscribeButton
            viewer={viewer}
            priceAvailable={amount !== null}
            priceUnavailableReasonId={priceReasonId}
            returnTo={PLAN_PAGE_HREF}
          />
        </>
      ) : (
        <p>{PLAN_PROMOTION_CLOSED_MESSAGE}</p>
      )}
    </>
  );
}

export function PlanStatusPanel({
  viewer,
  plan,
  promotionEnabled,
  price,
}: PlanStatusPanelProps) {
  const status = plan === null ? null : toUltrasPlanStatus(plan.status);
  const amount = price?.amount ?? null;

  return (
    <SettingsSection title={PLAN_STATUS_SECTION_TITLE}>
      {status === null ? null : (
        <p className="font-bold">
          {`${ULTRAS_PLAN_STATUS_LABEL}: ${ULTRAS_PLAN_STATUS_LABELS[status]}`}
        </p>
      )}
      {plan === null || status === null || status === 'ended' ? (
        <UnsubscribedActions
          viewer={viewer}
          promotionEnabled={promotionEnabled}
          amount={amount}
        />
      ) : (
        <SubscribedDetails plan={plan} status={status} amount={amount} />
      )}
    </SettingsSection>
  );
}

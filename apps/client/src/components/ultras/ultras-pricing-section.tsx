import { useSuspenseQueries } from '@tanstack/react-query';
import { useId } from 'react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import { ULTRAS_PLAN_STATUS_LABELS } from '../../../common-lib/ultras/plan-status.ts';
import type { ClientViewerUltrasQuery } from '../../graphql/generated/graphql.ts';
import {
  toUltrasPlanStatus,
  ultrasOfferQueryOptions,
  viewerUltrasQueryOptions,
} from '../../graphql/ultras.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { UltrasBenefitList } from './ultras-benefit-list.tsx';
import {
  PLAN_PAGE_HREF,
  ULTRAS_MONTHLY_PRICE_PREFIX,
  ULTRAS_MONTHLY_PRICE_SUFFIX,
  ULTRAS_PLAN_STATUS_LABEL,
  ULTRAS_PRICE_UNAVAILABLE_MESSAGE,
  ULTRAS_PRICING_SECTION_TITLE,
  ULTRAS_VIEW_PLAN_LABEL,
} from './ultras-messages.ts';
import { UltrasSubscribeButton } from './ultras-subscribe-button.tsx';

type ViewerUltras = NonNullable<ClientViewerUltrasQuery['viewerUltras']>;

const PRICE_CLASS_NAME = 'text-xl font-bold';

interface PriceLineProps {
  readonly amount: MinorUnitAmount | null;
  readonly unavailableReasonId: string;
}

// 価格を照会できないときの文言は、加入のボタンがaria-describedbyで理由として結び付けるためidを持つ
function PriceLine({ amount, unavailableReasonId }: PriceLineProps) {
  if (amount === null) {
    return (
      <p id={unavailableReasonId} className={PRICE_CLASS_NAME}>
        {ULTRAS_PRICE_UNAVAILABLE_MESSAGE}
      </p>
    );
  }
  return (
    <p className={PRICE_CLASS_NAME}>
      {ULTRAS_MONTHLY_PRICE_PREFIX}
      <MoneyText amount={amount} />
      {ULTRAS_MONTHLY_PRICE_SUFFIX}
    </p>
  );
}

// 特典の継続期間内の閲覧者には、加入のボタンの代わりに現在の加入状態とプラン管理画面への導線を描く。プラン管理画面の経路は後続のタスクが作るため、パスへの遷移の共通部品で描く
function EntitledPlanActions({
  plan,
}: {
  readonly plan: ViewerUltras['plan'];
}) {
  const statusText =
    plan === null
      ? null
      : `${ULTRAS_PLAN_STATUS_LABEL}: ${ULTRAS_PLAN_STATUS_LABELS[toUltrasPlanStatus(plan.status)]}`;
  return (
    <div className="flex flex-col items-start gap-3">
      {statusText === null ? null : <p className="font-bold">{statusText}</p>}
      <Button variant="outline" asChild>
        <PathLink href={PLAN_PAGE_HREF}>{ULTRAS_VIEW_PLAN_LABEL}</PathLink>
      </Button>
    </div>
  );
}

// 区画自身が価格と加入状態を取得し、最初の取得の失敗だけを区画のエラーの境界へ投げる。機能フラグがオフで特典の継続期間内にない閲覧者には何も描かない
export function UltrasPricingSection() {
  const viewer = useViewer();
  const headingId = useId();
  const priceReasonId = useId();
  const [{ data: offer }, { data: viewerUltras }] = useSuspenseQueries({
    queries: [ultrasOfferQueryOptions(), viewerUltrasQueryOptions(viewer)],
  });
  const { price, promotionEnabled } = offer.ultrasOffer;
  const ultras = viewerUltras.viewerUltras;
  const entitled = ultras?.entitled ?? false;

  if (!promotionEnabled && !entitled) {
    return null;
  }

  const amount = price?.amount ?? null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} className="text-2xl font-extrabold tracking-tight">
        {ULTRAS_PRICING_SECTION_TITLE}
      </h2>
      <PriceLine amount={amount} unavailableReasonId={priceReasonId} />
      <UltrasBenefitList amount={amount} />
      {ultras !== null && entitled ? (
        <EntitledPlanActions plan={ultras.plan} />
      ) : (
        <UltrasSubscribeButton
          viewer={viewer}
          priceAvailable={amount !== null}
          priceUnavailableReasonId={priceReasonId}
        />
      )}
    </section>
  );
}

import { useSuspenseQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
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
  ULTRAS_PLAN_STATUS_LABEL,
  ULTRAS_PRICING_SECTION_TITLE,
  ULTRAS_VIEW_PLAN_LABEL,
} from './ultras-messages.ts';
import { UltrasPriceLine } from './ultras-price-line.tsx';
import { UltrasSubscribeButton } from './ultras-subscribe-button.tsx';

type ViewerUltras = NonNullable<ClientViewerUltrasQuery['viewerUltras']>;

// 特典の継続期間内の閲覧者には、加入のボタンの代わりに現在の加入状態とプラン管理画面への導線を描く
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
        <Link to="/settings/plan">{ULTRAS_VIEW_PLAN_LABEL}</Link>
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
      <UltrasPriceLine amount={amount} unavailableReasonId={priceReasonId} />
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

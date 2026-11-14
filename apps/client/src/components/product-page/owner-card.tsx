import { useQuery } from '@tanstack/react-query';
import { InfoIcon, PencilIcon, RocketIcon } from 'lucide-react';
import { type ComponentType, type ReactNode, useId } from 'react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Card } from '../../../lib/components/ui/card/card.tsx';
import { CardAction } from '../../../lib/components/ui/card/card-action.tsx';
import { CardContent } from '../../../lib/components/ui/card/card-content.tsx';
import { CardFooter } from '../../../lib/components/ui/card/card-footer.tsx';
import { CardHeader } from '../../../lib/components/ui/card/card-header.tsx';
import { CardTitle } from '../../../lib/components/ui/card/card-title.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  productOwnerStatusQueryOptions,
  toOwnerLaunchPlan,
} from '../../graphql/product-page.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { CONTACT_HREF, myProductEditHref } from '../layout/site-links.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import {
  EARLIEST_LAUNCH_DATE_NOTICE,
  RELEASE_PREFIX,
} from '../product/launch-messages.ts';
import { EDIT_PRODUCT_LABEL } from '../product/my-product-messages.ts';
import { changeLockReasonOf } from '../product/product-edit-state.ts';
import { RemainingDateTime } from '../product/remaining-date-time.tsx';
import {
  OWNER_CARD_TITLE,
  OWNER_ONLY_BADGE,
  OWNER_STATUS_UNCONFIRMED,
  RELAUNCH_LABEL,
} from './owner-card-messages.ts';
import {
  type RelaunchReservation,
  relaunchReservationOf,
} from './owner-card-model.ts';
import { orderProductOwnerActions } from './product-page-section-order.ts';
import type {
  ProductOwnerAction,
  ProductPageContext,
} from './product-page-section-types.ts';

export interface OwnerCardProps extends ProductPageContext {
  // 投稿者本人向けの操作の登録口(PRODUCT_OWNER_ACTIONS)
  readonly ownerActions: readonly ProductOwnerAction[];
}

// 操作が描けた間(目印の要素がある間)は境界の枠をdisplay:contentsにし、何も描かない操作の枠と間隔を残さない。
// display:contentsの要素はフォーカスできないため、再試行の後に枠へフォーカスを移す読み込み中と失敗の間は通常の箱のまま残す
const OWNER_ACTION_SLOT_CLASS =
  'has-[>[data-product-owner-action-rendered]]:contents';

const NOTE_CLASS = 'flex gap-1.5 text-xs text-muted-foreground';

const NOTE_ICON = (
  <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
);

// 「再ローンチを予約」に併記する文。併記するものが無ければnull
const reservationNoteOf = (reservation: RelaunchReservation): ReactNode => {
  switch (reservation.kind) {
    case 'checking':
      return null;
    case 'unconfirmed':
      return <p>{OWNER_STATUS_UNCONFIRMED}</p>;
    case 'blocked':
      return reservation.blocks.length === 0
        ? null
        : reservation.blocks.map(({ code, message, releaseAt }) => (
            <div key={code}>
              <p>{message}</p>
              {releaseAt !== null && (
                <p>
                  {RELEASE_PREFIX}
                  <RemainingDateTime at={releaseAt} />
                </p>
              )}
            </div>
          ));
    case 'available':
      return reservation.earliestLaunchDate === null ? null : (
        <p>
          {EARLIEST_LAUNCH_DATE_NOTICE.before}
          <LaunchDateText date={reservation.earliestLaunchDate} />
          {EARLIEST_LAUNCH_DATE_NOTICE.after}
        </p>
      );
  }
};

// 投稿者本人にだけ、直近のローンチの結果の要約と編集・次回のローンチの予約への導線を描く。予約と編集の可否は保存の時点にproduct-launchが判定し直すため、ここの判定は案内に留める
export function OwnerCard({
  product,
  viewer,
  page,
  ownerActions,
}: OwnerCardProps) {
  const titleId = useId();
  const noteId = useId();
  const signedInViewer = useViewer();
  const { data, isError } = useQuery({
    ...productOwnerStatusQueryOptions(signedInViewer, product.handle),
    enabled: viewer.isOwner,
  });
  if (!viewer.isOwner) {
    return null;
  }

  const plan =
    data === undefined
      ? isError
        ? null
        : undefined
      : (toOwnerLaunchPlan(data) ?? null);
  const reservation = relaunchReservationOf(plan);
  const note = reservationNoteOf(reservation);
  // 予約の状態を確かめられない旨と似た文が並ぶため、その間は固定の判定の失敗の文を出さず、判定できた固定の注記だけを添える
  const lockReason =
    plan === null || plan === undefined
      ? undefined
      : changeLockReasonOf(
          reservation.kind === 'unconfirmed'
            ? { ...plan, lockUnknown: false }
            : plan,
        );
  const headline = page.launches[0]?.summary.label;
  const actions = orderProductOwnerActions(ownerActions);
  const actionContext = { product, viewer };
  const describedBy = note === null ? undefined : noteId;
  const editHref = myProductEditHref(product.handle);

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="gap-4 border-2 border-dashed border-primary/40 bg-primary/5 py-5 shadow-none"
    >
      <CardHeader className="px-5">
        <CardTitle>
          <h2 id={titleId} className="text-sm font-extrabold">
            {OWNER_CARD_TITLE}
          </h2>
        </CardTitle>
        <CardAction>
          <Badge variant="outline" className="bg-card font-normal">
            {OWNER_ONLY_BADGE}
          </Badge>
        </CardAction>
      </CardHeader>
      {(headline !== undefined || actions.length > 0) && (
        <CardContent className="flex flex-col gap-3 px-5">
          {headline !== undefined && (
            <p className="text-base font-extrabold">{headline}</p>
          )}
          {actions.map(({ id, component: Action }) => (
            <RecoverableSlot
              key={id}
              className={OWNER_ACTION_SLOT_CLASS}
              contactAvailable={CLIENT_PROFILE.contactAvailable}
              contactHref={CONTACT_HREF}
            >
              <Action {...actionContext} />
              <span hidden data-product-owner-action-rendered="" />
            </RecoverableSlot>
          ))}
        </CardContent>
      )}
      <CardFooter className="flex-col items-stretch gap-2 px-5">
        <div className="flex flex-wrap gap-2 [&>*:last-child]:flex-1">
          <Button asChild variant="outline" className="bg-card">
            <PathLink href={editHref}>
              <PencilIcon aria-hidden="true" />
              {EDIT_PRODUCT_LABEL}
            </PathLink>
          </Button>
          {reservation.kind === 'available' ? (
            <Button asChild>
              <PathLink href={editHref} aria-describedby={describedBy}>
                <RocketIcon aria-hidden="true" />
                {RELAUNCH_LABEL}
              </PathLink>
            </Button>
          ) : (
            <Button type="button" disabled aria-describedby={describedBy}>
              <RocketIcon aria-hidden="true" />
              {RELAUNCH_LABEL}
            </Button>
          )}
        </div>
        {note !== null && (
          <div className={NOTE_CLASS}>
            {NOTE_ICON}
            <div id={noteId} className="flex flex-col gap-1">
              {note}
            </div>
          </div>
        )}
        {lockReason !== undefined && (
          <p className={NOTE_CLASS}>
            {NOTE_ICON}
            {lockReason}
          </p>
        )}
      </CardFooter>
    </Card>
  );
}

// 登録口と区画の部品が互いを読み込むと循環するため、登録する側が投稿者本人向けの操作の登録口を渡して区画の部品を作る
export const ownerCardSectionOf = (
  ownerActions: readonly ProductOwnerAction[],
): ComponentType<ProductPageContext> =>
  function OwnerCardWithOwnerActions(context: ProductPageContext) {
    return <OwnerCard {...context} ownerActions={ownerActions} />;
  };

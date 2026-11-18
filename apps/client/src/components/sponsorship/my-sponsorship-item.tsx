import { useRef } from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { SPONSORSHIP_TIER_LABELS } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { formatBusinessDateLabel } from '../../../common-lib/time/business-date-label.ts';
import type {
  ClientMySponsorshipsQuery,
  SponsorshipRefundStatus,
} from '../../graphql/generated/graphql.ts';
import {
  toSponsorshipStatus,
  toSponsorshipTier,
} from '../../graphql/sponsorship.ts';
import { CONTACT_HREF, productDetailHref } from '../layout/site-links.ts';
import { useCurrentYear } from '../product/use-current-year.ts';
import { ResumeCheckoutButton } from './resume-checkout-button.tsx';
import { SponsorLabel } from './sponsor-label.tsx';
import {
  MY_SPONSORSHIP_ITEM_LABELS,
  SPONSORED_PRODUCT_DELETED_NAME,
  SPONSORSHIP_PAUSED_NOTICE,
  SPONSORSHIP_REFUND_REJECTED_MESSAGE_PARTS,
  SPONSORSHIP_REFUND_REMAINING_AMOUNT_LABEL,
  SPONSORSHIP_TERMINATED_ON_LABEL,
  SPONSORSHIP_TERMINATION_REASON_LABEL,
  SPONSORSHIP_UNPAID_AMOUNT_TEXT,
  type SponsorshipRefundKind,
  sponsorshipRefundedMessage,
  sponsorshipRefundRequestedParts,
} from './sponsorship-messages.ts';
import { SponsorshipPeriodText } from './sponsorship-period-text.tsx';
import { SponsorshipStatusBadge } from './sponsorship-status-badge.tsx';

export type MySponsorship =
  ClientMySponsorshipsQuery['mySponsorships']['nodes'][number];

type SponsorshipRefund = NonNullable<MySponsorship['terminationRefund']>;

export interface MySponsorshipItemProps {
  readonly sponsorship: MySponsorship;
  // 申込の状態が表示から変わっていた時に、一覧を取り直す
  readonly onStale: () => void;
}

const REFUND_STATUSES_SHOWN: ReadonlySet<SponsorshipRefundStatus> = new Set([
  'REQUESTED',
  'ALREADY_REFUNDED',
  'REJECTED',
]);

function RefundNote({
  kind,
  refund,
}: {
  readonly kind: SponsorshipRefundKind;
  readonly refund: SponsorshipRefund;
}) {
  if (refund.status === 'ALREADY_REFUNDED') {
    return <p>{sponsorshipRefundedMessage(kind, refund.days)}</p>;
  }
  if (refund.status === 'REJECTED') {
    const parts = SPONSORSHIP_REFUND_REJECTED_MESSAGE_PARTS;
    return (
      <p>
        {parts.beforeLink}
        <PathLink href={CONTACT_HREF} className={INLINE_LINK_CLASS_NAME}>
          {parts.linkLabel}
        </PathLink>
        {parts.afterLink}
      </p>
    );
  }
  const { beforeAmount, afterAmount } = sponsorshipRefundRequestedParts(
    kind,
    refund.days,
  );
  return (
    <p>
      {beforeAmount}
      {refund.amount === null ? (
        SPONSORSHIP_REFUND_REMAINING_AMOUNT_LABEL
      ) : (
        <MoneyText amount={refund.amount.amount} />
      )}
      {afterAmount}
    </p>
  );
}

function ProductName({
  product,
}: {
  readonly product: MySponsorship['product'];
}) {
  if (product === null) {
    return SPONSORED_PRODUCT_DELETED_NAME;
  }
  if (!product.listed) {
    return product.name;
  }
  return (
    <PathLink
      href={productDetailHref(product.handle)}
      className={INLINE_LINK_CLASS_NAME}
    >
      {product.name}
    </PathLink>
  );
}

const refundsOf = (
  sponsorship: MySponsorship,
): readonly (readonly [SponsorshipRefundKind, SponsorshipRefund])[] =>
  (
    [
      ['termination', sponsorship.terminationRefund],
      ['display_stop', sponsorship.displayStopRefund],
    ] as const
  ).flatMap(([kind, refund]) =>
    refund !== null && REFUND_STATUSES_SHOWN.has(refund.status)
      ? [[kind, refund] as const]
      : [],
  );

export function MySponsorshipItem({
  sponsorship,
  onStale,
}: MySponsorshipItemProps) {
  const itemRef = useRef<HTMLLIElement>(null);
  const currentYear = useCurrentYear();
  const { product } = sponsorship;
  const tier = toSponsorshipTier(sponsorship.tier);
  const status = toSponsorshipStatus(sponsorship.status);
  const refunds = refundsOf(sponsorship);

  return (
    // 続きを読み込んだ後と、決済へ進むのボタンが消える前に、項目へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする
    <li
      ref={itemRef}
      tabIndex={-1}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground sm:flex-row sm:items-start sm:p-5"
    >
      <MediaPicture
        image={product?.logo ?? null}
        display={{ kind: 'square', size: 64 }}
        alt=""
        placeholder={{
          label: product?.name ?? SPONSORED_PRODUCT_DELETED_NAME,
          seed: product?.handle ?? sponsorship.id,
        }}
        loading="lazy"
        className="size-16 shrink-0 rounded-lg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-bold wrap-anywhere">
            <ProductName product={product} />
          </h2>
          <p className="flex items-center gap-2 text-sm">
            <SponsorLabel tier={tier} />
            <span translate="no">{SPONSORSHIP_TIER_LABELS[tier]}</span>
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">
            {MY_SPONSORSHIP_ITEM_LABELS.period}
          </dt>
          <dd>
            <SponsorshipPeriodText
              startsOn={sponsorship.startsOn}
              endsOn={sponsorship.endsOn}
            />
          </dd>
          <dt className="text-muted-foreground">
            {MY_SPONSORSHIP_ITEM_LABELS.amountPaid}
          </dt>
          <dd className="tabular-nums">
            {sponsorship.amountPaid === null ? (
              SPONSORSHIP_UNPAID_AMOUNT_TEXT
            ) : (
              <MoneyText amount={sponsorship.amountPaid.amount} />
            )}
          </dd>
          <dt className="text-muted-foreground">
            {MY_SPONSORSHIP_ITEM_LABELS.status}
          </dt>
          <dd>
            <SponsorshipStatusBadge status={status} />
          </dd>
          {sponsorship.terminatedOn === null ? null : (
            <>
              <dt className="text-muted-foreground">
                {SPONSORSHIP_TERMINATED_ON_LABEL}
              </dt>
              <dd>
                <time dateTime={sponsorship.terminatedOn}>
                  {formatBusinessDateLabel(
                    sponsorship.terminatedOn,
                    currentYear,
                  )}
                </time>
              </dd>
            </>
          )}
          {sponsorship.terminationReason === null ? null : (
            <>
              <dt className="text-muted-foreground">
                {SPONSORSHIP_TERMINATION_REASON_LABEL}
              </dt>
              <dd className="wrap-anywhere whitespace-pre-line">
                {sponsorship.terminationReason}
              </dd>
            </>
          )}
        </dl>
        {status === 'paused' ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {SPONSORSHIP_PAUSED_NOTICE}
          </p>
        ) : null}
        {refunds.length === 0 ? null : (
          <div className="flex flex-col gap-1 text-sm">
            {refunds.map(([kind, refund]) => (
              <RefundNote key={kind} kind={kind} refund={refund} />
            ))}
          </div>
        )}
        {sponsorship.canResume ? (
          <ResumeCheckoutButton
            sponsorshipId={sponsorship.id}
            onStale={() => {
              itemRef.current?.focus();
              onStale();
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

import { PAYMENT_CURRENCY } from '../../../../../common-lib/payments/money.ts';
import type { SponsorshipDateWindow as SponsorshipDateWindowRecord } from '../../../../../common-lib/sponsorship/sponsorship-period.ts';
import type { SponsorshipStatus as SponsorshipStatusRecord } from '../../../../../common-lib/sponsorship/sponsorship-status.ts';
import type { SponsorshipTier as SponsorshipTierRecord } from '../../../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { checkExternalUrl } from '../../../../../common-lib/url/external-url.ts';
import type {
  EligibleProduct,
  PlacedAd,
  SponsorshipRefundRecord,
} from '../../../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../../../lib/core/time/business-time.ts';
import type { SponsorshipView } from '../../../../application/sponsorship/sponsorship-view.ts';
import type {
  Money,
  MySponsorship,
  Resolvers,
  SponsorshipDateWindow,
  SponsorshipRefund,
  SponsorshipRefundStatus,
  SponsorshipStatus,
  SponsorshipTier,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { type MediaImageModel, toMediaImage } from '../media/mappers.ts';

export interface SponsorableProductModel {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly logoFileId: string;
}

export interface SponsoredAdModel {
  readonly id: string;
  readonly tier: SponsorshipTier;
  readonly productName: string;
  readonly tagline: string | null;
  readonly logoFileId: string;
  readonly websiteUrl: string | null;
}

export interface SponsorshipProductModel {
  readonly handle: string;
  readonly name: string;
  readonly logoFileId: string;
  readonly listed: boolean;
}

export const TIER_VALUES = Object.freeze({
  legend: 'LEGEND',
  gold: 'GOLD',
  silver: 'SILVER',
} as const satisfies Record<SponsorshipTierRecord, SponsorshipTier>);

const STATUS_VALUES = Object.freeze({
  pending_payment: 'PENDING_PAYMENT',
  scheduled: 'SCHEDULED',
  active: 'ACTIVE',
  paused: 'PAUSED',
  ended: 'ENDED',
  terminated: 'TERMINATED',
} as const satisfies Record<SponsorshipStatusRecord, SponsorshipStatus>);

// 依頼していない(none)・返金不要(not_needed)は利用者へ示す返金が無い
const REFUND_STATUS_VALUES: Readonly<
  Partial<Record<SponsorshipRefundRecord['status'], SponsorshipRefundStatus>>
> = Object.freeze({
  requested: 'REQUESTED',
  already_refunded: 'ALREADY_REFUNDED',
  rejected: 'REJECTED',
});

export const toMoney = (amount: number): Money => ({
  amount,
  currency: PAYMENT_CURRENCY,
});

export const toDateWindow = (
  window: SponsorshipDateWindowRecord,
): SponsorshipDateWindow => ({
  earliest: window.earliest,
  latest: window.latest,
  unavailable: window.unavailable.map(({ from, to }) => ({
    from,
    to,
    reason: 'OVERLAP',
  })),
});

export const toSponsorableProduct = (
  product: EligibleProduct,
): SponsorableProductModel => ({
  id: product.productId,
  handle: product.handle,
  name: product.name,
  logoFileId: product.logoFileId,
});

// 保存の後に検証の規則が変わっても危険なリンクを出さないよう、表示の時点で検証の済まないURLを空にする
const verifiedWebsiteUrl = (value: string): string | null =>
  checkExternalUrl(value) === 'ok' ? value : null;

export const toSponsoredAd = (ad: PlacedAd): SponsoredAdModel => ({
  id: ad.sponsorshipId,
  tier: TIER_VALUES[ad.tier],
  productName: ad.product.name,
  tagline: ad.tier === 'silver' ? null : ad.product.tagline,
  logoFileId: ad.product.logoFileId,
  websiteUrl: verifiedWebsiteUrl(ad.product.websiteUrl),
});

const toRefund = (
  refund: SponsorshipRefundRecord,
): SponsorshipRefund | null => {
  const status = REFUND_STATUS_VALUES[refund.status];
  if (status === undefined) {
    return null;
  }
  return {
    days: refund.days ?? 0,
    amount: refund.amount === null ? null : toMoney(refund.amount),
    status,
  };
};

export type MySponsorshipModel = Omit<MySponsorship, 'product'> & {
  readonly product: SponsorshipProductModel | null;
};

export const toMySponsorship = (
  { record, product, status }: SponsorshipView,
  today: BusinessDate,
): MySponsorshipModel => ({
  id: record.id,
  product:
    product === undefined
      ? null
      : {
          handle: product.handle,
          name: product.name,
          logoFileId: product.logoFileId,
          listed: product.listed,
        },
  tier: TIER_VALUES[record.tier],
  startsOn: record.startsOn,
  endsOn: record.endsOn,
  days: record.days,
  amountPaid: record.amountTotal === null ? null : toMoney(record.amountTotal),
  status: STATUS_VALUES[status],
  terminatedOn:
    record.terminatedAt === null
      ? null
      : toBusinessDateTime(record.terminatedAt).date,
  terminationReason: record.terminationReason,
  terminationRefund: toRefund(record.terminationRefund),
  displayStopRefund: toRefund(record.stopRefund),
  canResume: status === 'pending_payment' && record.startsOn >= today,
  createdAt: record.createdAt,
});

// 一覧の各行で要求されるため、画像の記録は一括読み込みで1回の照会にまとめる。記録が無い画像はnullにする
async function logoOf(
  { logoFileId }: { readonly logoFileId: string },
  _args: unknown,
  context: GraphQLContext,
): Promise<MediaImageModel | null> {
  const file = await context.loaders.get(mediaFileLoader).load(logoFileId);
  return file === null ? null : toMediaImage(file);
}

export const sponsorshipViewResolvers = {
  SponsorableProduct: { logo: logoOf },
  SponsoredAd: { logo: logoOf },
  SponsorshipProduct: { logo: logoOf },
} satisfies Resolvers;

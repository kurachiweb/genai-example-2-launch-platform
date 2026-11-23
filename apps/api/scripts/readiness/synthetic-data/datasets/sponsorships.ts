import { paymentPurchases } from '../../../../db/schema/payments/payment-purchases.ts';
import { sponsorships } from '../../../../db/schema/sponsorship/sponsorships.ts';
import {
  SPONSORSHIP_PRICE_LOOKUP_KEYS,
  SPONSORSHIP_TIER_LABELS,
  type SponsorshipTier,
} from '../../../../common-lib/sponsorship/sponsorship-tiers.ts';
import {
  addBusinessDays,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import { productAt, type EntityContext } from '../entities.ts';
import { deterministicUlid } from '../random.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import {
  insertStatements,
  type DatasetContext,
  type DatasetSamples,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';

export interface PlannedSponsorship {
  readonly id: string;
  readonly purchaseId: string;
  readonly paymentRecordId: string;
  readonly productIndex: number;
  readonly productId: string;
  readonly handle: string;
  readonly ownerUserId: string;
  readonly tier: SponsorshipTier;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly unitAmount: number;
  readonly amountTotal: number;
  readonly paidAt: Date;
}

// 単価(セント)。広告の購入のE2Eの補助と同じ値で、ローカルでは価格をStripeへ照会しないため購入の行へ写す
const DAILY_UNIT_AMOUNTS: Readonly<Record<SponsorshipTier, number>> =
  Object.freeze({ legend: 2_000, gold: 800, silver: 300 });

const SAMPLE_COUNT = 5;

// 作り手(番号0)と対戦相手(番号1)の次の番号から広告を付ける
const FIRST_SPONSORED_OFFSET = 2;

const LEGEND_PERIOD = 20;

const GOLD_PERIOD = 5;

// 開始は基準日の0〜29日前、終了は基準日の7〜89日後にして、基準日からの1週間は全ての広告が掲載中になる
const START_SPREAD_DAYS = 30;

const MIN_REMAINING_DAYS = 7;

const END_SPREAD_DAYS = 83;

const END_SPREAD_MULTIPLIER = 13;

const HOUR_MS = 3_600_000;

const DAY_MS = 86_400_000;

const PAID_LEAD_MS = DAY_MS;

const REFLECT_DELAY_MS = 5_000;

const CHECKOUT_LIFETIME_MS = 24 * HOUR_MS;

const entityContextOf = (
  profile: ScaleProfile,
  context: DatasetContext,
): EntityContext => ({
  seed: context.seed,
  baseDate: context.baseDate,
  profile,
  ...(context.logoFileId === undefined
    ? {}
    : { logoFileId: context.logoFileId }),
});

function tierOf(index: number): SponsorshipTier {
  if (index % LEGEND_PERIOD === 0) {
    return 'legend';
  }
  return index % GOLD_PERIOD === 0 ? 'gold' : 'silver';
}

// 広告を付けるプロダクトを等間隔に選び、1プロダクトに1件だけにする
function sponsoredStride(profile: ScaleProfile): number {
  const stride = Math.floor(profile.products / profile.activeSponsorships);
  if (
    stride < 1 ||
    (profile.activeSponsorships - 1) * stride + FIRST_SPONSORED_OFFSET >=
      profile.products
  ) {
    throw new RangeError(
      `プロダクトの数(${String(profile.products)})が、広告(${String(profile.activeSponsorships)}件)を1プロダクトに1件ずつ付けるには足りません`,
    );
  }
  return stride;
}

export function* sponsorshipPlansOf(
  entities: EntityContext,
): Generator<PlannedSponsorship> {
  const { profile, seed, baseDate } = entities;
  const stride = sponsoredStride(profile);
  const base = parseBusinessDate(baseDate);
  for (let index = 0; index < profile.activeSponsorships; index += 1) {
    const product = productAt(
      entities,
      index * stride + FIRST_SPONSORED_OFFSET,
    );
    const tier = tierOf(index);
    const startsOn = addBusinessDays(base, -(index % START_SPREAD_DAYS));
    const endsOn = addBusinessDays(
      base,
      MIN_REMAINING_DAYS + ((index * END_SPREAD_MULTIPLIER) % END_SPREAD_DAYS),
    );
    const days =
      Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / DAY_MS) + 1;
    const paidAt = new Date(
      fromBusinessDateTime(startsOn, { hour: 0, minute: 0 }).getTime() -
        PAID_LEAD_MS,
    );
    const key = `${String(seed)}:sponsorship:${String(index)}`;
    const unitAmount = DAILY_UNIT_AMOUNTS[tier];
    yield {
      id: deterministicUlid(paidAt, key),
      purchaseId: deterministicUlid(paidAt, `${key}:purchase`),
      paymentRecordId: deterministicUlid(paidAt, `${key}:record`),
      productIndex: index * stride + FIRST_SPONSORED_OFFSET,
      productId: product.id,
      handle: product.handle,
      ownerUserId: product.ownerId,
      tier,
      startsOn,
      endsOn,
      days,
      unitAmount,
      amountTotal: unitAmount * days,
      paidAt,
    };
  }
}

function sponsorshipRow(plan: PlannedSponsorship): SqlRow {
  const createdAt = new Date(plan.paidAt.getTime() - HOUR_MS);
  return {
    id: plan.id,
    userId: plan.ownerUserId,
    productId: plan.productId,
    tier: plan.tier,
    startsOn: plan.startsOn,
    endsOn: plan.endsOn,
    days: plan.days,
    state: 'paid',
    purchaseId: plan.purchaseId,
    paymentRecordId: plan.paymentRecordId,
    amountTotal: plan.amountTotal,
    paidAt: plan.paidAt,
    startNotice: 'requested',
    createdAt,
    updatedAt: plan.paidAt,
  };
}

// 確認メールを送らせないため、確認メールの状態はskippedにする。決済の記録の表は作らない
function purchaseRow(plan: PlannedSponsorship): SqlRow {
  const createdAt = new Date(plan.paidAt.getTime() - HOUR_MS);
  return {
    id: plan.purchaseId,
    userId: plan.ownerUserId,
    kind: 'sponsorship',
    targetId: plan.id,
    relatedId: plan.id,
    exclusivityKey: `sponsorship:${plan.id}`,
    status: 'fulfilled',
    stateToken: `synthetic-sponsorship-${plan.id}`,
    priceLookupKey: SPONSORSHIP_PRICE_LOOKUP_KEYS[plan.tier],
    stripePriceId: `price_synthetic_sponsorship_${plan.tier}`,
    unitAmount: plan.unitAmount,
    quantity: plan.days,
    amountTotal: plan.amountTotal,
    summaryJson: JSON.stringify({
      itemName: `スポンサー広告(${SPONSORSHIP_TIER_LABELS[plan.tier]})`,
      quantityLabel: `${String(plan.days)}日間`,
      serviceTiming: '選んだ掲載期間',
      additionalNotes: [],
    }),
    expiresAt: new Date(createdAt.getTime() + CHECKOUT_LIFETIME_MS),
    stripeCheckoutSessionId: `cs_synthetic_${plan.id}`,
    stripePaymentIntentId: `pi_synthetic_${plan.id}`,
    paidAt: plan.paidAt,
    reflectedAt: new Date(plan.paidAt.getTime() + REFLECT_DELAY_MS),
    confirmationEmailStatus: 'skipped',
    lastEventAt: plan.paidAt,
    createdAt,
    updatedAt: plan.paidAt,
  };
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  const plans = [...sponsorshipPlansOf(entities)];
  yield* insertStatements(sponsorships, plans.map(sponsorshipRow));
  yield* insertStatements(paymentPurchases, plans.map(purchaseRow));
}

function samples(
  profile: ScaleProfile,
  context: DatasetContext,
): DatasetSamples {
  const handles: string[] = [];
  for (const plan of sponsorshipPlansOf(entityContextOf(profile, context))) {
    handles.push(plan.handle);
    if (handles.length === SAMPLE_COUNT) {
      break;
    }
  }
  return { sponsoredProductHandles: handles };
}

export const sponsorshipsDataset: SyntheticDataset = {
  name: 'sponsorships',
  dependsOn: ['users', 'products'],
  generate,
  samples,
};

import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import {
  SPONSORSHIP_PRICE_LOOKUP_KEYS,
  SPONSORSHIP_TIER_LABELS,
  type SponsorshipTier,
} from '../../apps/common-lib/sponsorship/sponsorship-tiers.ts';
import type { LocalD1Row } from './local-d1-command.ts';

export interface SponsorProduct {
  readonly productId: string;
  readonly ownerUserId: string;
  // キックオフ済みにする未確定のローンチ
  readonly launchId: string;
}

export interface LaunchKickOff {
  readonly launchDate: string;
  readonly today: string;
  readonly now: Date;
}

export interface PaidSponsorshipInput {
  readonly product: Pick<SponsorProduct, 'productId' | 'ownerUserId'>;
  readonly tier: SponsorshipTier;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly now: Date;
  readonly nextId: () => string;
}

export interface PaidSponsorshipPlan {
  readonly sponsorshipId: string;
  readonly purchaseId: string;
  readonly paymentRecordId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly tier: SponsorshipTier;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly unitAmount: number;
  readonly amountTotal: number;
  readonly now: Date;
}

// 料金表の1日あたりの税込の単価(セント)。ローカルでは価格をStripeへ照会しないため、購入の行にはこの値を写す
export const FIXTURE_DAILY_UNIT_AMOUNTS: Readonly<
  Record<SponsorshipTier, number>
> = Object.freeze({
  legend: 2_000,
  gold: 800,
  silver: 300,
});

const MILLISECONDS_PER_DAY = 86_400_000;

const MIN_DAYS = 1;

const MAX_DAYS = 366;

const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `SQLの整数のリテラルにできない値です: ${String(value)}`,
    );
  }
  return String(value);
};

const timeLiteral = (at: Date): string => integerLiteral(at.getTime());

// 単体テストのカバレッジが読み込んだ他のアプリのファイルを分母に数えるため、日付の規則のモジュールを読まずに暦日として検証する
function utcMidnightOf(date: string): number {
  const groups = BUSINESS_DATE_PATTERN.exec(date)?.groups;
  const time =
    groups === undefined
      ? Number.NaN
      : Date.UTC(
          Number(groups.year),
          Number(groups.month) - 1,
          Number(groups.day),
        );
  if (
    Number.isNaN(time) ||
    new Date(time).toISOString().slice(0, 10) !== date
  ) {
    throw new RangeError(
      `業務日付はYYYY-MM-DDの実在する日付で指定してください: ${date}`,
    );
  }
  return time;
}

export function sponsorProductSql(productHandle: string): string {
  return `SELECT p.id AS product_id, p.user_id AS owner_user_id, l.id AS launch_id FROM products p JOIN product_launches l ON l.product_id = p.id AND l.outcome IS NULL AND l.cancelled_at IS NULL WHERE p.handle = ${sqlStringLiteral(productHandle)} AND p.deleted_at IS NULL;`;
}

export function parseSponsorProduct(
  rows: readonly LocalD1Row[],
  productHandle: string,
): SponsorProduct {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(
      `プロダクト(${productHandle})の未確定のローンチが見つかりません。画面で登録したプロダクトのハンドルを指定してください`,
    );
  }
  const { product_id: productId, owner_user_id: ownerUserId } = row;
  const { launch_id: launchId } = row;
  if (
    rows.length !== 1 ||
    typeof productId !== 'string' ||
    typeof ownerUserId !== 'string' ||
    typeof launchId !== 'string'
  ) {
    throw new Error(
      `プロダクトの照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  }
  return { productId, ownerUserId, launchId };
}

// 画面ではローンチ日に過去の日を選べないため、未確定のローンチのローンチ日を過去へ移し、ローンチの状態をマッチ中(キックオフ済み)にする。
// 過去の日付のローンチは前日の23:45の組み合わせにも当日の0:00の開始にも選ばれず、マッチを持たないまま残る
export function launchKickOffSql(
  product: SponsorProduct,
  { launchDate, today, now }: LaunchKickOff,
): string {
  if (utcMidnightOf(launchDate) >= utcMidnightOf(today)) {
    throw new RangeError(
      `キックオフ済みにするローンチ日は今日(${today})より前の日付で指定してください: ${launchDate}`,
    );
  }
  const date = sqlStringLiteral(launchDate);
  const at = timeLiteral(now);
  const launchId = sqlStringLiteral(product.launchId);
  const productId = sqlStringLiteral(product.productId);
  return [
    `UPDATE product_launches SET launch_date = ${date}, updated_at = ${at} WHERE id = ${launchId} AND product_id = ${productId} AND outcome IS NULL AND cancelled_at IS NULL RETURNING id;`,
    `UPDATE products SET latest_launch_date = ${date} WHERE id = ${productId} AND EXISTS (SELECT 1 FROM product_launches WHERE id = ${launchId} AND launch_date = ${date} AND outcome IS NULL AND cancelled_at IS NULL);`,
  ].join('\n');
}

export function parseLaunchKickOff(
  rows: readonly LocalD1Row[],
  product: SponsorProduct,
): void {
  if (rows.length !== 1 || rows[0]?.id !== product.launchId) {
    throw new Error(
      `プロダクト(${product.productId})の未確定のローンチ(${product.launchId})のローンチ日を書き換えられませんでした: ${JSON.stringify(rows)}`,
    );
  }
}

export function planPaidSponsorship({
  product,
  tier,
  startsOn,
  endsOn,
  now,
  nextId,
}: PaidSponsorshipInput): PaidSponsorshipPlan {
  const days =
    (utcMidnightOf(endsOn) - utcMidnightOf(startsOn)) / MILLISECONDS_PER_DAY +
    1;
  if (days < MIN_DAYS || days > MAX_DAYS) {
    throw new RangeError(
      `掲載期間は開始日から${String(MIN_DAYS)}〜${String(MAX_DAYS)}日の範囲で指定してください: ${startsOn}〜${endsOn}`,
    );
  }
  const unitAmount = FIXTURE_DAILY_UNIT_AMOUNTS[tier];
  return {
    sponsorshipId: nextId(),
    purchaseId: nextId(),
    paymentRecordId: nextId(),
    productId: product.productId,
    ownerUserId: product.ownerUserId,
    tier,
    startsOn,
    endsOn,
    days,
    unitAmount,
    amountTotal: unitAmount * days,
    now,
  };
}

// 決済の反映を終えた形の申込と購入の行を、テストのためだけに直接作る。掲載開始の通知は依頼前(none)にし、0:07のジョブで送らせる。
// 同じプロダクト・ティアの決済済みの申込と期間が重なれば申込を作らず、申込が無ければ購入も作らない
export function paidSponsorshipInsertSql(plan: PaidSponsorshipPlan): string {
  const sponsorshipId = sqlStringLiteral(plan.sponsorshipId);
  const purchaseId = sqlStringLiteral(plan.purchaseId);
  const productId = sqlStringLiteral(plan.productId);
  const ownerUserId = sqlStringLiteral(plan.ownerUserId);
  const tier = sqlStringLiteral(plan.tier);
  const startsOn = sqlStringLiteral(plan.startsOn);
  const endsOn = sqlStringLiteral(plan.endsOn);
  const at = timeLiteral(plan.now);
  const summary = JSON.stringify({
    itemName: `スポンサー広告(${SPONSORSHIP_TIER_LABELS[plan.tier]})`,
    quantityLabel: `${String(plan.days)}日間`,
    serviceTiming: '選んだ掲載期間',
    additionalNotes: [],
  });
  return [
    `INSERT INTO sponsorships (id, user_id, product_id, tier, starts_on, ends_on, days, state, purchase_id, payment_record_id, amount_total, paid_at, created_at, updated_at) SELECT ${[
      sponsorshipId,
      ownerUserId,
      productId,
      tier,
      startsOn,
      endsOn,
      integerLiteral(plan.days),
      sqlStringLiteral('paid'),
      purchaseId,
      sqlStringLiteral(plan.paymentRecordId),
      integerLiteral(plan.amountTotal),
      at,
      at,
      at,
    ].join(
      ', ',
    )} WHERE NOT EXISTS (SELECT 1 FROM sponsorships WHERE product_id = ${productId} AND tier = ${tier} AND state = 'paid' AND deleted_at IS NULL AND starts_on <= ${endsOn} AND ends_on >= ${startsOn}) RETURNING id;`,
    `INSERT INTO payment_purchases (id, user_id, kind, target_id, related_id, exclusivity_key, status, state_token, price_lookup_key, stripe_price_id, unit_amount, quantity, amount_total, summary_json, expires_at, stripe_checkout_session_id, stripe_payment_intent_id, paid_at, reflected_at, last_event_at, created_at, updated_at) SELECT ${[
      purchaseId,
      ownerUserId,
      sqlStringLiteral('sponsorship'),
      sponsorshipId,
      sponsorshipId,
      sqlStringLiteral(`sponsorship:${plan.sponsorshipId}`),
      sqlStringLiteral('fulfilled'),
      sqlStringLiteral(`e2e-sponsorship-${plan.sponsorshipId}`),
      sqlStringLiteral(SPONSORSHIP_PRICE_LOOKUP_KEYS[plan.tier]),
      sqlStringLiteral(`price_e2e_sponsorship_${plan.tier}`),
      integerLiteral(plan.unitAmount),
      integerLiteral(plan.days),
      integerLiteral(plan.amountTotal),
      sqlStringLiteral(summary),
      at,
      sqlStringLiteral(`cs_test_e2e_sponsorship_${plan.sponsorshipId}`),
      sqlStringLiteral(`pi_test_e2e_sponsorship_${plan.sponsorshipId}`),
      at,
      at,
      at,
      at,
      at,
    ].join(
      ', ',
    )} WHERE EXISTS (SELECT 1 FROM sponsorships WHERE id = ${sponsorshipId}) RETURNING id;`,
  ].join('\n');
}

export function parsePaidSponsorshipInsert(
  rows: readonly LocalD1Row[],
  plan: PaidSponsorshipPlan,
): void {
  if (
    rows.length !== 2 ||
    rows[0]?.id !== plan.sponsorshipId ||
    rows[1]?.id !== plan.purchaseId
  ) {
    throw new Error(
      `プロダクト(${plan.productId})の${SPONSORSHIP_TIER_LABELS[plan.tier]}の決済済みの申込(${plan.startsOn}〜${plan.endsOn})を作れませんでした。同じプロダクト・ティアの決済済みの申込と期間が重なっていないか確かめてください: ${JSON.stringify(rows)}`,
    );
  }
}

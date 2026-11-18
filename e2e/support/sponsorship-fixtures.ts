import { randomBytes } from 'node:crypto';

import type { SponsorshipTier } from '../../apps/common-lib/sponsorship/sponsorship-tiers.ts';
import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { executeLocalD1 } from './local-d1.ts';
import { addBusinessDays, businessDateOf } from './scheduled-trigger.ts';
import {
  launchKickOffSql,
  paidSponsorshipInsertSql,
  type PaidSponsorshipPlan,
  parseLaunchKickOff,
  parsePaidSponsorshipInsert,
  parseSponsorProduct,
  planPaidSponsorship,
  type SponsorProduct,
  sponsorProductSql,
} from './sponsorship-fixture-sql.ts';

export type { SponsorProduct } from './sponsorship-fixture-sql.ts';

export type PaidSponsorship = PaidSponsorshipPlan;

export interface PaidSponsorshipRequest {
  readonly tier: SponsorshipTier;
  // 省くと今日の業務日付から始める
  readonly startsOn?: string;
  // 省くと開始日から7日間にする
  readonly endsOn?: string;
}

const DEFAULT_DAYS = 7;

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

// 画面で登録したプロダクトの未確定のローンチを、ローンチ日を前日へ移してキックオフ済みにし、スポンサー広告を申し込める状態にする
export async function kickOffProduct(
  productHandle: string,
): Promise<SponsorProduct> {
  const product = parseSponsorProduct(
    await executeLocalD1(sponsorProductSql(productHandle)),
    productHandle,
  );
  const now = new Date();
  const today = businessDateOf(now);
  parseLaunchKickOff(
    await executeLocalD1(
      launchKickOffSql(product, {
        launchDate: addBusinessDays(today, -1),
        today,
        now,
      }),
    ),
    product,
  );
  return product;
}

// 決済を画面で行わずに、指定したティア・期間の決済済みの申込と対応する決済済みの購入の行を作る。掲載開始の通知は0:07のジョブ(triggerScheduled)で送らせる
export async function createPaidSponsorship(
  product: SponsorProduct,
  { tier, startsOn, endsOn }: PaidSponsorshipRequest,
): Promise<PaidSponsorship> {
  const now = new Date();
  const start = startsOn ?? businessDateOf(now);
  const plan = planPaidSponsorship({
    product,
    tier,
    startsOn: start,
    endsOn: endsOn ?? addBusinessDays(start, DEFAULT_DAYS - 1),
    now,
    nextId: nextFixtureId,
  });
  parsePaidSponsorshipInsert(
    await executeLocalD1(paidSponsorshipInsertSql(plan)),
    plan,
  );
  return plan;
}

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { deriveSponsorshipStatus } from '../../../../common-lib/sponsorship/sponsorship-status.ts';
import type { EntityContext } from '../entities.ts';
import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext } from '../sql-writer.ts';
import { productsDataset } from './products.ts';
import { sponsorshipPlansOf, sponsorshipsDataset } from './sponsorships.ts';
import { usersDataset } from './users.ts';

const BASE_DATE = '2026-11-24';

const NEXT_WEEK = '2026-12-01';

const context: DatasetContext = { seed: 1, baseDate: BASE_DATE };

const entities = (profile: EntityContext['profile']): EntityContext => ({
  seed: 1,
  baseDate: BASE_DATE,
  profile,
});

let db: Database;

beforeAll(() => {
  db = createMigratedDatabase();
  for (const dataset of [usersDataset, productsDataset, sponsorshipsDataset]) {
    for (const statement of dataset.generate(SMOKE_PROFILE, context)) {
      db.run(statement.text);
    }
  }
});

afterAll(() => {
  db.close();
});

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

describe('sponsorshipPlansOf(想定規模)', () => {
  const plans = [...sponsorshipPlansOf(entities(YEAR_ONE_PROFILE))];

  test('掲載中の広告を1,000件作り、プロダクトは全て異なる', () => {
    expect(plans).toHaveLength(1_000);
    expect(new Set(plans.map((plan) => plan.productIndex)).size).toBe(1_000);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(1_000);
  });

  test('基準日と1週間後の両方で、上流の判定が掲載中になる', () => {
    const statuses = (today: string): Set<string> =>
      new Set(
        plans.map((plan) =>
          deriveSponsorshipStatus({
            state: 'paid',
            startsOn: plan.startsOn,
            endsOn: plan.endsOn,
            product: 'visible',
            today,
          }),
        ),
      );

    expect(statuses(BASE_DATE)).toEqual(new Set(['active']));
    expect(statuses(NEXT_WEEK)).toEqual(new Set(['active']));
  });

  test('3つのティアを持ち、Legendは少なくSilverが最も多い', () => {
    const count = (tier: string): number =>
      plans.filter((plan) => plan.tier === tier).length;

    expect(count('legend')).toBe(50);
    expect(count('gold')).toBe(150);
    expect(count('silver')).toBe(800);
  });

  test('日数は開始日から終了日までの日数と一致し、1〜366日に収まる', () => {
    const wrong = plans.filter((plan) => {
      const span =
        (Date.parse(plan.endsOn) - Date.parse(plan.startsOn)) / 86_400_000 + 1;
      return span !== plan.days || plan.days < 1 || plan.days > 366;
    });

    expect(wrong).toEqual([]);
  });

  test('支払いの日時は掲載の開始より前で、金額は日数とティアの単価の積である', () => {
    const wrong = plans.filter(
      (plan) =>
        plan.paidAt.getTime() >= Date.parse(`${plan.startsOn}T08:00:00Z`) ||
        plan.amountTotal !== plan.unitAmount * plan.days,
    );

    expect(wrong).toEqual([]);
  });
});

describe('sponsorshipsDataset', () => {
  test('プロダクトのデータセットに依存し、名前はsponsorshipsになる', () => {
    expect(sponsorshipsDataset.name).toBe('sponsorships');
    expect(sponsorshipsDataset.dependsOn).toEqual(['users', 'products']);
  });

  test('想定規模では広告と決済済みの購入を1,000件ずつ作る', () => {
    const counts: Record<string, number> = {};
    for (const statement of sponsorshipsDataset.generate(
      YEAR_ONE_PROFILE,
      context,
    )) {
      counts[statement.table] =
        (counts[statement.table] ?? 0) + statement.insertedRows;
    }

    expect(counts).toEqual({ sponsorships: 1_000, payment_purchases: 1_000 });
  });

  test('検証用の規模では広告1件が、外部キーの違反なく適用できる', () => {
    expect(scalar('SELECT count(*) FROM sponsorships')).toBe(1);
    expect(scalar('SELECT count(*) FROM payment_purchases')).toBe(1);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('広告は決済済みで、プロダクトの投稿者が購入し、通知は開始が送信済み・他は未依頼である', () => {
    expect(
      scalar(
        `SELECT count(*) FROM sponsorships s JOIN products p ON p.id = s.product_id
          WHERE s.state = 'paid' AND s.user_id = p.user_id AND s.deleted_at IS NULL
            AND s.start_notice = 'requested' AND s.end_notice = 'none' AND s.termination_notice = 'none'
            AND s.stop_refund_status = 'none' AND s.termination_refund_status = 'none'
            AND s.purchase_id IS NOT NULL AND s.payment_record_id IS NOT NULL AND s.amount_total IS NOT NULL AND s.paid_at IS NOT NULL`,
      ),
    ).toBe(1);
  });

  test('表示の問い合わせ(上流の設計の条件)が基準日に広告を返す', () => {
    expect(
      scalar(
        `SELECT count(*) FROM sponsorships s JOIN products p ON p.id = s.product_id JOIN users u ON u.id = p.user_id
          WHERE s.state = 'paid' AND s.deleted_at IS NULL AND s.starts_on <= '${BASE_DATE}' AND s.ends_on >= '${BASE_DATE}'
            AND p.hidden_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL`,
      ),
    ).toBe(1);
  });

  test('購入は広告を指す完了済みの行で、金額・数量・ティアの価格のキーが広告と一致し、確認メールを送らない', () => {
    expect(
      scalar(
        `SELECT count(*) FROM payment_purchases pp JOIN sponsorships s ON s.id = pp.target_id
          WHERE pp.kind = 'sponsorship' AND pp.status = 'fulfilled' AND pp.id = s.purchase_id AND pp.user_id = s.user_id
            AND pp.amount_total = s.amount_total AND pp.quantity = s.days AND pp.paid_at = s.paid_at
            AND pp.price_lookup_key = 'sponsorship_' || s.tier || '_daily' AND pp.confirmation_email_status = 'skipped'
            AND pp.exclusivity_key = 'sponsorship:' || s.id`,
      ),
    ).toBe(1);
  });

  test('購入の識別子は合成であることが分かり、実在のStripeの値を含まない', () => {
    expect(
      scalar(
        "SELECT count(*) FROM payment_purchases WHERE stripe_checkout_session_id LIKE 'cs_synthetic_%' AND stripe_payment_intent_id LIKE 'pi_synthetic_%' AND stripe_price_id LIKE 'price_synthetic_%'",
      ),
    ).toBe(1);
  });

  test('同じ種と基準日なら同じ文を出す', () => {
    const texts = (): string[] =>
      [...sponsorshipsDataset.generate(SMOKE_PROFILE, context)].map(
        (statement) => statement.text,
      );

    expect(texts()).toEqual(texts());
  });

  test('広告が足りない配置になるプロダクトの数なら例外にする', () => {
    expect(() => [
      ...sponsorshipPlansOf(
        entities({ ...SMOKE_PROFILE, products: 20, activeSponsorships: 19 }),
      ),
    ]).toThrow(/プロダクトの数/u);
  });

  test('見本として広告が付いたプロダクトのハンドルを返し、実在する', () => {
    const samples = sponsorshipsDataset.samples?.(SMOKE_PROFILE, context);

    expect(samples?.sponsoredProductHandles).toHaveLength(1);
    for (const handle of samples?.sponsoredProductHandles ?? []) {
      expect(
        scalar(
          `SELECT count(*) FROM sponsorships s JOIN products p ON p.id = s.product_id WHERE p.handle = '${handle}'`,
        ),
      ).toBe(1);
    }
  });
});

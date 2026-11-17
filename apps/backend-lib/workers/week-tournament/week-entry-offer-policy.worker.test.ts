import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import type {
  PurchaseOffer,
  PurchaseOfferDecision,
} from '../../core/payments/purchase-kind-contract.ts';
import type { UltrasEntitlements } from '../../core/ultras/ports.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  type WeekEntryFixture,
  WEEK_START,
  WEEK_WINDOW,
} from './testing/week-tournament-fixtures.ts';
import {
  WEEK_ENTRY_OFFER_REJECTION_MESSAGES,
  WeekEntryOfferPolicy,
} from './week-entry-offer-policy.ts';

const OWNER = 1;
const OTHER_USER = 2;

const WON_AT = new Date('2026-11-21T08:00:00.000Z');
const NOW = new Date('2026-11-22T12:00:00.000Z');

interface EntitlementQuery {
  readonly userId: string;
  readonly from: Date;
  readonly to: Date;
}

interface PolicyHarness {
  readonly policy: WeekEntryOfferPolicy;
  readonly queries: EntitlementQuery[];
}

const unused = (): never => {
  throw new Error('この判定は使わない');
};

function createPolicy(entitled = false): PolicyHarness {
  const queries: EntitlementQuery[] = [];
  const entitlements: UltrasEntitlements = {
    isEntitledAt: unused,
    wasEntitledDuring: (userId, from, to) => {
      queries.push({ userId, from, to });
      return Promise.resolve(entitled);
    },
    entitledUsersAt: unused,
    entitledUsersDuring: unused,
    currentPlan: unused,
  };
  return {
    policy: new WeekEntryOfferPolicy(
      new D1WeekTournamentStore(db),
      new D1ProductDirectory(db),
      entitlements,
    ),
    queries,
  };
}

// 投稿者1のプロダクト・ローンチ・参加の枠を同じ番号で作る
async function seedEntry(
  index: number,
  options: {
    readonly entry?: WeekEntryFixture['columns'];
    readonly product?: Parameters<typeof insertProduct>[2];
  } = {},
): Promise<void> {
  await insertProduct(index, OWNER, options.product);
  await insertLaunch(index, index, { launchDate: '2026-11-20' });
  await insertWeekEntries([
    {
      index,
      tournament: 1,
      launch: index,
      product: index,
      owner: OWNER,
      columns: { wonAt: WON_AT, ...options.entry },
    },
  ]);
}

async function freezeWeek(): Promise<void> {
  await db
    .update(weekTournaments)
    .set({ status: 'drawing', drawStartedAt: WEEK_WINDOW.drawAt })
    .where(eq(weekTournaments.weekStart, WEEK_START));
}

function describeAs(
  policy: WeekEntryOfferPolicy,
  input: {
    readonly user?: number;
    readonly launch?: number | null;
    readonly now?: Date;
  } = {},
): Promise<PurchaseOfferDecision> {
  const launch = input.launch === undefined ? 1 : input.launch;
  return policy.describe({
    userId: userIdOf(input.user ?? OWNER),
    targetId: launch === null ? null : launchIdOf(launch),
    now: input.now ?? NOW,
  });
}

function rejectionOf(
  code: keyof typeof WEEK_ENTRY_OFFER_REJECTION_MESSAGES,
): PurchaseOfferDecision {
  return {
    kind: 'unavailable',
    code,
    message: WEEK_ENTRY_OFFER_REJECTION_MESSAGES[code],
  };
}

function offerOf(decision: PurchaseOfferDecision): PurchaseOffer {
  if (decision.kind !== 'available') {
    throw new Error(`購入を受け付けませんでした: ${decision.code}`);
  }
  return decision.offer;
}

beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(OWNER);
  await insertUser(OTHER_USER);
  await insertWeekTournaments([{ index: 1, columns: { createdAt: T0 } }]);
});

describe('WeekEntryOfferPolicy', () => {
  describe('拒否の文言', () => {
    test('文言規則のWeekトーナメントの決済の開始の拒否の文言を持つ', () => {
      expect(WEEK_ENTRY_OFFER_REJECTION_MESSAGES).toStrictEqual({
        week_entry_not_found: 'このWeekトーナメントの参加枠は見つかりません。',
        week_entry_already_entitled:
          'このプロダクトはWeekトーナメントの参加資格を得ています。',
        week_entry_closed: 'Weekトーナメントの参加受付は終了しました。',
        week_entry_product_unavailable:
          'このプロダクトは現在Weekトーナメントに参加できません。',
        week_entry_exempt: 'Ultrasの特典により参加費は免除されます。',
      });
    });
  });

  describe('参加の枠が見つからない', () => {
    test('ローンチに参加の枠が無ければweek_entry_not_foundで拒否する', async () => {
      await insertProduct(1, OWNER);
      await insertLaunch(1, 1, { launchDate: '2026-11-20' });
      const { policy } = createPolicy();

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('week_entry_not_found'),
      );
    });

    test('対象のローンチが指定されなければweek_entry_not_foundで拒否する', async () => {
      await seedEntry(1);
      const { policy } = createPolicy();

      expect(await describeAs(policy, { launch: null })).toStrictEqual(
        rejectionOf('week_entry_not_found'),
      );
    });

    test('投稿者以外の決済の開始はweek_entry_not_foundで拒否する', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy();

      expect(await describeAs(policy, { user: OTHER_USER })).toStrictEqual(
        rejectionOf('week_entry_not_found'),
      );
      expect(queries).toStrictEqual([]);
    });
  });

  describe('参加資格を得た枠', () => {
    test.each([
      { status: 'entitled', entitlementSource: 'ultras' },
      { status: 'drawn', entitlementSource: 'ultras' },
    ] as const)(
      '$statusの枠はweek_entry_already_entitledで拒否する',
      async (columns) => {
        await seedEntry(1, { entry: columns });
        const { policy } = createPolicy();

        expect(await describeAs(policy)).toStrictEqual(
          rejectionOf('week_entry_already_entitled'),
        );
      },
    );
  });

  describe('参加受付の終了', () => {
    test.each([
      { status: 'expired', closeReason: 'deadline' },
      { status: 'expired', closeReason: 'late_entry' },
      { status: 'forfeited', closeReason: 'deleted' },
      { status: 'forfeited', closeReason: 'withdrawn' },
      { status: 'excluded', closeReason: 'hidden_or_suspended' },
    ] as const)(
      '$status($closeReason)の枠はweek_entry_closedで拒否する',
      async (columns) => {
        await seedEntry(1, { entry: columns });
        const { policy } = createPolicy();

        expect(await describeAs(policy)).toStrictEqual(
          rejectionOf('week_entry_closed'),
        );
      },
    );

    test('組み合わせ決定の凍結の後の受付中の枠はweek_entry_closedで拒否する', async () => {
      await seedEntry(1);
      await freezeWeek();
      const { policy, queries } = createPolicy();

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('week_entry_closed'),
      );
      expect(queries).toStrictEqual([]);
    });

    test('凍結の後は表示できないプロダクトの枠もweek_entry_closedで拒否する', async () => {
      await seedEntry(1, { product: { hiddenAt: T0 } });
      await freezeWeek();
      const { policy } = createPolicy();

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('week_entry_closed'),
      );
    });
  });

  describe('表示できないプロダクト', () => {
    test.each([
      { label: '非公開化中', product: { hiddenAt: T0 } },
      { label: '論理削除済み', product: { deletedAt: T0 } },
    ])(
      '$labelのプロダクトの枠はweek_entry_product_unavailableで拒否する',
      async ({ product }) => {
        await seedEntry(1, { product });
        const { policy, queries } = createPolicy();

        expect(await describeAs(policy)).toStrictEqual(
          rejectionOf('week_entry_product_unavailable'),
        );
        expect(queries).toStrictEqual([]);
      },
    );
  });

  describe('Ultrasによる免除', () => {
    test('勝利の確定から現在までにUltrasの期間があればweek_entry_exemptで拒否する', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy(true);

      expect(await describeAs(policy)).toStrictEqual(
        rejectionOf('week_entry_exempt'),
      );
      expect(queries).toStrictEqual([
        { userId: userIdOf(OWNER), from: WON_AT, to: NOW },
      ]);
    });

    test('決済期限の後の判定は期間の終わりを決済期限にする', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy(true);
      const afterDeadline = new Date(WEEK_WINDOW.deadlineAt.getTime() + 1);

      expect(await describeAs(policy, { now: afterDeadline })).toStrictEqual(
        rejectionOf('week_entry_exempt'),
      );
      expect(queries).toStrictEqual([
        {
          userId: userIdOf(OWNER),
          from: WON_AT,
          to: WEEK_WINDOW.deadlineAt,
        },
      ]);
    });

    test('決済期限の後に確定した勝利はUltrasを問い合わせず免除にしない', async () => {
      const wonAfterDeadline = new Date(WEEK_WINDOW.deadlineAt.getTime() + 1);
      await seedEntry(1, { entry: { wonAt: wonAfterDeadline } });
      const { policy, queries } = createPolicy(true);
      const now = new Date(wonAfterDeadline.getTime() + 60_000);

      expect((await describeAs(policy, { now })).kind).toBe('available');
      expect(queries).toStrictEqual([]);
    });
  });

  describe('購入の内容', () => {
    test('受付中の枠は参加費の購入の内容を返す', async () => {
      await seedEntry(1);
      const { policy, queries } = createPolicy();

      const decision = await describeAs(policy);

      expect(decision).toStrictEqual({
        kind: 'available',
        offer: {
          priceLookupKey: 'week_tournament_entry',
          quantity: 1,
          relatedId: launchIdOf(1),
          exclusivityKey: `launch:${launchIdOf(1)}:week`,
          deadlineAt: new Date('2026-11-24T07:35:00.000Z'),
          acceptUntil: new Date('2026-11-24T07:00:00.000Z'),
          fulfillableUntil: new Date('2026-11-24T07:45:00.000Z'),
          summary: {
            itemName: 'Weekトーナメント参加費',
            quantityLabel: '1件(2026年第47週(11/16〜11/22)のWeekトーナメント)',
            serviceTiming:
              '決済の反映後ただちに参加資格を付与し、2026年11月23日23:45(UTC-08:00)に組み合わせを決定します',
            additionalNotes: [
              '組み合わせ決定前にプロダクトを削除・退会すると参加資格を失い、参加費は自動で全額返金されます',
              'トーナメントの不戦勝・不戦敗・両者敗北による返金はありません',
            ],
          },
          requiresBotVerification: false,
        },
      });
      expect(queries).toStrictEqual([
        { userId: userIdOf(OWNER), from: WON_AT, to: NOW },
      ]);
    });

    test('期限は週のトーナメントに保存した値を使う', async () => {
      const acceptUntil = new Date('2026-11-25T07:00:00.000Z');
      const deadlineAt = new Date('2026-11-25T07:35:00.000Z');
      const drawAt = new Date('2026-11-25T07:45:00.000Z');
      await db
        .update(weekTournaments)
        .set({ acceptUntil, deadlineAt, drawAt })
        .where(eq(weekTournaments.weekStart, WEEK_START));
      await seedEntry(1);
      const { policy } = createPolicy();

      const offer = offerOf(await describeAs(policy));

      expect(offer).toMatchObject({
        acceptUntil,
        deadlineAt,
        fulfillableUntil: drawAt,
      });
      expect(offer.summary.serviceTiming).toBe(
        '決済の反映後ただちに参加資格を付与し、2026年11月24日23:45(UTC-08:00)に組み合わせを決定します',
      );
    });

    test('受付期限の後も購入の内容を返し、受付の可否は決済の機能に任せる', async () => {
      await seedEntry(1);
      const { policy } = createPolicy();

      const decision = await describeAs(policy, {
        now: WEEK_WINDOW.acceptUntil,
      });

      expect(decision.kind).toBe('available');
    });
  });
});

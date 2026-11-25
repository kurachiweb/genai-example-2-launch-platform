import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { SponsorshipExportStatus } from '../../../common-lib/sponsorship/sponsorship-status.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { ProductExport } from '../../core/product/ports.ts';
import type { SponsorshipExportRecord } from '../../core/sponsorship/ports.ts';
import { D1ProductExport } from '../product/d1-product-export.ts';
import { D1SponsorshipExport } from './d1-sponsorship-export.ts';
import {
  clearSponsorshipTables,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  sponsorshipIdOf,
  sponsorshipPaymentRecordIdOf,
  type SponsorshipFixture,
  T0,
  terminatedColumnsOf,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const sponsorshipExport = new D1SponsorshipExport(db, new D1ProductExport(db));

const OWNER = userIdOf(1);

// NOW(2026-11-25 0:00)の直前の業務日付は2026-11-24
const BEFORE_NOW = new Date(NOW.getTime() - 1);

const VISIBLE_PRODUCT = 1;
const HIDDEN_PRODUCT = 2;
const DELETED_PRODUCT = 3;
const OTHER_USERS_PRODUCT = 4;

function createdAtOf(index: number): Date {
  return new Date(T0.getTime() + index * 60_000);
}

function sponsorshipOf(
  index: number,
  product: number,
  period: { readonly startsOn: string; readonly endsOn: string; days: number },
  columns: SponsorshipFixture['columns'] = {},
): SponsorshipFixture {
  return {
    index,
    owner: 1,
    product,
    columns: { ...period, createdAt: createdAtOf(index), ...columns },
  };
}

const DECEMBER_FIRST_WEEK = {
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
  days: 7,
};
const STARTS_TODAY = { startsOn: '2026-11-25', endsOn: '2026-12-01', days: 7 };
const ENDS_TODAY = { startsOn: '2026-11-19', endsOn: '2026-11-25', days: 7 };
const ENDED_YESTERDAY = {
  startsOn: '2026-11-18',
  endsOn: '2026-11-24',
  days: 7,
};
const SPANS_TODAY = { startsOn: '2026-11-20', endsOn: '2026-11-30', days: 11 };

function expectedOf(
  index: number,
  product: number,
  period: { readonly startsOn: string; readonly endsOn: string; days: number },
  status: SponsorshipExportStatus,
  paid = true,
  tier: SponsorshipTier = 'gold',
): SponsorshipExportRecord {
  return {
    id: sponsorshipIdOf(index),
    product: {
      name: `プロダクト${String(product)}`,
      handle: `product${String(product)}`,
    },
    tier,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    days: period.days,
    status,
    paymentId: paid ? sponsorshipPaymentRecordIdOf(index) : null,
    createdAt: createdAtOf(index),
  };
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(1);
  await insertSponsorUser(2);
  await insertSponsorProduct({ index: VISIBLE_PRODUCT, owner: 1 });
  await insertSponsorProduct({
    index: HIDDEN_PRODUCT,
    owner: 1,
    state: 'hidden',
  });
  await insertSponsorProduct({
    index: DELETED_PRODUCT,
    owner: 1,
    state: 'deleted',
  });
  await insertSponsorProduct({ index: OTHER_USERS_PRODUCT, owner: 2 });
});

describe('D1SponsorshipExport.listByUser', () => {
  test('sponsorships.jsonの項目を、プロダクトの名称とハンドルと決済履歴の識別を付けて返す', async () => {
    await insertSponsorships([
      sponsorshipOf(1, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, {
        tier: 'legend',
      }),
      sponsorshipOf(
        2,
        VISIBLE_PRODUCT,
        { startsOn: '2026-12-10', endsOn: '2026-12-12', days: 3 },
        paidColumnsOf(2, { tier: 'silver' }),
      ),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records).toStrictEqual([
      expectedOf(
        1,
        VISIBLE_PRODUCT,
        DECEMBER_FIRST_WEEK,
        'pending_payment',
        false,
        'legend',
      ),
      expectedOf(
        2,
        VISIBLE_PRODUCT,
        { startsOn: '2026-12-10', endsOn: '2026-12-12', days: 3 },
        'scheduled',
        true,
        'silver',
      ),
    ]);
  });

  test('状態を未決済・掲載予定・掲載中・終了・強制終了に振り分ける', async () => {
    await insertSponsorships([
      sponsorshipOf(1, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK),
      sponsorshipOf(2, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, paidColumnsOf(2)),
      sponsorshipOf(3, VISIBLE_PRODUCT, STARTS_TODAY, paidColumnsOf(3)),
      sponsorshipOf(4, VISIBLE_PRODUCT, ENDS_TODAY, paidColumnsOf(4)),
      sponsorshipOf(5, VISIBLE_PRODUCT, ENDED_YESTERDAY, paidColumnsOf(5)),
      sponsorshipOf(6, VISIBLE_PRODUCT, SPANS_TODAY, terminatedColumnsOf(6)),
      sponsorshipOf(
        7,
        VISIBLE_PRODUCT,
        ENDED_YESTERDAY,
        terminatedColumnsOf(7),
      ),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records).toStrictEqual([
      expectedOf(
        1,
        VISIBLE_PRODUCT,
        DECEMBER_FIRST_WEEK,
        'pending_payment',
        false,
      ),
      expectedOf(2, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, 'scheduled'),
      expectedOf(3, VISIBLE_PRODUCT, STARTS_TODAY, 'active'),
      expectedOf(4, VISIBLE_PRODUCT, ENDS_TODAY, 'active'),
      expectedOf(5, VISIBLE_PRODUCT, ENDED_YESTERDAY, 'ended'),
      expectedOf(6, VISIBLE_PRODUCT, SPANS_TODAY, 'terminated'),
      expectedOf(7, VISIBLE_PRODUCT, ENDED_YESTERDAY, 'terminated'),
    ]);
  });

  test('状態の日付は基準時刻の業務日付で決める', async () => {
    await insertSponsorships([
      sponsorshipOf(1, VISIBLE_PRODUCT, STARTS_TODAY, paidColumnsOf(1)),
      sponsorshipOf(2, VISIBLE_PRODUCT, ENDED_YESTERDAY, paidColumnsOf(2)),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, BEFORE_NOW);

    expect(records.map(({ status }) => status)).toStrictEqual([
      'scheduled',
      'active',
    ]);
  });

  test('表示停止中の広告は日付により掲載予定か掲載中にする', async () => {
    await insertSponsorships([
      sponsorshipOf(1, HIDDEN_PRODUCT, DECEMBER_FIRST_WEEK, paidColumnsOf(1)),
      sponsorshipOf(2, HIDDEN_PRODUCT, SPANS_TODAY, paidColumnsOf(2)),
      sponsorshipOf(3, HIDDEN_PRODUCT, ENDED_YESTERDAY, paidColumnsOf(3)),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records).toStrictEqual([
      expectedOf(1, HIDDEN_PRODUCT, DECEMBER_FIRST_WEEK, 'scheduled'),
      expectedOf(2, HIDDEN_PRODUCT, SPANS_TODAY, 'active'),
      expectedOf(3, HIDDEN_PRODUCT, ENDED_YESTERDAY, 'ended'),
    ]);
  });

  test('投稿者の停止で表示を止めた広告も日付により掲載予定か掲載中にする', async () => {
    await clearSponsorshipTables();
    await insertSponsorUser(1, 'suspended');
    await insertSponsorProduct({ index: VISIBLE_PRODUCT, owner: 1 });
    await insertSponsorships([
      sponsorshipOf(1, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, paidColumnsOf(1)),
      sponsorshipOf(2, VISIBLE_PRODUCT, SPANS_TODAY, paidColumnsOf(2)),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records.map(({ status }) => status)).toStrictEqual([
      'scheduled',
      'active',
    ]);
  });

  test('プロダクトの論理削除で終わった決済済みの広告は、論理削除済みのプロダクトの名称とハンドルで終了として返す', async () => {
    await insertSponsorships([
      sponsorshipOf(
        1,
        DELETED_PRODUCT,
        DECEMBER_FIRST_WEEK,
        paidColumnsOf(1, { productDeletedAt: T0 }),
      ),
      sponsorshipOf(
        2,
        DELETED_PRODUCT,
        SPANS_TODAY,
        paidColumnsOf(2, { productDeletedAt: T0 }),
      ),
      sponsorshipOf(
        3,
        DELETED_PRODUCT,
        SPANS_TODAY,
        terminatedColumnsOf(3, { productDeletedAt: T0 }),
      ),
      sponsorshipOf(4, DELETED_PRODUCT, DECEMBER_FIRST_WEEK),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records).toStrictEqual([
      expectedOf(1, DELETED_PRODUCT, DECEMBER_FIRST_WEEK, 'ended'),
      expectedOf(2, DELETED_PRODUCT, SPANS_TODAY, 'ended'),
      expectedOf(3, DELETED_PRODUCT, SPANS_TODAY, 'terminated'),
      expectedOf(
        4,
        DELETED_PRODUCT,
        DECEMBER_FIRST_WEEK,
        'pending_payment',
        false,
      ),
    ]);
  });

  test('申込の記録だけにプロダクトの論理削除がある決済済みの広告も終了にする', async () => {
    await insertSponsorships([
      sponsorshipOf(
        1,
        VISIBLE_PRODUCT,
        SPANS_TODAY,
        paidColumnsOf(1, { productDeletedAt: T0 }),
      ),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records.map(({ status }) => status)).toStrictEqual(['ended']);
  });

  test('プロダクトの一覧だけに論理削除がある決済済みの広告も終了にする', async () => {
    await insertSponsorships([
      sponsorshipOf(1, DELETED_PRODUCT, SPANS_TODAY, paidColumnsOf(1)),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records).toStrictEqual([
      expectedOf(1, DELETED_PRODUCT, SPANS_TODAY, 'ended'),
    ]);
  });

  test('論理削除された申込と他人の申込を除く', async () => {
    await insertSponsorships([
      sponsorshipOf(1, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, paidColumnsOf(1)),
      sponsorshipOf(2, VISIBLE_PRODUCT, SPANS_TODAY, {
        ...paidColumnsOf(2),
        deletedAt: T0,
      }),
      sponsorshipOf(3, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, {
        deletedAt: T0,
      }),
      {
        ...sponsorshipOf(4, OTHER_USERS_PRODUCT, SPANS_TODAY, paidColumnsOf(4)),
        owner: 2,
      },
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);
    const others = await sponsorshipExport.listByUser(userIdOf(2), NOW);

    expect(records).toStrictEqual([
      expectedOf(1, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, 'scheduled'),
    ]);
    expect(others).toStrictEqual([
      expectedOf(4, OTHER_USERS_PRODUCT, SPANS_TODAY, 'active'),
    ]);
  });

  test('申込日時の古い順に、同じ日時はIDの昇順に返す', async () => {
    const sameTime = createdAtOf(1);
    await insertSponsorships([
      sponsorshipOf(1, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, {
        createdAt: createdAtOf(9),
      }),
      sponsorshipOf(2, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, {
        createdAt: sameTime,
      }),
      sponsorshipOf(3, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, {
        createdAt: sameTime,
      }),
      sponsorshipOf(4, VISIBLE_PRODUCT, DECEMBER_FIRST_WEEK, {
        createdAt: createdAtOf(0),
      }),
    ]);

    const records = await sponsorshipExport.listByUser(OWNER, NOW);

    expect(records.map(({ id }) => id)).toStrictEqual(
      [4, 2, 3, 1].map(sponsorshipIdOf),
    );
  });

  test('申込が無ければプロダクトの一覧を読まずに空の配列を返す', async () => {
    const listByUser = vi.fn<ProductExport['listByUser']>();

    const records = await new D1SponsorshipExport(db, {
      listByUser,
    }).listByUser(OWNER, NOW);

    expect(records).toStrictEqual([]);
    expect(listByUser).not.toHaveBeenCalled();
  });

  test('申込のプロダクトが利用者のプロダクトの一覧に無ければ失敗する', async () => {
    await insertSponsorships([
      sponsorshipOf(1, OTHER_USERS_PRODUCT, DECEMBER_FIRST_WEEK),
    ]);

    await expect(sponsorshipExport.listByUser(OWNER, NOW)).rejects.toThrow(
      sponsorshipIdOf(1),
    );
  });
});

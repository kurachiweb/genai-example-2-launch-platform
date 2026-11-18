import { beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import type {
  AdminSponsorshipFilter,
  SponsorshipPage,
} from '../../core/sponsorship/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { D1SponsorshipStore } from './d1-sponsorship-store.ts';
import {
  clearSponsorshipTables,
  createSequentialSponsorshipIds,
  db,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorUser,
  paidColumnsOf,
  type SponsorshipFixture,
  sponsorshipIdOf,
  T0,
  TODAY,
  terminatedColumnsOf,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const store = new D1SponsorshipStore(db, createSequentialSponsorshipIds());

const today = parseBusinessDate(TODAY);

const MINUTE = 60_000;

// 番号の大きい申込ほど新しい
function createdAtOf(index: number): Date {
  return new Date(T0.getTime() + index * MINUTE);
}

function fixtureOf(
  index: number,
  columns: SponsorshipFixture['columns'] = {},
  { owner = 1, product = 1 }: { owner?: number; product?: number } = {},
): SponsorshipFixture {
  return {
    index,
    owner,
    product,
    columns: { createdAt: createdAtOf(index), ...columns },
  };
}

function paidOf(
  index: number,
  columns: SponsorshipFixture['columns'] = {},
  place: { owner?: number; product?: number } = {},
): SponsorshipFixture {
  return fixtureOf(index, paidColumnsOf(index, columns), place);
}

const idsOf = (page: SponsorshipPage): string[] =>
  page.records.map(({ id }) => id);

const idsFor = (...indexes: number[]): string[] => indexes.map(sponsorshipIdOf);

async function rejectionOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(1);
  await insertSponsorUser(2);
  await insertSponsorProduct({ index: 1, owner: 1 });
  await insertSponsorProduct({ index: 2, owner: 1, state: 'hidden' });
  await insertSponsorProduct({ index: 3, owner: 2 });
});

describe('D1SponsorshipStore', () => {
  describe('listByOwner', () => {
    test('本人の論理削除されていない申込を作成日時の新しい順に返し、続きのページを読める', async () => {
      await insertSponsorships([
        fixtureOf(1),
        paidOf(2),
        fixtureOf(3, {}, { product: 2 }),
        fixtureOf(4, { deletedAt: T0 }),
        fixtureOf(5, {}, { owner: 2, product: 3 }),
      ]);

      const first = await store.listByOwner(userIdOf(1), { first: 2 });

      expect(idsOf(first)).toEqual(idsFor(3, 2));
      expect(first.hasNextPage).toBe(true);
      expect(first.endCursor).toEqual(expect.any(String));

      const second = await store.listByOwner(userIdOf(1), {
        first: 2,
        after: first.endCursor ?? undefined,
      });

      expect(idsOf(second)).toEqual(idsFor(1));
      expect(second.hasNextPage).toBe(false);
      expect(second.endCursor).toEqual(expect.any(String));
    });

    test('作成日時が同じ申込はIDの降順に並べ、ページの境目で漏れも重複も無い', async () => {
      await insertSponsorships(
        [1, 2, 3].map((index) => fixtureOf(index, { createdAt: T0 })),
      );

      const first = await store.listByOwner(userIdOf(1), { first: 1 });
      const second = await store.listByOwner(userIdOf(1), {
        first: 2,
        after: first.endCursor ?? undefined,
      });

      expect(idsOf(first)).toEqual(idsFor(3));
      expect(idsOf(second)).toEqual(idsFor(2, 1));
      expect(second.hasNextPage).toBe(false);
    });

    test('申込が無ければ続きの無い空のページを返す', async () => {
      expect(await store.listByOwner(userIdOf(2), { first: 20 })).toEqual({
        records: [],
        hasNextPage: false,
        endCursor: null,
      });
    });

    test.each(['not-a-cursor', 'MTIzOmFiYw', ''])(
      '形式の正しくないカーソル(%s)はinvalid_cursorで拒否する',
      async (after) => {
        const error = await rejectionOf(
          store.listByOwner(userIdOf(1), { first: 20, after }),
        );

        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ code: 'invalid_cursor' });
      },
    );
  });

  describe('listForAdmin', () => {
    // 今日(2026-11-25)を基準にした状態ごとの申込
    async function insertStatusFixtures(): Promise<void> {
      await insertSponsorships([
        fixtureOf(1),
        paidOf(2, { startsOn: '2026-12-01', endsOn: '2026-12-07' }),
        paidOf(3, { startsOn: '2026-11-20', endsOn: '2026-11-30' }),
        paidOf(4, { startsOn: TODAY, endsOn: '2026-12-01' }),
        paidOf(5, { startsOn: '2026-11-20', endsOn: TODAY }),
        paidOf(
          6,
          { startsOn: '2026-11-20', endsOn: '2026-11-30' },
          { product: 2 },
        ),
        paidOf(7, { startsOn: '2026-11-10', endsOn: '2026-11-24' }),
        paidOf(8, {
          startsOn: '2026-12-01',
          endsOn: '2026-12-07',
          productDeletedAt: T0,
        }),
        paidOf(9, {
          startsOn: '2026-11-20',
          endsOn: '2026-11-30',
          productDeletedAt: T0,
        }),
        fixtureOf(10, terminatedColumnsOf(10)),
        paidOf(11, { deletedAt: T0 }),
        paidOf(
          12,
          { tier: 'silver', startsOn: '2026-12-01', endsOn: '2026-12-07' },
          { owner: 2, product: 3 },
        ),
        fixtureOf(13, { tier: 'legend' }, { owner: 2, product: 3 }),
      ]);
    }

    async function adminIds(filter: AdminSponsorshipFilter): Promise<string[]> {
      return idsOf(await store.listForAdmin(filter, today, { first: 50 }));
    }

    test('絞り込みが無ければ、退会者の申込を除く全ての申込を作成日時の新しい順に返す', async () => {
      await insertStatusFixtures();

      expect(await adminIds({})).toEqual(
        idsFor(13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1),
      );
    });

    test.each([
      ['pending_payment', [13, 1]],
      ['scheduled', [12, 2]],
      ['active', [6, 5, 4, 3]],
      ['ended', [9, 8, 7]],
      ['terminated', [10]],
    ] as const)(
      '掲載状況%sで絞り込むと、表示停止中を掲載中に、プロダクトの論理削除が記録された決済済みを終了に含める',
      async (status, indexes) => {
        await insertStatusFixtures();

        expect(await adminIds({ status })).toEqual(idsFor(...indexes));
      },
    );

    test('ティアで絞り込み、掲載状況と組み合わせられる', async () => {
      await insertStatusFixtures();

      expect(await adminIds({ tier: 'silver' })).toEqual(idsFor(12));
      expect(await adminIds({ tier: 'legend' })).toEqual(idsFor(13));
      expect(await adminIds({ tier: 'gold', status: 'scheduled' })).toEqual(
        idsFor(2),
      );
    });

    test('絞り込んだ一覧の続きのページを読める', async () => {
      await insertStatusFixtures();

      const first = await store.listForAdmin({ status: 'active' }, today, {
        first: 3,
      });
      const second = await store.listForAdmin({ status: 'active' }, today, {
        first: 3,
        after: first.endCursor ?? undefined,
      });

      expect(idsOf(first)).toEqual(idsFor(6, 5, 4));
      expect(first.hasNextPage).toBe(true);
      expect(idsOf(second)).toEqual(idsFor(3));
      expect(second.hasNextPage).toBe(false);
    });

    test('形式の正しくないカーソルはinvalid_cursorで拒否する', async () => {
      const error = await rejectionOf(
        store.listForAdmin({}, today, { first: 50, after: 'not-a-cursor' }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'invalid_cursor' });
    });
  });
});

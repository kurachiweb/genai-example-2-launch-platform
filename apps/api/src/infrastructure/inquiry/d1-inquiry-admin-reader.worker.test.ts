import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { INQUIRY_CATEGORY_OTHER_ID } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import { INQUIRY_STATUSES } from '../../../common-lib/inquiry/inquiry-status.ts';
import { createDatabase } from '../../../db/client.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type {
  AdminInquiryFilter,
  InquiryAdminReader,
} from '../../application/inquiry/ports.ts';
import { D1InquiryAdminReader } from './d1-inquiry-admin-reader.ts';
import { encodeInquiryCursor } from './inquiry-cursor.ts';
import {
  after,
  categoryIdOf,
  db,
  guestInquiryIdOf,
  insertCategory,
  insertGuestInquiry,
  insertMemberInquiry,
  memberInquiryIdOf,
  resetInquiryTables,
  T0,
} from './testing/inquiry-store-fixtures.ts';

const PAGE = Object.freeze({ limit: 50 as const });

function createReader(): InquiryAdminReader {
  return new D1InquiryAdminReader(db);
}

async function rejectionOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
  } catch (error) {
    return error;
  }
  return undefined;
}

async function listIds(
  filter: AdminInquiryFilter,
  after?: string,
): Promise<readonly string[]> {
  const page = await createReader().list(filter, {
    ...PAGE,
    ...(after === undefined ? {} : { after }),
  });
  return page.items.map((item) => item.id);
}

// 索引の選び方は値に依らないため、すべてのバインド変数に同じ値を入れて実行の計画を読む
async function queryPlanOf(query: string): Promise<readonly string[]> {
  const parameterCount = query.match(/\?/gu)?.length ?? 0;
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`)
    .bind(...Array.from({ length: parameterCount }, () => 1))
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail);
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
  await insertUser(1);
  await insertUser(2, { nickname: '退会した利用者' });
});

describe('D1InquiryAdminReader', () => {
  describe('list', () => {
    test('ログインと未ログインの問い合わせを受付日時の新しい順に1つの一覧にし、送信者の表示名と退会の有無を返す', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'in_progress',
        createdAt: after(10),
        lastMessageAt: after(40),
      });
      await insertGuestInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        nickname: 'ゲストの太郎',
        status: 'resolved',
        createdAt: after(20),
      });
      await insertMemberInquiry(
        2,
        {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(30),
          lastMessageAt: after(35),
          deletedAt: after(50),
        },
        2,
      );

      const page = await createReader().list({}, PAGE);

      expect(page).toEqual({
        items: [
          {
            kind: 'member',
            id: memberInquiryIdOf(2),
            categoryId: INQUIRY_CATEGORY_OTHER_ID,
            status: 'open',
            senderName: '退会した利用者',
            withdrawn: true,
            createdAt: after(30),
            lastMessageAt: after(35),
          },
          {
            kind: 'guest',
            id: guestInquiryIdOf(1),
            categoryId: INQUIRY_CATEGORY_OTHER_ID,
            status: 'resolved',
            senderName: 'ゲストの太郎',
            withdrawn: false,
            createdAt: after(20),
            lastMessageAt: after(20),
          },
          {
            kind: 'member',
            id: memberInquiryIdOf(1),
            categoryId: INQUIRY_CATEGORY_OTHER_ID,
            status: 'in_progress',
            senderName: '利用者1',
            withdrawn: false,
            createdAt: after(10),
            lastMessageAt: after(40),
          },
        ],
        nextCursor: null,
      });
    });

    test('50件ずつ読み、51件目があれば50件目の位置のカーソルを返し、カーソルで両方のテーブルの残りを読む', async () => {
      for (let index = 1; index <= 30; index += 1) {
        await insertMemberInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(index * 20),
        });
      }
      for (let index = 1; index <= 25; index += 1) {
        await insertGuestInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(index * 20 + 10),
        });
      }
      const expected = [
        ...Array.from({ length: 30 }, (_, index) => ({
          id: memberInquiryIdOf(index + 1),
          at: (index + 1) * 20,
        })),
        ...Array.from({ length: 25 }, (_, index) => ({
          id: guestInquiryIdOf(index + 1),
          at: (index + 1) * 20 + 10,
        })),
      ].toSorted((left, right) => right.at - left.at);
      const reader = createReader();

      const first = await reader.list({}, PAGE);

      expect(first.items.map((item) => item.id)).toEqual(
        expected.slice(0, 50).map((item) => item.id),
      );
      const last = expected[49];
      expect(first.nextCursor).toBe(
        encodeInquiryCursor({ at: after(last?.at ?? 0), id: last?.id ?? '' }),
      );

      const second = await reader.list(
        {},
        { ...PAGE, after: first.nextCursor ?? '' },
      );

      expect(second.items.map((item) => item.id)).toEqual(
        expected.slice(50).map((item) => item.id),
      );
      expect(second.nextCursor).toBeNull();
    });

    test('ちょうど50件なら次のページのカーソルを返さない', async () => {
      for (let index = 1; index <= 25; index += 1) {
        await insertMemberInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(index),
        });
        await insertGuestInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(index),
        });
      }

      const page = await createReader().list({}, PAGE);

      expect(page.items).toHaveLength(50);
      expect(page.nextCursor).toBeNull();
    });

    test('受付日時が同じ問い合わせは種別をまたいでIDの降順に並べ、カーソルの位置の次から読む', async () => {
      for (const index of [1, 2]) {
        await insertMemberInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(10),
        });
        await insertGuestInquiry(index, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          createdAt: after(10),
        });
      }

      await expect(listIds({})).resolves.toEqual([
        memberInquiryIdOf(2),
        memberInquiryIdOf(1),
        guestInquiryIdOf(2),
        guestInquiryIdOf(1),
      ]);
      await expect(
        listIds(
          {},
          encodeInquiryCursor({ at: after(10), id: memberInquiryIdOf(1) }),
        ),
      ).resolves.toEqual([guestInquiryIdOf(2), guestInquiryIdOf(1)]);
    });

    describe('絞り込み', () => {
      beforeEach(async () => {
        await insertCategory(1, 'Billing');
        await insertMemberInquiry(1, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status: 'open',
          createdAt: after(100),
        });
        await insertMemberInquiry(2, {
          categoryId: categoryIdOf(1),
          status: 'resolved',
          createdAt: after(200),
        });
        await insertMemberInquiry(
          3,
          {
            categoryId: categoryIdOf(1),
            status: 'open',
            createdAt: after(300),
            deletedAt: after(301),
          },
          2,
        );
        await insertGuestInquiry(1, {
          categoryId: categoryIdOf(1),
          status: 'open',
          createdAt: after(150),
        });
        await insertGuestInquiry(2, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status: 'rejected',
          createdAt: after(250),
        });
      });

      test('対応ステータスで絞り込むと、両方のテーブルからそのステータスの問い合わせだけを返す', async () => {
        await expect(listIds({ status: 'open' })).resolves.toEqual([
          memberInquiryIdOf(3),
          guestInquiryIdOf(1),
          memberInquiryIdOf(1),
        ]);
        await expect(listIds({ status: 'rejected' })).resolves.toEqual([
          guestInquiryIdOf(2),
        ]);
        await expect(listIds({ status: 'in_progress' })).resolves.toEqual([]);
      });

      test('種別で絞り込むと、その種別のテーブルの問い合わせだけを返す', async () => {
        await expect(listIds({ kind: 'member' })).resolves.toEqual([
          memberInquiryIdOf(3),
          memberInquiryIdOf(2),
          memberInquiryIdOf(1),
        ]);
        await expect(listIds({ kind: 'guest' })).resolves.toEqual([
          guestInquiryIdOf(2),
          guestInquiryIdOf(1),
        ]);
      });

      test('カテゴリで絞り込むと、そのカテゴリの問い合わせだけを返す', async () => {
        await expect(listIds({ categoryId: categoryIdOf(1) })).resolves.toEqual(
          [memberInquiryIdOf(3), memberInquiryIdOf(2), guestInquiryIdOf(1)],
        );
        await expect(listIds({ categoryId: categoryIdOf(9) })).resolves.toEqual(
          [],
        );
      });

      test('受付日時の期間は開始の日時を含み、終了の日時を含まない', async () => {
        await expect(
          listIds({ receivedFrom: after(150), receivedBefore: after(250) }),
        ).resolves.toEqual([memberInquiryIdOf(2), guestInquiryIdOf(1)]);
        await expect(listIds({ receivedFrom: after(250) })).resolves.toEqual([
          memberInquiryIdOf(3),
          guestInquiryIdOf(2),
        ]);
        await expect(listIds({ receivedBefore: after(150) })).resolves.toEqual([
          memberInquiryIdOf(1),
        ]);
      });

      test('複数の条件はすべてを満たす問い合わせだけを返し、カーソルと併せて使える', async () => {
        const filter: AdminInquiryFilter = {
          status: 'open',
          kind: 'member',
          categoryId: categoryIdOf(1),
          receivedFrom: after(100),
          receivedBefore: after(400),
        };

        await expect(listIds(filter)).resolves.toEqual([memberInquiryIdOf(3)]);
        await expect(
          listIds(
            { status: 'open', receivedFrom: T0 },
            encodeInquiryCursor({ at: after(300), id: memberInquiryIdOf(3) }),
          ),
        ).resolves.toEqual([guestInquiryIdOf(1), memberInquiryIdOf(1)]);
      });
    });

    test.each([
      ['条件の無い', {}, 'created_at_idx'],
      ['ステータスで絞り込んだ', { status: 'open' }, 'status_created_at_idx'],
      [
        'カテゴリで絞り込んだ',
        { categoryId: categoryIdOf(1) },
        'category_id_idx',
      ],
    ] as const)(
      '%s一覧は1つの問い合わせで、両方のテーブルを索引(%s)で絞って読む',
      async (
        _label: string,
        filter: AdminInquiryFilter,
        indexSuffix: string,
      ) => {
        const recording = createBatchRecordingD1(env.DB);
        const reader = new D1InquiryAdminReader(createDatabase(recording.d1));

        await reader.list(filter, PAGE);

        const queries = recording.statementsOutsideBatches();
        expect(queries).toHaveLength(1);
        const details = await queryPlanOf(queries[0] ?? '');
        expect(details).toEqual(
          expect.arrayContaining([
            expect.stringMatching(
              new RegExp(
                `member_inquiries USING INDEX member_inquiries_${indexSuffix}\\b`,
                'u',
              ),
            ),
            expect.stringMatching(
              new RegExp(
                `guest_inquiries USING INDEX guest_inquiries_${indexSuffix}\\b`,
                'u',
              ),
            ),
          ]),
        );
      },
    );

    test('問い合わせが無ければ空のページを返す', async () => {
      await expect(createReader().list({}, PAGE)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    });

    test('不正なカーソルをページの位置の指定の誤りとして拒否する', async () => {
      const error = await rejectionOf(
        createReader().list({}, { ...PAGE, after: 'invalid' }),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'invalid_cursor' });
    });
  });

  describe('findDetail', () => {
    test('ログインの問い合わせは論理削除したものも削除日時とともに、未ログインの問い合わせは連絡先とともに返し、無ければundefinedを返す', async () => {
      await insertMemberInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'resolved',
        statusChangedAt: after(5),
        lastMessageAt: after(6),
        createdAt: after(1),
        deletedAt: after(7),
      });
      await insertGuestInquiry(1, {
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
        status: 'in_progress',
        statusChangedAt: after(3),
        createdAt: after(2),
      });
      const reader = createReader();

      await expect(reader.findDetail(memberInquiryIdOf(1))).resolves.toEqual({
        kind: 'member',
        inquiry: {
          id: memberInquiryIdOf(1),
          userId: userIdOf(1),
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status: 'resolved',
          statusChangedAt: after(5),
          lastMessageAt: after(6),
          createdAt: after(1),
          deletedAt: after(7),
        },
      });
      await expect(reader.findDetail(guestInquiryIdOf(1))).resolves.toEqual({
        kind: 'guest',
        inquiry: {
          id: guestInquiryIdOf(1),
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          nickname: 'ゲスト1',
          email: 'guest1@mail.example',
          body: '問い合わせの本文1',
          status: 'in_progress',
          statusChangedAt: after(3),
          createdAt: after(2),
        },
      });
      await expect(
        reader.findDetail(memberInquiryIdOf(9)),
      ).resolves.toBeUndefined();
    });
  });

  describe('countUnhandled', () => {
    test('未対応のログインと未ログインの問い合わせの合計を数え、退会により論理削除した問い合わせを数えない', async () => {
      for (const [index, status] of INQUIRY_STATUSES.entries()) {
        await insertMemberInquiry(index + 1, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status,
        });
        await insertGuestInquiry(index + 1, {
          categoryId: INQUIRY_CATEGORY_OTHER_ID,
          status,
        });
      }
      await insertMemberInquiry(10, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      await insertGuestInquiry(10, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
      await insertMemberInquiry(
        11,
        { categoryId: INQUIRY_CATEGORY_OTHER_ID, deletedAt: after(1) },
        2,
      );

      await expect(createReader().countUnhandled()).resolves.toBe(4);
    });

    test('問い合わせが無ければ0を返す', async () => {
      await expect(createReader().countUnhandled()).resolves.toBe(0);
    });
  });
});

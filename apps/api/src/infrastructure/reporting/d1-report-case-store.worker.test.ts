import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/reporting/report-rules.ts';
import { createDatabase } from '../../../db/client.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reportCategories } from '../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type {
  ReportCaseFilter,
  ReportCaseRecord,
  ReportCaseStore,
} from '../../application/reporting/ports.ts';
import { D1ReportCaseStore } from './d1-report-case-store.ts';

const T0 = new Date('2026-11-20T00:00:00.000Z');

const db = createDatabase(env.DB);

type CaseRow = typeof reportCases.$inferInsert;
type ReportRow = typeof reports.$inferInsert;

const after = (milliseconds: number): Date =>
  new Date(T0.getTime() + milliseconds);

const idOf = (prefix: string, index: number): string =>
  `${prefix}${String(index).padStart(17, '0')}`;
const caseIdOf = (index: number): string => idOf('01JE0CASE', index);
const reportIdOf = (index: number): string => idOf('01JE0RPRT', index);
const categoryIdOf = (index: number): string => idOf('01JE0CTGY', index);
const targetIdOf = (index: number): string => idOf('01JE0TRGT', index);
const productIdOf = (index: number): string => idOf('01JE0PRDT', index);

const cursorOf = (at: Date, id: string): string =>
  new TextEncoder()
    .encode(`${String(at.getTime())}:${id}`)
    .toBase64({ alphabet: 'base64url', omitPadding: true });

const OTHER_COUNT = Object.freeze({
  categoryId: REPORT_CATEGORY_OTHER_ID,
  name: REPORT_CATEGORY_OTHER_NAME,
});

const INFRINGEMENT_REPORT = Object.freeze({
  categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
  categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
});

function caseRowOf(index: number, columns: Partial<CaseRow>): CaseRow {
  return {
    id: caseIdOf(index),
    targetKind: 'user',
    targetId: targetIdOf(index),
    targetOwnerUserId: targetIdOf(index),
    productId: null,
    status: 'open',
    statusChangedAt: T0,
    lastReportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

function reportRowOf(
  index: number,
  caseIndex: number,
  columns: Partial<ReportRow>,
): ReportRow {
  return {
    id: reportIdOf(index),
    caseId: caseIdOf(caseIndex),
    reporterUserId: null,
    contactEmail: null,
    categoryId: REPORT_CATEGORY_OTHER_ID,
    categoryName: REPORT_CATEGORY_OTHER_NAME,
    reason: `理由${String(index)}`,
    reportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

async function insertCase(
  index: number,
  columns: Partial<CaseRow> = {},
): Promise<void> {
  await db.insert(reportCases).values(caseRowOf(index, columns));
}

async function insertReport(
  index: number,
  caseIndex: number,
  columns: Partial<ReportRow> = {},
): Promise<void> {
  await db.insert(reports).values(reportRowOf(index, caseIndex, columns));
}

// 案件と、最後の受付日時に受け付けた通報を1件作る
async function insertCaseWithReport(
  index: number,
  lastReportedAt: Date,
  columns: Partial<CaseRow> = {},
  reportColumns: Partial<ReportRow> = {},
): Promise<void> {
  await insertCase(index, { lastReportedAt, ...columns });
  await insertReport(index, index, {
    reportedAt: lastReportedAt,
    ...reportColumns,
  });
}

async function insertCategory(index: number, name: string): Promise<void> {
  await db.insert(reportCategories).values({
    id: categoryIdOf(index),
    name,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function renameCategory(index: number, name: string): Promise<void> {
  await db
    .update(reportCategories)
    .set({ name })
    .where(eq(reportCategories.id, categoryIdOf(index)));
}

const deletedBy = (at: Date): Partial<ReportRow> => ({
  reporterUserId: userIdOf(1),
  deletedAt: at,
});

function createStore(): ReportCaseStore {
  return new D1ReportCaseStore(db);
}

async function searchIds(
  filter: ReportCaseFilter,
  page: { readonly after?: string; readonly limit: number } = { limit: 50 },
): Promise<readonly string[]> {
  const result = await createStore().search(filter, page);
  return result.items.map((item) => item.caseId);
}

async function rejectionOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectedRecord(
  index: number,
  overrides: Partial<ReportCaseRecord>,
): ReportCaseRecord {
  return {
    caseId: caseIdOf(index),
    targetKind: 'user',
    targetId: targetIdOf(index),
    targetDetachedAt: null,
    targetOwnerUserId: targetIdOf(index),
    productId: null,
    status: 'open',
    statusChangedAt: T0,
    infringementReportedAt: null,
    closedAt: null,
    resolution: null,
    closingReason: null,
    lastInquiredAt: null,
    lastInquiryMessage: null,
    reportCount: 1,
    firstReportedAt: T0,
    lastReportedAt: T0,
    categoryCounts: [{ ...OTHER_COUNT, count: 1 }],
    ...overrides,
  };
}

beforeEach(async () => {
  await db.batch([
    db.delete(reports),
    db.delete(reportCases),
    db
      .delete(reportCategories)
      .where(eq(reportCategories.systemDefault, false)),
  ]);
  await clearIdentityTables();
  await insertUser(1);
});

describe('D1ReportCaseStore', () => {
  describe('search', () => {
    test('案件の列と、論理削除を除く通報の件数・最初の受付日時・現在のカテゴリ名のカテゴリごとの件数を返す', async () => {
      await insertCategory(1, '受付時の名前');
      await insertCase(1, {
        targetKind: 'comment',
        targetOwnerUserId: userIdOf(1),
        productId: productIdOf(1),
        status: 'resolved',
        statusChangedAt: after(500),
        lastReportedAt: after(300),
        infringementReportedAt: after(200),
        closedAt: after(500),
        resolution: 'none',
        closingReason: '対応しました',
        lastInquiredAt: after(400),
        lastInquiryMessage: '照会の本文',
      });
      const renamed = {
        categoryId: categoryIdOf(1),
        categoryName: '受付時の名前',
      };
      await insertReport(1, 1, { reportedAt: after(100) });
      await insertReport(2, 1, {
        reportedAt: after(200),
        ...INFRINGEMENT_REPORT,
      });
      await insertReport(3, 1, { reportedAt: after(250), ...renamed });
      await insertReport(4, 1, { reportedAt: after(260), ...renamed });
      await insertReport(5, 1, {
        reportedAt: after(50),
        ...deletedBy(after(600)),
      });
      await renameCategory(1, '変更後の名前');

      const result = await createStore().search({}, { limit: 50 });

      expect(result).toEqual({
        items: [
          expectedRecord(1, {
            targetKind: 'comment',
            targetOwnerUserId: userIdOf(1),
            productId: productIdOf(1),
            status: 'resolved',
            statusChangedAt: after(500),
            infringementReportedAt: after(200),
            closedAt: after(500),
            resolution: 'none',
            closingReason: '対応しました',
            lastInquiredAt: after(400),
            lastInquiryMessage: '照会の本文',
            reportCount: 4,
            firstReportedAt: after(100),
            lastReportedAt: after(300),
            categoryCounts: [
              { categoryId: categoryIdOf(1), name: '変更後の名前', count: 2 },
              {
                categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
                name: REPORT_CATEGORY_INFRINGEMENT_NAME,
                count: 1,
              },
              { ...OTHER_COUNT, count: 1 },
            ],
          }),
        ],
        nextCursor: null,
      });
    });

    test('最後の受付日時の新しい順に並べ、同じ日時はIDの降順にする', async () => {
      await insertCaseWithReport(1, after(100));
      await insertCaseWithReport(2, after(300));
      await insertCaseWithReport(3, after(200));
      await insertCaseWithReport(4, after(200));

      await expect(searchIds({})).resolves.toEqual([
        caseIdOf(2),
        caseIdOf(4),
        caseIdOf(3),
        caseIdOf(1),
      ]);
    });

    test('上限より多ければ最後の項目の位置のカーソルを返し、カーソルの位置の次から読み、ちょうど上限の件数なら続きを返さない', async () => {
      await insertCaseWithReport(1, after(100));
      await insertCaseWithReport(2, after(200));
      await insertCaseWithReport(3, after(200));
      await insertCaseWithReport(4, after(300));
      const store = createStore();

      const first = await store.search({}, { limit: 2 });

      expect(first.items.map((item) => item.caseId)).toEqual([
        caseIdOf(4),
        caseIdOf(3),
      ]);
      expect(first.nextCursor).toBe(cursorOf(after(200), caseIdOf(3)));

      const second = await store.search(
        {},
        { limit: 2, after: first.nextCursor ?? '' },
      );

      expect(second.items.map((item) => item.caseId)).toEqual([
        caseIdOf(2),
        caseIdOf(1),
      ]);
      expect(second.nextCursor).toBeNull();
    });

    test('1ページ50件の案件の件数と内訳をまとめて読み、51件目があれば続きのカーソルを返す', async () => {
      const indexes = Array.from({ length: 51 }, (_, index) => index + 1);
      for (let start = 0; start < indexes.length; start += 5) {
        const part = indexes.slice(start, start + 5);
        await db
          .insert(reportCases)
          .values(
            part.map((index) =>
              caseRowOf(index, { lastReportedAt: after(index) }),
            ),
          );
        await db
          .insert(reports)
          .values(
            part.map((index) =>
              reportRowOf(index, index, { reportedAt: after(index) }),
            ),
          );
      }

      const result = await createStore().search({}, { limit: 50 });

      expect(result.items).toHaveLength(50);
      expect(result.items.every((item) => item.reportCount === 1)).toBe(true);
      expect(result.items.at(-1)?.caseId).toBe(caseIdOf(2));
      expect(result.nextCursor).toBe(cursorOf(after(2), caseIdOf(2)));
    });

    test('論理削除を除く通報が無い案件を出さない', async () => {
      await insertCaseWithReport(1, after(100));
      await insertCaseWithReport(2, after(200), {}, deletedBy(after(300)));
      await insertCase(3, { lastReportedAt: after(300) });

      await expect(searchIds({})).resolves.toEqual([caseIdOf(1)]);
    });

    test('対象への参照を消した案件は対象のIDをnullにし、参照の消去の日時を返す', async () => {
      await insertCaseWithReport(1, after(100), {
        targetKind: 'product',
        targetId: null,
        targetOwnerUserId: null,
        targetDetachedAt: after(500),
      });

      const result = await createStore().search({}, { limit: 50 });

      expect(result.items).toEqual([
        expectedRecord(1, {
          targetKind: 'product',
          targetId: null,
          targetOwnerUserId: null,
          targetDetachedAt: after(500),
          firstReportedAt: after(100),
          lastReportedAt: after(100),
        }),
      ]);
    });

    describe('絞り込み', () => {
      const nuisance = (): Partial<ReportRow> => ({
        categoryId: categoryIdOf(1),
        categoryName: '迷惑行為',
      });

      beforeEach(async () => {
        await insertCategory(1, '迷惑行為');
        await insertCaseWithReport(1, after(100), { status: 'open' });
        await insertCaseWithReport(
          2,
          after(200),
          { status: 'in_progress', targetKind: 'product' },
          nuisance(),
        );
        await insertCaseWithReport(
          3,
          after(300),
          { status: 'rejected', closedAt: after(310), targetKind: 'comment' },
          nuisance(),
        );
        await insertReport(31, 3, { reportedAt: after(150) });
        await insertCaseWithReport(4, after(400), {
          status: 'open',
          targetKind: 'product',
        });
        await insertReport(41, 4, {
          reportedAt: after(250),
          ...nuisance(),
          ...deletedBy(after(450)),
        });
      });

      test('対応ステータスで絞り込む', async () => {
        await expect(searchIds({ status: 'open' })).resolves.toEqual([
          caseIdOf(4),
          caseIdOf(1),
        ]);
        await expect(searchIds({ status: 'rejected' })).resolves.toEqual([
          caseIdOf(3),
        ]);
        await expect(searchIds({ status: 'resolved' })).resolves.toEqual([]);
      });

      test('対象の種類で絞り込む', async () => {
        await expect(searchIds({ targetKind: 'product' })).resolves.toEqual([
          caseIdOf(4),
          caseIdOf(2),
        ]);
        await expect(searchIds({ targetKind: 'comment' })).resolves.toEqual([
          caseIdOf(3),
        ]);
      });

      test('カテゴリで絞り込むと、そのカテゴリの論理削除していない通報を含む案件だけを返す', async () => {
        await expect(
          searchIds({ categoryId: categoryIdOf(1) }),
        ).resolves.toEqual([caseIdOf(3), caseIdOf(2)]);
        await expect(
          searchIds({ categoryId: REPORT_CATEGORY_OTHER_ID }),
        ).resolves.toEqual([caseIdOf(4), caseIdOf(3), caseIdOf(1)]);
      });

      test('受付期間はその期間に受け付けた論理削除していない通報を含む案件で、開始を含み終了を含まない', async () => {
        await expect(
          searchIds({ reportedFrom: after(150), reportedBefore: after(300) }),
        ).resolves.toEqual([caseIdOf(3), caseIdOf(2)]);
        await expect(
          searchIds({ reportedFrom: after(250), reportedBefore: after(400) }),
        ).resolves.toEqual([caseIdOf(3)]);
        await expect(searchIds({ reportedFrom: after(400) })).resolves.toEqual([
          caseIdOf(4),
        ]);
        await expect(
          searchIds({ reportedBefore: after(150) }),
        ).resolves.toEqual([caseIdOf(1)]);
      });

      test('複数の条件はすべてを満たす案件だけを返し、カテゴリと受付期間は同じ通報で満たす', async () => {
        await expect(
          searchIds({
            status: 'in_progress',
            targetKind: 'product',
            categoryId: categoryIdOf(1),
            reportedFrom: after(200),
            reportedBefore: after(201),
          }),
        ).resolves.toEqual([caseIdOf(2)]);
        await expect(
          searchIds({
            categoryId: categoryIdOf(1),
            reportedBefore: after(200),
          }),
        ).resolves.toEqual([]);
        await expect(
          searchIds({
            categoryId: REPORT_CATEGORY_OTHER_ID,
            reportedFrom: after(150),
            reportedBefore: after(151),
          }),
        ).resolves.toEqual([caseIdOf(3)]);
      });

      test('絞り込みとカーソルを併せて使える', async () => {
        const filter: ReportCaseFilter = {
          categoryId: REPORT_CATEGORY_OTHER_ID,
        };

        const first = await createStore().search(filter, { limit: 1 });

        expect(first.items.map((item) => item.caseId)).toEqual([caseIdOf(4)]);
        expect(first.nextCursor).toBe(cursorOf(after(400), caseIdOf(4)));
        await expect(
          searchIds(filter, { limit: 50, after: first.nextCursor ?? '' }),
        ).resolves.toEqual([caseIdOf(3), caseIdOf(1)]);
      });
    });

    test('案件のページと、ページの案件の件数と内訳を1回ずつ読む', async () => {
      await insertCaseWithReport(1, after(100));
      await insertCaseWithReport(2, after(200));
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1ReportCaseStore(createDatabase(recording.d1));

      await store.search(
        { categoryId: REPORT_CATEGORY_OTHER_ID },
        { limit: 50 },
      );

      expect(recording.statementsOutsideBatches()).toHaveLength(2);
    });

    test('該当する案件が無ければ件数と内訳を読まずに空のページを返す', async () => {
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1ReportCaseStore(createDatabase(recording.d1));

      await expect(store.search({}, { limit: 50 })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(recording.statementsOutsideBatches()).toHaveLength(1);
    });

    test.each([
      ['形式の誤った', 'invalid'],
      ['IDが小文字の', cursorOf(after(1), caseIdOf(1).toLowerCase())],
      ['パディング付きの', `${cursorOf(after(1), caseIdOf(1))}=`],
    ])(
      '%sカーソルをページの位置の指定の誤りとして拒否する',
      async (_label, cursor) => {
        const error = await rejectionOf(
          createStore().search({}, { limit: 50, after: cursor }),
        );

        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ code: 'invalid_cursor' });
      },
    );
  });

  describe('find', () => {
    test('案件を論理削除を除く通報の件数と内訳とともに返す', async () => {
      await insertCase(1, {
        status: 'in_progress',
        statusChangedAt: after(50),
        lastReportedAt: after(200),
        infringementReportedAt: after(100),
      });
      await insertReport(1, 1, {
        reportedAt: after(100),
        ...INFRINGEMENT_REPORT,
      });
      await insertReport(2, 1, { reportedAt: after(200) });
      await insertReport(3, 1, {
        reportedAt: after(10),
        ...deletedBy(after(300)),
      });

      await expect(createStore().find(caseIdOf(1))).resolves.toEqual(
        expectedRecord(1, {
          status: 'in_progress',
          statusChangedAt: after(50),
          infringementReportedAt: after(100),
          reportCount: 2,
          firstReportedAt: after(100),
          lastReportedAt: after(200),
          categoryCounts: [
            {
              categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
              name: REPORT_CATEGORY_INFRINGEMENT_NAME,
              count: 1,
            },
            { ...OTHER_COUNT, count: 1 },
          ],
        }),
      );
    });

    test('対象への参照を消した案件は対象のIDをnullにし、参照の消去の日時を返す', async () => {
      await insertCaseWithReport(1, T0, {
        targetId: null,
        targetOwnerUserId: null,
        targetDetachedAt: after(500),
      });

      await expect(createStore().find(caseIdOf(1))).resolves.toEqual(
        expectedRecord(1, {
          targetId: null,
          targetOwnerUserId: null,
          targetDetachedAt: after(500),
        }),
      );
    });

    test('論理削除を除く通報が無い案件と、存在しない案件はundefinedを返す', async () => {
      await insertCaseWithReport(1, T0, {}, deletedBy(after(1)));
      const store = createStore();

      await expect(store.find(caseIdOf(1))).resolves.toBeUndefined();
      await expect(store.find(caseIdOf(9))).resolves.toBeUndefined();
    });
  });

  describe('listReports', () => {
    test('論理削除を除く通報を受付日時の古い順に、現在のカテゴリ名と連絡先の有無だけとともに返す', async () => {
      await insertCategory(1, '受付時の名前');
      await insertCase(1, { lastReportedAt: after(300) });
      await insertCase(2);
      await insertReport(1, 1, {
        reportedAt: after(300),
        contactEmail: 'guest@mail.example',
        reason: '連絡先のある未ログインの通報',
      });
      await insertReport(2, 1, {
        reportedAt: after(100),
        reporterUserId: userIdOf(1),
        categoryId: categoryIdOf(1),
        categoryName: '受付時の名前',
        reason: 'ログイン中の通報',
      });
      await insertReport(3, 1, {
        reportedAt: after(200),
        reason: '連絡先の無い未ログインの通報',
      });
      await insertReport(4, 1, {
        reportedAt: after(50),
        ...deletedBy(after(400)),
      });
      await insertReport(5, 2, { reportedAt: after(150) });
      await renameCategory(1, '変更後の名前');

      const result = await createStore().listReports(caseIdOf(1));

      expect(result).toStrictEqual([
        {
          reportId: reportIdOf(2),
          categoryId: categoryIdOf(1),
          categoryName: '変更後の名前',
          reason: 'ログイン中の通報',
          reportedAt: after(100),
          reporterUserId: userIdOf(1),
          hasContact: false,
        },
        {
          reportId: reportIdOf(3),
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: REPORT_CATEGORY_OTHER_NAME,
          reason: '連絡先の無い未ログインの通報',
          reportedAt: after(200),
          reporterUserId: null,
          hasContact: false,
        },
        {
          reportId: reportIdOf(1),
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: REPORT_CATEGORY_OTHER_NAME,
          reason: '連絡先のある未ログインの通報',
          reportedAt: after(300),
          reporterUserId: null,
          hasContact: true,
        },
      ]);
    });

    test('受付日時が同じ通報はIDの昇順に並べる', async () => {
      await insertCase(1);
      await insertReport(2, 1);
      await insertReport(1, 1);

      const result = await createStore().listReports(caseIdOf(1));

      expect(result.map((report) => report.reportId)).toEqual([
        reportIdOf(1),
        reportIdOf(2),
      ]);
    });
  });

  describe('countUnhandled', () => {
    test('論理削除を除く通報がある未対応の案件と、そのうち権利侵害の案件を数える', async () => {
      const infringement = { infringementReportedAt: T0 };
      await insertCaseWithReport(1, T0, { status: 'open' });
      await insertCaseWithReport(2, T0, { status: 'open', ...infringement });
      await insertCaseWithReport(3, T0, { status: 'open', ...infringement });
      await insertCaseWithReport(4, T0, {
        status: 'in_progress',
        ...infringement,
      });
      await insertCaseWithReport(5, T0, {
        status: 'resolved',
        closedAt: T0,
        resolution: 'none',
      });
      await insertCaseWithReport(
        6,
        T0,
        { status: 'open', ...infringement },
        deletedBy(after(1)),
      );
      await insertCase(7, { status: 'open' });

      await expect(createStore().countUnhandled()).resolves.toEqual({
        open: 3,
        infringementOpen: 2,
      });
    });

    test('未対応の案件が無ければ0件を返す', async () => {
      await expect(createStore().countUnhandled()).resolves.toEqual({
        open: 0,
        infringementOpen: 0,
      });
    });
  });

  describe('productSummary', () => {
    const productCase = (
      status: CaseRow['status'],
      productIndex = 1,
    ): Partial<CaseRow> => ({
      targetKind: 'product',
      targetId: productIdOf(productIndex),
      targetOwnerUserId: userIdOf(1),
      productId: productIdOf(productIndex),
      status,
      ...(status === 'resolved' ? { closedAt: T0, resolution: 'none' } : {}),
      ...(status === 'rejected' ? { closedAt: T0 } : {}),
    });

    test('対象がそのプロダクトの案件の、論理削除を除く通報の累計と未完了の案件を返す', async () => {
      await insertCaseWithReport(1, T0, productCase('rejected'));
      await insertReport(11, 1, { reportedAt: after(1) });
      await insertReport(12, 1, {
        reportedAt: after(2),
        ...deletedBy(after(3)),
      });
      await insertCaseWithReport(2, after(10), productCase('in_progress'));
      await insertCaseWithReport(3, T0, productCase('open', 2));
      await insertCaseWithReport(4, T0, {
        targetKind: 'comment',
        productId: productIdOf(1),
      });

      await expect(
        createStore().productSummary(productIdOf(1)),
      ).resolves.toEqual({
        reportCount: 3,
        openCase: { caseId: caseIdOf(2), status: 'in_progress' },
      });
    });

    test('未完了の案件が無ければopenCaseをnullにする', async () => {
      await insertCaseWithReport(1, T0, productCase('resolved'));

      await expect(
        createStore().productSummary(productIdOf(1)),
      ).resolves.toEqual({ reportCount: 1, openCase: null });
    });

    test('論理削除を除く通報が無い未完了の案件は件数にも未完了の案件にも出さない', async () => {
      await insertCaseWithReport(
        1,
        T0,
        productCase('open'),
        deletedBy(after(1)),
      );

      await expect(
        createStore().productSummary(productIdOf(1)),
      ).resolves.toEqual({ reportCount: 0, openCase: null });
    });

    test('通報の無いプロダクトは0件で未完了の案件をnullにする', async () => {
      await expect(
        createStore().productSummary(productIdOf(9)),
      ).resolves.toEqual({ reportCount: 0, openCase: null });
    });
  });
});

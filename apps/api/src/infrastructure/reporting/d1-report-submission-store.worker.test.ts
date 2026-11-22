import { env } from 'cloudflare:workers';
import { asc, eq, ne } from 'drizzle-orm';
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
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type {
  ReportSubmissionRecord,
  ReportSubmissionStore,
} from '../../application/reporting/ports.ts';
import { D1ReportSubmissionStore } from './d1-report-submission-store.ts';

const db = createDatabase(env.DB);

const T0 = new Date('2026-11-22T00:00:00.000Z');

const REPORTER_INDEX = 1;

const SECOND_REPORTER_INDEX = 2;

const OWNER_ID = '01JR0WNER00000000000000001';

const PRODUCT_ID = '01JR0PRDCT0000000000000001';

const OTHER_PRODUCT_ID = '01JR0PRDCT0000000000000002';

const CUSTOM_CATEGORY_ID = '01JR0CTGRY0000000000000001';

const MISSING_CATEGORY_ID = '01JR0CTGRY0000000000000099';

function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

function caseIdOf(index: number): string {
  return `01JR0CASE${String(index).padStart(17, '0')}`;
}

function reportIdOf(index: number): string {
  return `01JR0REPRT${String(index).padStart(16, '0')}`;
}

function recordOf(
  index: number,
  overrides: Partial<ReportSubmissionRecord> = {},
): ReportSubmissionRecord {
  return {
    reportId: reportIdOf(index),
    newCaseId: caseIdOf(index),
    target: {
      kind: 'product',
      targetId: PRODUCT_ID,
      ownerUserId: OWNER_ID,
      productId: PRODUCT_ID,
    },
    reporterUserId: userIdOf(REPORTER_INDEX),
    contactEmail: null,
    categoryId: REPORT_CATEGORY_OTHER_ID,
    reason: '規約に反する宣伝です',
    infringement: false,
    at: after(index * 1000),
    ...overrides,
  };
}

function infringementRecordOf(
  index: number,
  overrides: Partial<ReportSubmissionRecord> = {},
): ReportSubmissionRecord {
  return recordOf(index, {
    categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
    infringement: true,
    ...overrides,
  });
}

function caseRowOf(
  overrides: Partial<typeof reportCases.$inferInsert> = {},
): typeof reportCases.$inferInsert {
  return {
    id: caseIdOf(90),
    targetKind: 'product',
    targetId: PRODUCT_ID,
    targetOwnerUserId: OWNER_ID,
    productId: PRODUCT_ID,
    statusChangedAt: T0,
    lastReportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function createStore(): ReportSubmissionStore {
  return new D1ReportSubmissionStore(db);
}

async function readCases() {
  return db.select().from(reportCases).orderBy(asc(reportCases.id));
}

async function readReports() {
  return db.select().from(reports).orderBy(asc(reports.id));
}

async function caseIdsOfReports(): Promise<string[]> {
  return (await readReports()).map((row) => row.caseId);
}

async function columnNamesOf(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'select name from pragma_table_info(?1)',
  )
    .bind(table)
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

beforeEach(async () => {
  await db.delete(reports);
  await db.delete(reportCases);
  await db
    .delete(reportCategories)
    .where(ne(reportCategories.systemDefault, true));
  await clearIdentityTables();
  await insertUser(REPORTER_INDEX);
  await insertUser(SECOND_REPORTER_INDEX);
});

describe('D1ReportSubmissionStore', () => {
  describe('submit', () => {
    test('対象に案件が無ければ、通報と未対応の新しい案件を1つの一括の書き込みの2文で確定する', async () => {
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1ReportSubmissionStore(createDatabase(recording.d1));

      await expect(store.submit(recordOf(1))).resolves.toBe('accepted');

      expect(recording.batches).toHaveLength(1);
      expect(recording.batches[0]).toHaveLength(2);
      expect(recording.statementsOutsideBatches()).toEqual([]);
      await expect(readCases()).resolves.toEqual([
        {
          id: caseIdOf(1),
          targetKind: 'product',
          targetId: PRODUCT_ID,
          targetOwnerUserId: OWNER_ID,
          productId: PRODUCT_ID,
          targetDetachedAt: null,
          status: 'open',
          statusChangedAt: after(1000),
          lastReportedAt: after(1000),
          infringementReportedAt: null,
          closedAt: null,
          resolution: null,
          resolutionActionId: null,
          closingReason: null,
          posterNoticeStatus: 'none',
          posterNoticeRequestedAt: null,
          lastInquiredAt: null,
          lastInquiryMessage: null,
          createdAt: after(1000),
          updatedAt: after(1000),
        },
      ]);
      await expect(readReports()).resolves.toEqual([
        {
          id: reportIdOf(1),
          caseId: caseIdOf(1),
          reporterUserId: userIdOf(REPORTER_INDEX),
          contactEmail: null,
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: REPORT_CATEGORY_OTHER_NAME,
          reason: '規約に反する宣伝です',
          reportedAt: after(1000),
          outcomeNoticeStatus: 'none',
          outcomeNoticeRequestedAt: null,
          createdAt: after(1000),
          updatedAt: after(1000),
          deletedAt: null,
        },
      ]);
    });

    test('ユーザーの対象の案件は投稿者を本人にし、プロダクトを持たない', async () => {
      await createStore().submit(
        recordOf(1, {
          target: {
            kind: 'user',
            targetId: OWNER_ID,
            ownerUserId: OWNER_ID,
            productId: null,
          },
        }),
      );

      await expect(readCases()).resolves.toMatchObject([
        {
          targetKind: 'user',
          targetId: OWNER_ID,
          targetOwnerUserId: OWNER_ID,
          productId: null,
        },
      ]);
    });

    test('未ログインの通報は通報者を記録せず、連絡先のメールアドレスを保存する', async () => {
      await createStore().submit(
        infringementRecordOf(1, {
          reporterUserId: null,
          contactEmail: 'guest@mail.example',
        }),
      );

      await expect(readReports()).resolves.toMatchObject([
        {
          reporterUserId: null,
          contactEmail: 'guest@mail.example',
          categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
        },
      ]);
    });

    test.each(['open', 'in_progress'] as const)(
      '同じ対象の%sの案件があれば、新しい案件を作らずその案件へ集約し、最後の受付日時を更新する',
      async (status) => {
        const store = createStore();
        await store.submit(recordOf(1));
        await db
          .update(reportCases)
          .set({ status })
          .where(eq(reportCases.id, caseIdOf(1)));

        await expect(
          store.submit(
            recordOf(2, { reporterUserId: userIdOf(SECOND_REPORTER_INDEX) }),
          ),
        ).resolves.toBe('accepted');

        const cases = await readCases();
        expect(cases).toHaveLength(1);
        expect(cases[0]).toMatchObject({
          id: caseIdOf(1),
          status,
          statusChangedAt: after(1000),
          lastReportedAt: after(2000),
          createdAt: after(1000),
          updatedAt: after(2000),
        });
        await expect(caseIdsOfReports()).resolves.toEqual([
          caseIdOf(1),
          caseIdOf(1),
        ]);
      },
    );

    test.each(['resolved', 'rejected'] as const)(
      '同じ対象の案件が%sなら、その案件を変えずに未対応の新しい案件を作る',
      async (status) => {
        const closed = caseRowOf({
          status,
          closedAt: after(500),
          resolution: status === 'resolved' ? 'none' : null,
          closingReason: '対応しました',
        });
        await db.insert(reportCases).values(closed);
        const [before] = await readCases();

        await expect(createStore().submit(recordOf(1))).resolves.toBe(
          'accepted',
        );

        const cases = await readCases();
        expect(cases).toHaveLength(2);
        expect(cases.find((row) => row.id === caseIdOf(90))).toEqual(before);
        expect(cases.find((row) => row.id === caseIdOf(1))).toMatchObject({
          status: 'open',
          closedAt: null,
          lastReportedAt: after(1000),
        });
        await expect(caseIdsOfReports()).resolves.toEqual([caseIdOf(1)]);
      },
    );

    test('同じ対象への同時の2件の通報は、1つの案件へ集約する', async () => {
      const store = createStore();

      await expect(
        Promise.all([
          store.submit(recordOf(1)),
          store.submit(
            recordOf(2, { reporterUserId: userIdOf(SECOND_REPORTER_INDEX) }),
          ),
        ]),
      ).resolves.toEqual(['accepted', 'accepted']);

      const cases = await readCases();
      expect(cases).toHaveLength(1);
      const [onlyCase] = cases;
      expect(onlyCase?.lastReportedAt).toEqual(after(2000));
      await expect(caseIdsOfReports()).resolves.toEqual([
        onlyCase?.id,
        onlyCase?.id,
      ]);
    });

    test('対象への参照を消した未完了の案件とは衝突せず、同じ対象の種類の新しい案件を作る', async () => {
      const detached = caseRowOf({
        targetId: null,
        targetOwnerUserId: null,
        productId: null,
        targetDetachedAt: after(500),
      });
      await db.insert(reportCases).values(detached);
      const [before] = await readCases();

      await expect(createStore().submit(recordOf(1))).resolves.toBe('accepted');

      const cases = await readCases();
      expect(cases).toHaveLength(2);
      expect(cases.find((row) => row.id === caseIdOf(90))).toEqual(before);
      expect(cases.find((row) => row.id === caseIdOf(1))).toMatchObject({
        targetKind: 'product',
        targetId: PRODUCT_ID,
        status: 'open',
      });
      await expect(caseIdsOfReports()).resolves.toEqual([caseIdOf(1)]);
    });

    test('別の対象への通報は、それぞれの案件へ集約する', async () => {
      const store = createStore();
      await store.submit(recordOf(1));

      await store.submit(
        recordOf(2, {
          target: {
            kind: 'product',
            targetId: OTHER_PRODUCT_ID,
            ownerUserId: OWNER_ID,
            productId: OTHER_PRODUCT_ID,
          },
        }),
      );
      await store.submit(recordOf(3));

      await expect(caseIdsOfReports()).resolves.toEqual([
        caseIdOf(1),
        caseIdOf(2),
        caseIdOf(1),
      ]);
    });

    test('受付時点のカテゴリ名を保存し、後でカテゴリの名前を変えても変わらない', async () => {
      await db.insert(reportCategories).values({
        id: CUSTOM_CATEGORY_ID,
        name: 'スパム',
        createdAt: T0,
        updatedAt: T0,
      });
      await createStore().submit(
        recordOf(1, { categoryId: CUSTOM_CATEGORY_ID }),
      );

      await db
        .update(reportCategories)
        .set({ name: '迷惑な宣伝' })
        .where(eq(reportCategories.id, CUSTOM_CATEGORY_ID));

      await expect(readReports()).resolves.toMatchObject([
        { categoryId: CUSTOM_CATEGORY_ID, categoryName: 'スパム' },
      ]);
    });

    test('権利侵害の通報で作った案件は、その受付日時を権利侵害の起点にする', async () => {
      await createStore().submit(infringementRecordOf(1));

      await expect(readCases()).resolves.toMatchObject([
        { id: caseIdOf(1), infringementReportedAt: after(1000) },
      ]);
    });

    test('権利侵害の起点は最初の権利侵害の通報の受付日時で、後の通報で変わらない', async () => {
      const store = createStore();
      await store.submit(recordOf(1));
      await expect(readCases()).resolves.toMatchObject([
        { infringementReportedAt: null },
      ]);

      await store.submit(infringementRecordOf(2));
      await store.submit(infringementRecordOf(3));
      await store.submit(recordOf(4));

      await expect(readCases()).resolves.toMatchObject([
        {
          id: caseIdOf(1),
          infringementReportedAt: after(2000),
          lastReportedAt: after(4000),
        },
      ]);
    });

    test('先に時刻を読んだ通報が後で確定しても、最後の受付日時を古い時刻へ戻さない', async () => {
      const store = createStore();
      await store.submit(recordOf(2));

      await store.submit(recordOf(1));

      await expect(readCases()).resolves.toMatchObject([
        { id: caseIdOf(2), lastReportedAt: after(2000) },
      ]);
      await expect(readReports()).resolves.toMatchObject([
        { id: reportIdOf(1), caseId: caseIdOf(2), reportedAt: after(1000) },
        { id: reportIdOf(2), caseId: caseIdOf(2), reportedAt: after(2000) },
      ]);
    });

    test('カテゴリが同時に削除されていれば、案件を作らず何も残さずにカテゴリの不在を返す', async () => {
      await expect(
        createStore().submit(recordOf(1, { categoryId: MISSING_CATEGORY_ID })),
      ).resolves.toBe('category-missing');

      await expect(readCases()).resolves.toEqual([]);
      await expect(readReports()).resolves.toEqual([]);
    });

    test('カテゴリが同時に削除されていれば、未完了の案件の最後の受付日時と権利侵害の起点を変えない', async () => {
      const store = createStore();
      await store.submit(recordOf(1));
      const before = await readCases();

      await expect(
        store.submit(
          recordOf(2, { categoryId: MISSING_CATEGORY_ID, infringement: true }),
        ),
      ).resolves.toBe('category-missing');

      await expect(readCases()).resolves.toEqual(before);
      await expect(readReports()).resolves.toHaveLength(1);
    });

    test('カテゴリの不在以外の失敗はそのまま投げ、案件を残さない', async () => {
      const store = createStore();
      await store.submit(recordOf(1));

      await expect(
        store.submit(
          recordOf(2, {
            reportId: reportIdOf(1),
            target: {
              kind: 'product',
              targetId: OTHER_PRODUCT_ID,
              ownerUserId: OWNER_ID,
              productId: OTHER_PRODUCT_ID,
            },
          }),
        ),
      ).rejects.toBeInstanceOf(Error);

      await expect(readCases()).resolves.toMatchObject([{ id: caseIdOf(1) }]);
      await expect(readReports()).resolves.toHaveLength(1);
    });

    test('通報と案件のテーブルに送信元IPアドレスの列が無い', async () => {
      const columns = [
        ...(await columnNamesOf('reports')),
        ...(await columnNamesOf('report_cases')),
      ];

      expect(columns).not.toHaveLength(0);
      expect(
        columns.filter((name) => /(^|_)ip(_|$)|address/u.test(name)),
      ).toEqual([]);
    });
  });
});

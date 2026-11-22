import { eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import { reportCategories } from '../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import {
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/reporting/report-rules.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type { ProductDirectory } from '../../core/product/ports.ts';
import type { UserProfileDirectory } from '../../core/profile/ports.ts';
import type { ReportExport } from '../../core/reporting/ports.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import { D1UserProfileDirectory } from '../profile/d1-user-profile-directory.ts';
import { D1ReportExport } from './d1-report-export.ts';
import {
  clearReportingState,
  commentIdOf,
  daysBefore,
  db,
  detachedColumnsAt,
  guestReportOf,
  insertReporters,
  memberReportOf,
  openProductCaseOf,
  productIdOf,
  reportIdOf,
  reporterIdOf,
  seed,
  T0,
} from './testing/report-erasure-fixtures.ts';

const PRODUCT_ID_PREFIX = '01JE0PRDT';

const CUSTOM_CATEGORY_ID = '01JE0CATG00000000000000001';

const REPORTER = reporterIdOf(1);

interface DirectoryCalls {
  readonly users: { ids: readonly string[]; scope: string }[];
  readonly products: { ids: readonly string[]; scope: string }[];
}

function createExport(): { exporter: ReportExport; calls: DirectoryCalls } {
  const profiles = new D1UserProfileDirectory(db);
  const productDirectory = new D1ProductDirectory(db);
  const calls: DirectoryCalls = { users: [], products: [] };
  const recordingProfiles: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.users.push({ ids: [...ids], scope });
      return profiles.findSummaries(ids, scope);
    },
    resolveHandle: (handle) => profiles.resolveHandle(handle),
  };
  const recordingProducts: ProductDirectory = {
    findSummaries: (ids, scope) => {
      calls.products.push({ ids: [...ids], scope });
      return productDirectory.findSummaries(ids, scope);
    },
    resolveHandle: (handle) => productDirectory.resolveHandle(handle),
    findDetail: (productId) => productDirectory.findDetail(productId),
    listLaunches: (ids, now) => productDirectory.listLaunches(ids, now),
  };
  return {
    exporter: new D1ReportExport(db, recordingProfiles, recordingProducts),
    calls,
  };
}

const { exporter } = createExport();

async function insertTargetProduct(
  index: number,
  ownerIndex: number,
  columns: Partial<typeof products.$inferInsert> = {},
): Promise<void> {
  await db.insert(products).values({
    id: productIdOf(index),
    userId: reporterIdOf(ownerIndex),
    categoryId: PRODUCT_CATEGORY_OTHER_ID,
    handle: `reported-product${String(index)}`,
    name: `通報されたプロダクト${String(index)}`,
    tagline: `タグライン${String(index)}`,
    websiteUrl: `https://product${String(index)}.example/`,
    descriptionMarkdown: `説明文${String(index)}`,
    logoFileId: `01JE010G0${String(index).padStart(17, '0')}`,
    latestLaunchDate: '2026-11-20',
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

function userCaseOf(index: number, userIndex: number) {
  return openProductCaseOf(index, {
    targetKind: 'user',
    targetId: reporterIdOf(userIndex),
    targetOwnerUserId: reporterIdOf(userIndex),
    productId: null,
  });
}

function productCaseOf(index: number, productIndex: number) {
  return openProductCaseOf(index, {
    targetId: productIdOf(productIndex),
    targetOwnerUserId: reporterIdOf(2),
    productId: productIdOf(productIndex),
  });
}

function commentCaseOf(index: number, commentIndex: number) {
  return openProductCaseOf(index, {
    targetKind: 'comment',
    targetId: commentIdOf(commentIndex),
    targetOwnerUserId: reporterIdOf(2),
    productId: productIdOf(1),
  });
}

async function refsOf(): Promise<(string | null)[]> {
  const page = await exporter.listPage({ userId: REPORTER, limit: 20 });
  return page.records.map((record) => record.targetRef);
}

beforeEach(async () => {
  await db.delete(reports);
  await db.delete(products).where(like(products.id, `${PRODUCT_ID_PREFIX}%`));
  await clearReportingState();
  await db
    .delete(reportCategories)
    .where(eq(reportCategories.id, CUSTOM_CATEGORY_ID));
  await insertReporters([1, 2, 3]);
});

describe('D1ReportExportの項目', () => {
  test('通報のID・対象の種類・対象の参照・受付時点のカテゴリ名・理由・受付日時だけを返し、対応ステータスと連絡先を含めない', async () => {
    const reportedAt = daysBefore(2);
    await seed(
      [
        userCaseOf(1, 2),
        openProductCaseOf(2, {
          targetKind: 'user',
          targetId: reporterIdOf(3),
          targetOwnerUserId: reporterIdOf(3),
          productId: null,
          status: 'resolved',
          statusChangedAt: T0,
          closedAt: T0,
          resolution: 'none',
          closingReason: '管理者の判断の理由',
        }),
      ],
      [
        memberReportOf(1, 1, 1, {
          reason: '迷惑な投稿を繰り返している',
          reportedAt,
          outcomeNoticeStatus: 'requested',
        }),
        memberReportOf(2, 2, 1),
      ],
    );

    const page = await exporter.listPage({ userId: REPORTER, limit: 20 });

    expect(page).toEqual({
      records: [
        {
          id: reportIdOf(1),
          targetType: 'user',
          targetRef: 'reporter2',
          category: REPORT_CATEGORY_OTHER_NAME,
          reason: '迷惑な投稿を繰り返している',
          createdAt: reportedAt,
        },
        {
          id: reportIdOf(2),
          targetType: 'user',
          targetRef: 'reporter3',
          category: REPORT_CATEGORY_OTHER_NAME,
          reason: '申出者の理由2',
          createdAt: T0,
        },
      ],
      nextAfter: null,
    });
  });

  test('カテゴリの名前の変更と「その他」への付け替えの後も受付時点のカテゴリ名を返す', async () => {
    await db.insert(reportCategories).values({
      id: CUSTOM_CATEGORY_ID,
      name: 'スパム',
      createdAt: T0,
      updatedAt: T0,
    });
    await seed(
      [userCaseOf(1, 2)],
      [
        memberReportOf(1, 1, 1, {
          categoryId: CUSTOM_CATEGORY_ID,
          categoryName: 'スパム',
        }),
      ],
    );

    await db
      .update(reportCategories)
      .set({ name: '宣伝のスパム' })
      .where(eq(reportCategories.id, CUSTOM_CATEGORY_ID));
    const renamed = await exporter.listPage({ userId: REPORTER, limit: 20 });
    await db
      .update(reports)
      .set({ categoryId: REPORT_CATEGORY_OTHER_ID })
      .where(eq(reports.categoryId, CUSTOM_CATEGORY_ID));
    const reassigned = await exporter.listPage({ userId: REPORTER, limit: 20 });

    expect(renamed.records.map((record) => record.category)).toEqual([
      'スパム',
    ]);
    expect(reassigned.records.map((record) => record.category)).toEqual([
      'スパム',
    ]);
  });
});

describe('D1ReportExportの対象の参照', () => {
  test('ユーザーとプロダクトは現在のハンドル、コメントはコメントのIDを返す', async () => {
    await insertTargetProduct(1, 2);
    await seed(
      [userCaseOf(1, 2), productCaseOf(2, 1), commentCaseOf(3, 7)],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 2, 1),
        memberReportOf(3, 3, 1),
      ],
    );
    await db
      .update(users)
      .set({ handle: 'renamed-user' })
      .where(eq(users.id, reporterIdOf(2)));
    await db
      .update(products)
      .set({ handle: 'renamed-product' })
      .where(eq(products.id, productIdOf(1)));

    const page = await exporter.listPage({ userId: REPORTER, limit: 20 });

    expect(
      page.records.map(({ targetType, targetRef }) => ({
        targetType,
        targetRef,
      })),
    ).toEqual([
      { targetType: 'user', targetRef: 'renamed-user' },
      { targetType: 'product', targetRef: 'renamed-product' },
      { targetType: 'comment', targetRef: commentIdOf(7) },
    ]);
  });

  test('停止中の利用者と非公開化したプロダクトはハンドルを返す', async () => {
    await insertTargetProduct(1, 2, { hiddenAt: T0 });
    await db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.id, reporterIdOf(2)));
    await seed(
      [userCaseOf(1, 2), productCaseOf(2, 1)],
      [memberReportOf(1, 1, 1), memberReportOf(2, 2, 1)],
    );

    expect(await refsOf()).toEqual(['reporter2', 'reported-product1']);
  });

  test('退会した利用者・物理削除した利用者・論理削除したプロダクト・物理削除したプロダクトはnullを返す', async () => {
    await insertTargetProduct(1, 2, { deletedAt: T0 });
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(eq(users.id, reporterIdOf(3)));
    await seed(
      [
        userCaseOf(1, 3),
        openProductCaseOf(2, {
          targetKind: 'user',
          targetId: reporterIdOf(9),
          targetOwnerUserId: reporterIdOf(9),
          productId: null,
        }),
        productCaseOf(3, 1),
        productCaseOf(4, 9),
      ],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 2, 1),
        memberReportOf(3, 3, 1),
        memberReportOf(4, 4, 1),
      ],
    );

    expect(await refsOf()).toEqual([null, null, null, null]);
  });

  test('対象への参照を消した案件の通報は、ユーザー・プロダクト・コメントのどれでもnullを返す', async () => {
    const detached = detachedColumnsAt(daysBefore(1));
    await seed(
      [
        openProductCaseOf(1, { targetKind: 'user', ...detached }),
        openProductCaseOf(2, detached),
        openProductCaseOf(3, { targetKind: 'comment', ...detached }),
      ],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 2, 1),
        memberReportOf(3, 3, 1),
      ],
    );

    const page = await exporter.listPage({ userId: REPORTER, limit: 20 });

    expect(
      page.records.map(({ id, targetType, targetRef }) => ({
        id,
        targetType,
        targetRef,
      })),
    ).toEqual([
      { id: reportIdOf(1), targetType: 'user', targetRef: null },
      { id: reportIdOf(2), targetType: 'product', targetRef: null },
      { id: reportIdOf(3), targetType: 'comment', targetRef: null },
    ]);
  });

  test('ハンドルは1ページにつき利用者は退会を除く範囲、プロダクトは論理削除を除く範囲で各1回だけ引く', async () => {
    await insertTargetProduct(1, 2);
    await seed(
      [userCaseOf(1, 2), productCaseOf(2, 1), commentCaseOf(3, 7)],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 1, 1),
        memberReportOf(3, 2, 1),
        memberReportOf(4, 2, 1),
        memberReportOf(5, 3, 1),
      ],
    );
    const { exporter: recorded, calls } = createExport();

    await recorded.listPage({ userId: REPORTER, limit: 20 });

    expect(calls.users).toHaveLength(1);
    expect(calls.users[0]?.scope).toBe('not-withdrawn');
    expect(new Set(calls.users[0]?.ids)).toEqual(new Set([reporterIdOf(2)]));
    expect(calls.products).toHaveLength(1);
    expect(calls.products[0]?.scope).toBe('not-deleted');
    expect(new Set(calls.products[0]?.ids)).toEqual(new Set([productIdOf(1)]));
  });

  test('ハンドルを引く対象が無いページでは上流を呼ばない', async () => {
    await seed([commentCaseOf(1, 7)], [memberReportOf(1, 1, 1)]);
    const { exporter: recorded, calls } = createExport();

    await recorded.listPage({ userId: REPORTER, limit: 20 });

    expect(calls.users).toEqual([]);
    expect(calls.products).toEqual([]);
  });
});

describe('D1ReportExportの対象の通報', () => {
  test('論理削除した通報・他の利用者の通報・未ログインの通報を返さない', async () => {
    await seed(
      [userCaseOf(1, 2)],
      [
        memberReportOf(1, 1, 1),
        memberReportOf(2, 1, 1, { deletedAt: T0 }),
        memberReportOf(3, 1, 3),
        guestReportOf(4, 1),
      ],
    );

    const page = await exporter.listPage({ userId: REPORTER, limit: 20 });

    expect(page.records.map((record) => record.id)).toEqual([reportIdOf(1)]);
  });

  test('通報が無ければ空のページを返す', async () => {
    await expect(
      exporter.listPage({ userId: REPORTER, limit: 20 }),
    ).resolves.toEqual({ records: [], nextAfter: null });
  });
});

describe('D1ReportExportのページ', () => {
  beforeEach(async () => {
    await seed(
      [userCaseOf(1, 2)],
      [
        memberReportOf(3, 1, 1),
        memberReportOf(1, 1, 1),
        memberReportOf(5, 1, 1),
        memberReportOf(2, 1, 1),
        memberReportOf(4, 1, 1),
      ],
    );
  });

  test('IDの昇順に上限の件数ずつ返し、続きがあれば最後のIDを続きの位置にする', async () => {
    const first = await exporter.listPage({ userId: REPORTER, limit: 2 });
    const second = await exporter.listPage({
      userId: REPORTER,
      after: first.nextAfter ?? undefined,
      limit: 2,
    });
    const third = await exporter.listPage({
      userId: REPORTER,
      after: second.nextAfter ?? undefined,
      limit: 2,
    });

    expect(first.records.map((record) => record.id)).toEqual([
      reportIdOf(1),
      reportIdOf(2),
    ]);
    expect(first.nextAfter).toBe(reportIdOf(2));
    expect(second.records.map((record) => record.id)).toEqual([
      reportIdOf(3),
      reportIdOf(4),
    ]);
    expect(second.nextAfter).toBe(reportIdOf(4));
    expect(third.records.map((record) => record.id)).toEqual([reportIdOf(5)]);
    expect(third.nextAfter).toBeNull();
  });

  test('残りがちょうど上限の件数なら続きの位置をnullにする', async () => {
    const page = await exporter.listPage({
      userId: REPORTER,
      after: reportIdOf(3),
      limit: 2,
    });

    expect(page.records.map((record) => record.id)).toEqual([
      reportIdOf(4),
      reportIdOf(5),
    ]);
    expect(page.nextAfter).toBeNull();
  });

  test('ULIDでない続きの位置はページの位置の指定の誤りにする', async () => {
    const result = exporter.listPage({
      userId: REPORTER,
      after: 'not-a-cursor',
      limit: 2,
    });

    await expect(result).rejects.toBeInstanceOf(AppError);
    await expect(result).rejects.toMatchObject({ code: 'invalid_cursor' });
  });
});

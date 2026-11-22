import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';

import {
  REPORT_CATEGORIES_TITLE,
  reportCategoryDeleteDescription,
} from '../../apps/admin/src/components/reporting/categories/report-category-messages.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../apps/common-lib/reporting/report-rules.ts';
import {
  AUDITED_ACTION_NOTICE,
  CATEGORY_DELETE_LABEL,
  CATEGORY_EDIT_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import { openEngagementProductPage } from '../client/engagement-steps.ts';
import {
  openProductReportForm,
  submitReportForm,
} from '../client/report-steps.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { createListedProducts } from '../support/directory-fixtures.ts';
import {
  findOpenReportCaseId,
  readReportCaseState,
} from '../support/report-fixtures.ts';
import {
  CATEGORIES_PATH,
  categoryRowAction,
  categoryRows,
  createCategory,
  openCategoryDeletionAfterReload,
} from './category-steps.ts';
import { expect, test } from './client-page-test.ts';
import {
  expectReportCaseBreakdown,
  openReportCaseDetail,
} from './report-case-steps.ts';

// 管理者の用意に、利用者側の通報の送信(bot判定の待ちを含む)と案件の詳細の確認の分を足す
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 2 });

const STANDARD_CATEGORY_NAMES = Object.freeze([
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_NAME,
]);

const suffixOf = (): string => randomBytes(4).toString('hex');

// 標準カテゴリにも共通のカテゴリの編集の操作は出るが、削除の操作は出ない
async function expectStandardCategoriesProtected(page: Page): Promise<void> {
  for (const name of STANDARD_CATEGORY_NAMES) {
    await expect(
      categoryRows(page, REPORT_CATEGORIES_TITLE).filter({ hasText: name }),
    ).toHaveCount(1);
    await expect(
      categoryRowAction(
        page,
        REPORT_CATEGORIES_TITLE,
        name,
        CATEGORY_EDIT_LABEL,
      ),
    ).toBeVisible();
    await expect(
      categoryRowAction(
        page,
        REPORT_CATEGORIES_TITLE,
        name,
        CATEGORY_DELETE_LABEL,
      ),
    ).toHaveCount(0);
  }
}

// 付け替える件数は区画の表示の時点で取得するため、通報を送った後にページを読み込み直してから削除の確認を開く
async function deleteCategoryAfterReload(
  page: Page,
  name: string,
  reportCount: number,
): Promise<void> {
  const dialog = await openCategoryDeletionAfterReload(
    page,
    REPORT_CATEGORIES_TITLE,
    name,
  );
  await expect(dialog).toContainText(
    reportCategoryDeleteDescription(reportCount),
  );
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  await dialog
    .getByRole('button', { name: CATEGORY_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    categoryRows(page, REPORT_CATEGORIES_TITLE).filter({ hasText: name }),
  ).toHaveCount(0);
}

// カテゴリ名・プロダクトは実行のたびに乱数の接尾辞で別に作り、追加したカテゴリはテストの中で削除する
test.describe('通報カテゴリの管理', () => {
  test('モデレーターが追加したカテゴリが利用者側の通報のダイアログに出て、そのカテゴリの通報の後に削除すると案件の内訳が「その他」に付け替わり、標準カテゴリには削除の操作が無い', async ({
    page,
    clientPage,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openFromAdminNavigation(page, admin, CATEGORIES_PATH);
    const categoryName = `E2E通報${suffixOf()}`;
    await createCategory(page, REPORT_CATEGORIES_TITLE, { name: categoryName });
    await expectStandardCategoriesProtected(page);

    const {
      products: [product],
    } = await createListedProducts({ count: 1 });
    if (product === undefined) {
      throw new Error('掲載中のプロダクトを作れませんでした');
    }
    await openEngagementProductPage(clientPage, product);
    const form = await openProductReportForm(clientPage);
    await expect(
      form.getByRole('radio', { name: categoryName, exact: true }),
    ).toBeVisible();
    await submitReportForm(clientPage, form, {
      categoryName,
      reason: `E2Eの追加したカテゴリの通報${suffixOf()}です。`,
    });

    const caseId = await findOpenReportCaseId({
      kind: 'product',
      productHandle: product.handle,
    });
    await openReportCaseDetail(page, caseId);
    await expectReportCaseBreakdown(page, [{ name: categoryName, count: 1 }]);

    await deleteCategoryAfterReload(page, categoryName, 1);
    await expectStandardCategoriesProtected(page);

    await openReportCaseDetail(page, caseId);
    await expectReportCaseBreakdown(page, [
      { name: REPORT_CATEGORY_OTHER_NAME, count: 1 },
    ]);
    // 通報の行のカテゴリ名は受付時点の名前のまま残り、付け替わるのはカテゴリのIDである
    expect((await readReportCaseState(caseId)).reports).toStrictEqual([
      expect.objectContaining({
        categoryId: REPORT_CATEGORY_OTHER_ID,
        categoryName,
      }),
    ]);
  });
});

import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';

import { HELP_CATEGORIES_TITLE } from '../../../apps/admin/src/components/help/help-messages.ts';
import { REPORT_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/reporting/report-rules.ts';
import { CATEGORY_DELETE_LABEL } from '../../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  createJourneyArticleInput,
  deleteHelpArticlesAndCategory,
  type HelpJourneyRecord,
  publishJourneyArticle,
} from '../../client/regression/account-journey-steps.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  expectDashboard,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../../support/admin-bootstrap.ts';
import { KeyboardOperator } from '../../support/keyboard-operator.ts';
import { createModerationTargets } from '../../support/moderation-fixtures.ts';
import { createReport } from '../../support/report-fixtures.ts';
import {
  CATEGORIES_PATH,
  categoryRows,
  createCategory,
  openCategoryDeletionAfterReload,
} from '../category-steps.ts';
import { expect, test as adminTest } from '../admin-test.ts';
import {
  expectReportCaseStatus,
  openReportCaseDetail,
} from '../report-case-steps.ts';
import {
  logInByKeyboard,
  logOutByKeyboard,
  openFromNavigationByKeyboard,
  rejectCommentReportByKeyboard,
  startReportCaseProgressByKeyboard,
  suspendUserByKeyboard,
} from './keyboard-admin-steps.ts';
import {
  reorderHelpArticlesByKeyboard,
  reorderHelpCategoriesByKeyboard,
} from './keyboard-help-steps.ts';

const SUFFIX_BYTES = 4;

const uniqueName = (label: string): string =>
  `E2Eキーボードの${label}${randomBytes(SUFFIX_BYTES).toString('hex')}`;

const PROGRESS_REASON = 'E2Eのキーボード操作の確認のため、対応を始めます。';

const REJECT_REASON = 'E2Eのキーボード操作の確認のため、通報を却下します。';

const SUSPEND_REASON = 'E2Eのキーボード操作の確認のための停止です。';

const test = adminTest.extend<{ readonly helpRecord: HelpJourneyRecord }>({
  helpRecord: async ({ page }, use) => {
    const record: HelpJourneyRecord = {
      adminPage: page,
      categoryName: undefined,
      articles: [],
    };
    try {
      await use(record);
    } finally {
      await deleteHelpArticlesAndCategory(record);
    }
  },
});

// 管理者の招待の完了に、ログアウトとログインのやり直し、データの用意、確認のダイアログの操作の分を足す
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 3 });

// 作成の途中で失敗した場合に備え、カテゴリが残っている時だけ削除する
async function deleteHelpCategoryIfPresent(
  page: Page,
  name: string,
): Promise<void> {
  await page.goto(CATEGORIES_PATH);
  const rows = categoryRows(page, HELP_CATEGORIES_TITLE);
  await expect(rows.first()).toBeVisible();
  if ((await rows.filter({ hasText: name }).count()) === 0) {
    return;
  }
  const dialog = await openCategoryDeletionAfterReload(
    page,
    HELP_CATEGORIES_TITLE,
    name,
  );
  await dialog
    .getByRole('button', { name: CATEGORY_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

// 操作の対象は実行のたびに乱数の接尾辞で別に作る。ヘルプのカテゴリと記事は終わりに削除する
test.describe('管理者側のキーボード操作', () => {
  test('ログアウトしたモデレーターが、メールアドレス・パスワード・認証コードをキーボードだけで入力してログインでき、ダッシュボードのTabの移動が先へ進む', async ({
    page,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    const operator = new KeyboardOperator(page);

    await logOutByKeyboard(operator, admin);
    await logInByKeyboard(operator, admin);

    await expectDashboard(page, admin);
    await operator.expectTabAdvancesThroughPage('ダッシュボード');
  });

  test('モデレーターが、通報の案件の対応ステータスの変更と却下を、選択の部品・確認のダイアログ・Escapeを含めキーボードだけで操作できる', async ({
    page,
  }) => {
    const targets = await createModerationTargets();
    const reporter = targets.ratings[0]?.rater;
    if (reporter === undefined) {
      throw new Error('補助の既定の評価者がいません');
    }
    const { caseId } = await createReport({
      target: { kind: 'comment', commentId: targets.comment.commentId },
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reporter: { kind: 'member', email: reporter.email },
    });
    await signInAsNewAdmin(page, { role: 'moderator' });
    await openReportCaseDetail(page, caseId);
    const operator = new KeyboardOperator(page);

    await expectReportCaseStatus(page, 'open');
    await startReportCaseProgressByKeyboard(operator, PROGRESS_REASON);
    await expectReportCaseStatus(page, 'in_progress');
    await rejectCommentReportByKeyboard(
      operator,
      targets.productName,
      REJECT_REASON,
    );

    await expectReportCaseStatus(page, 'rejected');
    await operator.expectTabAdvancesThroughPage('通報の案件の詳細');
  });

  test('モデレーターが、管理メニューから開いたユーザーの一覧で、ハンドルの絞り込みと停止の確認のダイアログ(Escapeで閉じるのを含む)をキーボードだけで操作して利用者を停止できる', async ({
    page,
  }) => {
    const targets = await createModerationTargets();
    const { product } = targets;
    await signInAsNewAdmin(page, { role: 'moderator' });
    const operator = new KeyboardOperator(page);

    await openFromNavigationByKeyboard(operator, '/users');
    const row = await suspendUserByKeyboard(
      operator,
      { handle: product.ownerHandle, nickname: product.ownerNickname },
      SUSPEND_REASON,
    );

    await expect(row).toContainText(SUSPEND_REASON);
    await operator.expectTabAdvancesThroughPage('ユーザーの一覧');
  });

  test('モデレーターが、並べ替えの画面でヘルプ記事を上へ・下への移動のボタンで入れ替えて保存でき、移動してもフォーカスが保たれ、両端のボタンが押せず、読み込み直しても並びが保たれる', async ({
    helpRecord,
  }) => {
    const page = helpRecord.adminPage;
    const categoryName = uniqueName('記事のカテゴリ');
    const first = createJourneyArticleInput('K1', categoryName, '1件目の本文');
    const second = createJourneyArticleInput('K2', categoryName, '2件目の本文');

    const moderator = await signInAsNewAdmin(page, { role: 'moderator' });
    helpRecord.categoryName = categoryName;
    await openFromAdminNavigation(page, moderator, CATEGORIES_PATH);
    await createCategory(page, HELP_CATEGORIES_TITLE, { name: categoryName });
    await publishJourneyArticle(helpRecord, first);
    await publishJourneyArticle(helpRecord, second);
    const operator = new KeyboardOperator(page);

    await reorderHelpArticlesByKeyboard(operator, page, categoryName, {
      first: first.title,
      second: second.title,
    });
    await operator.expectTabAdvancesThroughPage('ヘルプ記事の並び順');
  });

  test('モデレーターが、カテゴリの区画の並び順の変更でヘルプのカテゴリを上へ・下へ移して保存でき、移動してもフォーカスが保たれ、両端のボタンが押せない', async ({
    helpRecord,
  }) => {
    const page = helpRecord.adminPage;
    const names = {
      first: uniqueName('カテゴリA'),
      second: uniqueName('カテゴリB'),
    };

    const moderator = await signInAsNewAdmin(page, { role: 'moderator' });
    helpRecord.categoryName = names.first;
    await openFromAdminNavigation(page, moderator, CATEGORIES_PATH);
    await createCategory(page, HELP_CATEGORIES_TITLE, { name: names.first });
    let completed = false;
    try {
      await createCategory(page, HELP_CATEGORIES_TITLE, {
        name: names.second,
      });
      const operator = new KeyboardOperator(page);

      await reorderHelpCategoriesByKeyboard(operator, page, names);
      await operator.expectTabAdvancesThroughPage('カテゴリの一覧');
      completed = true;
    } finally {
      // テストの本体が失敗している時は、後片付けの失敗で元の失敗を隠さない
      await deleteHelpCategoryIfPresent(page, names.second).catch(
        (error: unknown) => {
          if (completed) {
            throw error;
          }
        },
      );
    }
  });
});

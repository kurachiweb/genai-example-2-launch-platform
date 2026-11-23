import { randomBytes } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import {
  openReportCaseDetail,
  expectReportCaseStatus,
} from '../../admin/report-case-steps.ts';
import {
  auditLogRowsOf,
  moderationAuditLogRows,
} from '../../admin/user-moderation-steps.ts';
import { REPORT_RESOLVE_ACTION } from '../../../apps/common-lib/admin/audit-actions/content-reporting.ts';
import { REPORT_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/reporting/report-rules.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../../support/admin-bootstrap.ts';
import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import { createListedProducts } from '../../support/directory-fixtures.ts';
import {
  findOpenReportCaseId,
  readReportCaseState,
} from '../../support/report-fixtures.ts';
import { resolveE2ETargets } from '../../support/targets.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
  type TestAccount,
} from '../auth/account-steps.ts';
import { expect, test as base } from '../auth/auth-test.ts';
import {
  commentArticleOf,
  expectRemovedComment,
  launchCommentsSectionOf,
  openEngagementProductPage,
  postComment,
  readProductComments,
} from '../engagement-steps.ts';
import { registerVerifiedAccount } from '../profile-steps.ts';
import { openCommentReportForm, submitReportForm } from '../report-steps.ts';
import {
  expectCommentHiddenNotice,
  expectCommentReportResolvedNotice,
  hideReportedCommentFromList,
} from './moderation-journey-steps.ts';

interface BrowserPageFixtures {
  readonly openUserPage: () => Promise<Page>;
  readonly openAdminPage: () => Promise<Page>;
}

const baseURLOf = (name: 'client' | 'admin'): string => {
  const target = resolveE2ETargets(process.env).find(
    (candidate) => candidate.name === name,
  );
  if (target === undefined) {
    throw new Error(`${name}のE2E対象が定義されていません`);
  }
  return target.baseURL;
};

// 利用者2人と管理者を並べる流れのため、呼ぶたびに別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
const test = base.extend<BrowserPageFixtures>({
  openUserPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = baseURLOf('client');
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  openAdminPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = baseURLOf('admin');
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

// 2人の登録のメールの待ちと管理者の招待の完了に、通報・措置・2通の通知の待ちを足す
test.describe.configure({
  timeout: ADMIN_FLOW_TIMEOUT_MS + MAIL_FLOW_TIMEOUT_MS * 2 + 120_000,
});

const suffixOf = (): string => randomBytes(4).toString('hex');

// 監査ログと通知に残る理由。個人情報を含めない
const HIDE_REASON = 'E2Eの確認のため、通報されたコメントを非公開にします。';

async function registerUser(page: Page): Promise<TestAccount> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  return account;
}

// 掲載中のプロダクト・利用者・通報は実行のたびに乱数の接尾辞で別に作り、前回の実行のデータを消さないため、後片付けをしない。ローカルのメール受信箱とD1を使うため、@smokeタグを付けない
test.describe('管理者の措置の流れ', () => {
  test('利用者のコメントを別の利用者が通報し、モデレーターが通報の一覧から非公開にすると、利用者側で削除の表示になり、投稿者と申出者へメールが届き、監査ログに記録される', async ({
    page,
    openUserPage,
    openAdminPage,
  }) => {
    const {
      products: [product],
    } = await createListedProducts({ count: 1 });
    if (product === undefined) {
      throw new Error('掲載中のプロダクトを作れませんでした');
    }
    const commenterPage = page;
    const reporterPage = await openUserPage();
    const commenter = await registerUser(commenterPage);
    const reporter = await registerUser(reporterPage);
    const commentBody = `E2Eの措置の対象のコメント${suffixOf()}`;
    const reportReason = `E2Eの申出者の通報の理由${suffixOf()}です。`;

    await openEngagementProductPage(commenterPage, product);
    await postComment(commenterPage, commentBody);
    const comment = (await readProductComments(product.handle)).find((row) =>
      row.body.includes(commentBody),
    );
    if (comment === undefined) {
      throw new Error('投稿したコメントがローカルのD1にありません');
    }

    await openEngagementProductPage(reporterPage, product);
    const reporterComments = launchCommentsSectionOf(reporterPage);
    const reporterArticle = commentArticleOf(
      reporterComments,
      commenter.nickname,
      commentBody,
    );
    await submitReportForm(
      reporterPage,
      await openCommentReportForm(reporterPage, reporterArticle),
      { categoryName: REPORT_CATEGORY_OTHER_NAME, reason: reportReason },
    );
    const caseId = await findOpenReportCaseId({
      kind: 'comment',
      commentId: comment.id,
    });
    expect(await readReportCaseState(caseId)).toMatchObject({
      status: 'open',
    });

    const adminPage = await openAdminPage();
    const admin = await signInAsNewAdmin(adminPage, { role: 'moderator' });
    const hiddenAfter = new Date();
    await hideReportedCommentFromList(adminPage, admin, product, HIDE_REASON);
    expect(await readReportCaseState(caseId)).toMatchObject({
      status: 'resolved',
    });

    await openEngagementProductPage(reporterPage, product);
    await expectRemovedComment(reporterComments);
    await expect(reporterArticle).toHaveCount(0);
    await expect(reporterComments).not.toContainText(commentBody);
    await openEngagementProductPage(commenterPage, product);
    await expectRemovedComment(launchCommentsSectionOf(commenterPage));

    const [posterMail, reporterMail] = await Promise.all([
      expectCommentHiddenNotice(
        commenter.email,
        { productName: product.name, reason: HIDE_REASON },
        hiddenAfter,
      ),
      expectCommentReportResolvedNotice(
        reporter.email,
        { productName: product.name, reason: HIDE_REASON },
        hiddenAfter,
      ),
    ]);
    expect(posterMail.text).not.toContain(reportReason);
    expect(reporterMail.text).toContain(commentBody);

    const resolveLogs = await auditLogRowsOf(
      adminPage,
      admin,
      REPORT_RESOLVE_ACTION.label,
      caseId,
    );
    await expect(resolveLogs).toHaveCount(1);
    await expect(resolveLogs).toContainText(HIDE_REASON);
    const hideLogs = await moderationAuditLogRows(
      adminPage,
      admin,
      'comment.hide',
      comment.id,
    );
    await expect(hideLogs).toHaveCount(1);
    await expect(hideLogs).toContainText(HIDE_REASON);

    await openReportCaseDetail(adminPage, caseId);
    await expectReportCaseStatus(adminPage, 'resolved');
  });
});

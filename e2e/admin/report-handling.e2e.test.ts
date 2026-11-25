import { randomBytes } from 'node:crypto';

import { REPORT_RESOLVE_ACTION } from '../../apps/common-lib/admin/audit-actions/content-reporting.ts';
import { REPORT_CATEGORY_INFRINGEMENT_NAME } from '../../apps/common-lib/reporting/report-rules.ts';
import { expectProductNotFound } from '../client/directory-steps.ts';
import { openEngagementProductPage } from '../client/engagement-steps.ts';
import {
  openProductReportForm,
  submitReportForm,
} from '../client/report-steps.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { createListedProducts } from '../support/directory-fixtures.ts';
import {
  findOpenReportCaseId,
  readReportCaseState,
} from '../support/report-fixtures.ts';
import { TEST_EMAIL_DOMAIN } from '../support/test-email.ts';
import { expect, test } from './client-page-test.ts';
import {
  expectHiddenProductDetail,
  expectProductHiddenNotice,
  openAdminProductDetail,
} from './product-moderation-steps.ts';
import {
  expectInfringementInquiryNotice,
  expectInfringementInquiryShown,
  expectProductReportsSection,
  expectReportCaseStatus,
  expectResolvedNotice,
  hideProductToResolveReportCase,
  openReportCaseFromInfringementList,
  readUnhandledReportCounts,
  sendInfringementInquiry,
  startReportCaseProgress,
} from './report-case-steps.ts';
import {
  auditLogRowsOf,
  moderationAuditLogRows,
} from './user-moderation-steps.ts';

// 管理者の招待の完了に、利用者側の通報の送信と、照会・対応結果・非公開化の3通の通知の待ちと、件数の画面の読み込み直しの分を足す
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 3 });

const suffixOf = (): string => randomBytes(4).toString('hex');

// 監査ログと通知に残る理由。個人情報を含めない
const PROGRESS_REASON = 'E2Eの確認のため、権利侵害の申出の確認を始めます。';

const HIDE_REASON = 'E2Eの確認のため、権利侵害の申出を認めて非公開にします。';

// 掲載中のプロダクトと連絡先は実行のたびに乱数の接尾辞で別に作り、前回の実行のデータを消さないため、後片付けをしない
test.describe('通報への対応と照会(管理者側)', () => {
  test('未ログインの権利侵害の通報の案件を権利侵害の絞り込みで見つけて対応中にし、照会を送ると投稿者へ照会が届き期限が出て、非公開化で対応済にすると利用者側で404になり申出者と投稿者へ通知が届き、監査ログと件数の表示が変わる', async ({
    page,
    clientPage,
  }) => {
    const {
      ownerEmail,
      products: [product],
    } = await createListedProducts({ count: 1 });
    if (product === undefined) {
      throw new Error('掲載中のプロダクトを作れませんでした');
    }
    const contactEmail = `e2e-rights-${suffixOf()}@${TEST_EMAIL_DOMAIN}`;
    const reportReason = `E2Eの権利侵害の申出${suffixOf()}です。私が撮影した写真が無断で使われています。`;
    const inquiryMessage = `E2Eの照会${suffixOf()}です。掲載している写真の権利をお持ちか確認させてください。`;

    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openAdminProductDetail(page, admin, product);
    const adminProductPath = new URL(page.url()).pathname;
    await expectProductReportsSection(page, { count: 0, openStatus: null });
    // 他のテストも通報を送るため、ダッシュボードの未対応の件数は操作の前との差で確かめる。未対応の件数は対応中にした時点で減り、対応済にしても変わらない
    const countsBeforeReport = await readUnhandledReportCounts(page);

    await openEngagementProductPage(clientPage, product);
    await submitReportForm(
      clientPage,
      await openProductReportForm(clientPage),
      {
        categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
        reason: reportReason,
        contactEmail,
      },
    );
    const caseId = await findOpenReportCaseId({
      kind: 'product',
      productHandle: product.handle,
    });
    const { targetId: productId } = await readReportCaseState(caseId);
    if (productId === null) {
      throw new Error(`案件(${caseId})が対象のプロダクトを指していません`);
    }

    const countsAfterReport = await readUnhandledReportCounts(
      page,
      (counts) =>
        counts.open > countsBeforeReport.open &&
        counts.infringementOpen > countsBeforeReport.infringementOpen,
    );
    await page.goto(adminProductPath);
    await expectProductReportsSection(page, { count: 1, openStatus: 'open' });

    await openReportCaseFromInfringementList(page, admin, product);
    await expect(page).toHaveURL((url) => url.pathname.endsWith(caseId));
    await expectReportCaseStatus(page, 'open');
    const reportCasePath = new URL(page.url()).pathname;
    await startReportCaseProgress(page, PROGRESS_REASON);
    await readUnhandledReportCounts(
      page,
      (counts) =>
        counts.open < countsAfterReport.open &&
        counts.infringementOpen < countsAfterReport.infringementOpen,
    );
    await page.goto(reportCasePath);
    await expectReportCaseStatus(page, 'in_progress');

    const inquiredAfter = new Date();
    await sendInfringementInquiry(page, inquiryMessage);
    await expectInfringementInquiryShown(page, inquiryMessage);
    const inquiryMail = await expectInfringementInquiryNotice(
      ownerEmail,
      { productName: product.name, message: inquiryMessage },
      inquiredAfter,
    );
    expect(inquiryMail.text).not.toContain(reportReason);
    expect(inquiryMail.text).not.toContain(contactEmail);

    const resolvedAfter = new Date();
    await hideProductToResolveReportCase(page, product, HIDE_REASON);
    expect(await readReportCaseState(caseId)).toMatchObject({
      status: 'resolved',
    });
    await expectProductNotFound(clientPage, product.handle);
    await Promise.all([
      expectResolvedNotice(
        contactEmail,
        { productName: product.name, reason: HIDE_REASON },
        resolvedAfter,
      ),
      expectProductHiddenNotice(
        ownerEmail,
        product,
        HIDE_REASON,
        resolvedAfter,
      ),
    ]);

    const resolveLogs = await auditLogRowsOf(
      page,
      admin,
      REPORT_RESOLVE_ACTION.label,
      caseId,
    );
    await expect(resolveLogs).toHaveCount(1);
    await expect(resolveLogs).toContainText(HIDE_REASON);
    const hideLogs = await moderationAuditLogRows(
      page,
      admin,
      'product.hide',
      productId,
    );
    await expect(hideLogs).toHaveCount(1);
    await expect(hideLogs).toContainText(HIDE_REASON);

    await page.goto(adminProductPath);
    await expectHiddenProductDetail(page, HIDE_REASON);
    await expectProductReportsSection(page, { count: 1, openStatus: null });
    await page.goto(reportCasePath);
    await expectReportCaseStatus(page, 'resolved');
  });
});

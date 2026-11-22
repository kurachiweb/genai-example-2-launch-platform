import { REPORT_CATEGORY_OTHER_NAME } from '../../apps/common-lib/reporting/report-rules.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { createModerationTargets } from '../support/moderation-fixtures.ts';
import {
  createReport,
  readReportCaseState,
} from '../support/report-fixtures.ts';
import { expectNoEmailSince } from './administrative-withdrawal-steps.ts';
import { expect, test } from './admin-test.ts';
import {
  changeReportCaseStatus,
  expectNoClosingRecord,
  expectRejectionNotice,
  expectReportCaseStatus,
  openReportCaseDetail,
  rejectCommentReportCase,
} from './report-case-steps.ts';

// 管理者の招待の完了に、却下の通知の待ちと、戻した後にメールが届かないことの待ちを足す
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 2 });

// 申出者の理由は投稿者へ渡らないことを確かめるため、管理者の理由と別の文にする
const REPORT_REASON = 'E2Eの申出者の通報の理由です。';

// 監査ログと通知に残る理由。個人情報を含めない
const REJECT_REASON = 'E2Eの確認のため、規約違反の無い通報を却下します。';

const REOPEN_REASON = 'E2Eの確認のため、再確認として対応中へ戻します。';

// 通報の対象と案件は実行のたびに乱数の接尾辞で別に作り、前回の実行のデータを消さないため、後片付けをしない
test.describe('通報の却下と手での再開(管理者側)', () => {
  test('モデレーターがログイン中の利用者のコメントへの通報を却下すると案件が却下になり申出者と投稿者へ却下の通知が届き、理由を添えて手で対応中へ戻すと完了の表示が消えてメールは増えない', async ({
    page,
  }) => {
    const targets = await createModerationTargets();
    const reporter = targets.ratings[0]?.rater;
    if (reporter === undefined) {
      throw new Error('補助の既定の評価者がいません');
    }
    const poster = targets.comment.author;
    const { caseId } = await createReport({
      target: { kind: 'comment', commentId: targets.comment.commentId },
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reporter: { kind: 'member', email: reporter.email },
      reason: REPORT_REASON,
    });

    await signInAsNewAdmin(page, { role: 'moderator' });
    await openReportCaseDetail(page, caseId);
    await expectReportCaseStatus(page, 'open');

    const rejectedAfter = new Date();
    await rejectCommentReportCase(page, targets.productName, REJECT_REASON);
    expect(await readReportCaseState(caseId)).toMatchObject({
      status: 'rejected',
    });
    const [reporterMail, posterMail] = await Promise.all([
      expectRejectionNotice(reporter.email, REJECT_REASON, rejectedAfter),
      expectRejectionNotice(poster.email, REJECT_REASON, rejectedAfter),
    ]);
    expect(reporterMail.text).toContain(targets.productName);
    expect(posterMail.text).toContain(targets.productName);
    expect(posterMail.text).not.toContain(REPORT_REASON);

    const reopenedAt = new Date();
    await changeReportCaseStatus(page, 'in_progress', REOPEN_REASON);
    await expectNoClosingRecord(page);
    expect(await readReportCaseState(caseId)).toMatchObject({
      status: 'in_progress',
    });
    await Promise.all([
      expectNoEmailSince(reporter.email, reopenedAt),
      expectNoEmailSince(poster.email, reopenedAt),
    ]);
  });
});

import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { computeRefundEstimate } from '../../apps/common-lib/sponsorship/refund-estimate.ts';
import { PRODUCT_FLOW_TIMEOUT_MS } from '../client/product-steps.ts';
import {
  expectNoSponsoredAd,
  expectSponsoredAd,
  registerSponsorshipOwner,
} from '../client/sponsorship-steps.ts';
import {
  addBusinessDays,
  businessDateOf,
  isNearBusinessDayBoundary,
} from '../support/scheduled-trigger.ts';
import {
  createPaidSponsorship,
  kickOffProduct,
} from '../support/sponsorship-fixtures.ts';
import { expect, test } from './client-page-test.ts';
import {
  confirmTermination,
  expectNoTerminateAction,
  expectSponsorshipRow,
  expectTerminationNotice,
  expectTerminationRefundRequest,
  expectTerminationResult,
  filterSponsorships,
  openAdminSponsorships,
  openTerminationDialog,
  terminationAuditLogRows,
  type TerminationFigures,
} from './sponsorship-termination-steps.ts';

// 管理者の用意に加え、利用者の登録とメールの確認・画像の送信を含むプロダクトの登録と、強制終了の通知の待ちを1つの流れで行う
const TERMINATION_FLOW_TIMEOUT_MS =
  ADMIN_FLOW_TIMEOUT_MS + PRODUCT_FLOW_TIMEOUT_MS + 60_000;

test.describe.configure({ timeout: TERMINATION_FLOW_TIMEOUT_MS });

// 監査ログと強制終了の通知メールに残る理由。個人情報を含めない
const TERMINATION_REASON = 'E2Eのスポンサー広告の強制終了の確認';

// 昨日から始まった申込を今日強制終了し、今日から終了日までの日数を未掲載日数として、支払った金額の一部を返金させる
const PAST_DAYS = 1;

const UNEXPOSED_DAYS = 3;

const BUSINESS_DAY_BOUNDARY_SKIP_REASON =
  '業務日付の境界の直前は、申込を作った後に業務日付が変わって未掲載日数が変わり得るため、スポンサー広告の強制終了のE2Eを飛ばします';

test.describe('スポンサー広告の強制終了(管理者側)', () => {
  test('モデレーターが一覧で絞り込んだ決済済みの申込の強制終了の確認で返金目安額を確かめ、理由を入れて確定すると、自動の返金の依頼の結果と購入IDが出て、返金の依頼と監査ログが記録され、申込者へ返金の日数と金額を含む通知メールが届き、トップページから広告が消える', async ({
    page,
    clientPage,
  }) => {
    test.skip(
      isNearBusinessDayBoundary(new Date()),
      BUSINESS_DAY_BOUNDARY_SKIP_REASON,
    );
    const { account, product } = await registerSponsorshipOwner(clientPage);
    const sponsorProduct = await kickOffProduct(product.handle);
    const today = businessDateOf(new Date());
    const sponsorship = await createPaidSponsorship(sponsorProduct, {
      tier: 'legend',
      startsOn: addBusinessDays(today, -PAST_DAYS),
      endsOn: addBusinessDays(today, UNEXPOSED_DAYS - 1),
    });
    const figures: TerminationFigures = {
      unexposedDays: UNEXPOSED_DAYS,
      refundEstimate: computeRefundEstimate({
        amountTotal: sponsorship.amountTotal,
        days: sponsorship.days,
        unexposedDays: UNEXPOSED_DAYS,
      }),
    };
    expect(figures.refundEstimate).toBeLessThan(sponsorship.amountTotal);
    await expectSponsoredAd(clientPage, '/', 'legend', product);

    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openAdminSponsorships(page, admin);
    await filterSponsorships(page, { status: 'active', tier: 'legend' });
    await expectSponsorshipRow(page, sponsorship, product.name, 'active');
    const dialog = await openTerminationDialog(page, sponsorship, figures);
    const confirmedAt = new Date();
    await confirmTermination(dialog, TERMINATION_REASON);

    await expectTerminationResult(page, sponsorship, figures, today);
    await expectTerminationRefundRequest(sponsorship, figures.refundEstimate);
    await expectTerminationNotice(account, product.name, {
      reason: TERMINATION_REASON,
      figures,
      receivedAfter: confirmedAt,
    });
    await expectNoSponsoredAd(clientPage, '/', product);

    const logRows = await terminationAuditLogRows(
      page,
      admin,
      sponsorship.sponsorshipId,
    );
    await expect(logRows).toHaveCount(1);
    await expect(logRows).toContainText(TERMINATION_REASON);
    await expect(logRows).toContainText(
      `unexposedDays: ${String(figures.unexposedDays)}`,
    );
    await expect(logRows).toContainText(
      `refundEstimate: ${String(figures.refundEstimate)}`,
    );
    await expect(logRows).toContainText('stoppedDays: 0');
    await expect(logRows).toContainText('stopRefundAmount: 0');
  });

  test('ロールが閲覧のみの管理者には、一覧で絞り込んだ掲載中の決済済みの申込にも「強制終了」が出ない', async ({
    page,
    clientPage,
  }) => {
    test.skip(
      isNearBusinessDayBoundary(new Date()),
      BUSINESS_DAY_BOUNDARY_SKIP_REASON,
    );
    const { product } = await registerSponsorshipOwner(clientPage);
    const sponsorProduct = await kickOffProduct(product.handle);
    const today = businessDateOf(new Date());
    const sponsorship = await createPaidSponsorship(sponsorProduct, {
      tier: 'silver',
      startsOn: today,
      endsOn: today,
    });

    const admin = await signInAsNewAdmin(page, { role: 'viewer' });
    await openAdminSponsorships(page, admin);
    await filterSponsorships(page, { status: 'active', tier: 'silver' });
    await expectSponsorshipRow(page, sponsorship, product.name, 'active');

    await expectNoTerminateAction(page, sponsorship.sponsorshipId);
  });
});

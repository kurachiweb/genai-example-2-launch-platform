import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { expect, test } from './admin-test.ts';
import {
  chooseFinalDate,
  expectReadOnlyFinalDate,
  expectSavedFinalDate,
  finalDateAuditLogRows,
  finalDateYearCard,
  nextFinalDateYear,
  openFinalDateSection,
  saveFinalDate,
} from './year-final-date-steps.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

// 監査ログに残る理由。個人情報を含めない
const CHANGE_REASON = 'E2Eの決勝実施日の保存の確認';

// 翌年の行だけを変え、利用者側のYearトーナメントのE2Eが作る過去の対象年とは重ならない。変える日は既定の日とその隣の日曜日を行き来するため、後片付けをしない
test.describe('Yearトーナメントの決勝実施日(管理者側)', () => {
  test('最上位管理者が設定のページで翌年の決勝実施日に現在と違う候補を選んで確認して保存すると、トーストとカードが保存した日と変更した管理者を示し、監査ログの一覧に理由と変更前後の日の記録が出る', async ({
    page,
  }) => {
    const year = nextFinalDateYear();
    const admin = await signInAsNewAdmin(page, { role: 'super_admin' });
    const card = finalDateYearCard(
      await openFinalDateSection(page, admin),
      year,
    );

    const { from, to } = await chooseFinalDate(page, card, year);
    await saveFinalDate(page, card, year, to, CHANGE_REASON);

    await expectSavedFinalDate(card, to, admin);

    const logRows = await finalDateAuditLogRows(page, admin);
    await expect(logRows).toHaveCount(1);
    await expect(logRows).toContainText(CHANGE_REASON);
    await expect(logRows).toContainText(`year: ${String(year)}`);
    await expect(logRows).toContainText(`fromDate: ${from}`);
    await expect(logRows).toContainText(`toDate: ${to}`);
  });

  test('ロールが閲覧のみの管理者には、翌年の決勝実施日のカードが参照だけの理由とともに示され、候補の選択と保存の操作が無い', async ({
    page,
  }) => {
    const year = nextFinalDateYear();
    const admin = await signInAsNewAdmin(page, { role: 'viewer' });
    const section = await openFinalDateSection(page, admin);

    await expectReadOnlyFinalDate(finalDateYearCard(section, year));
  });
});

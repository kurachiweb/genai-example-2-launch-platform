import { expect, type Locator, type Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import { SETTINGS_TITLE } from '../../apps/admin/src/components/settings/settings-messages.ts';
import {
  FINAL_DATE_CONFIRM_LABEL,
  FINAL_DATE_LABEL,
  FINAL_DATE_SAVED_MESSAGE,
  FINAL_DATE_SECTION_TITLE,
  FINAL_DATE_SOURCE_LABELS,
  FINAL_DATE_SUBMIT_LABEL,
  FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE,
  finalDateConfirmTitleOf,
  yearLabelOf,
} from '../../apps/admin/src/components/year-tournament/final-date-labels.ts';
import { defaultFinalDate } from '../../apps/backend-lib/core/year-tournament/year-schedule.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../apps/common-lib/time/business-date-label.ts';
import { YEAR_FINAL_DATE_UPDATE_ACTION } from '../../apps/common-lib/admin/audit-actions/tournament-year.ts';
import {
  AUDITED_ACTION_NOTICE,
  OPTIONAL_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { businessDateOf } from '../support/scheduled-trigger.ts';
import { pickFinalDateChoice } from '../support/year-final-date-choice.ts';

const SETTINGS_PATH = '/settings';

const AUDIT_LOGS_PATH = '/audit-logs';

// 設定の区画に並ぶのは現在の年と翌年で、翌年は年間を通して変更期限より前にあるため、翌年のカードを操作する
export const nextFinalDateYear = (now: Date = new Date()): number =>
  Number(businessDateOf(now).slice(0, 4)) + 1;

// 入力欄はハイドレーションの前に操作しても状態に入らないため、ハイドレーション済みの画面から管理画面のナビゲーションで開く
export async function openFinalDateSection(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: SETTINGS_TITLE }),
  ).toBeVisible();
  const section = page
    .getByRole('main')
    .getByRole('region', { name: FINAL_DATE_SECTION_TITLE, exact: true });
  await expect(section).toBeVisible();
  return section;
}

export const finalDateYearCard = (section: Locator, year: number): Locator =>
  section.getByRole('region', { name: yearLabelOf(year), exact: true });

const finalDateCombobox = (card: Locator): Locator =>
  card.getByRole('combobox', { name: FINAL_DATE_LABEL, exact: true });

const submitButton = (card: Locator): Locator =>
  card.getByRole('button', { name: FINAL_DATE_SUBMIT_LABEL, exact: true });

const shownFinalDate = (card: Locator): Locator =>
  card
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${FINAL_DATE_LABEL}$`, 'u') })
    .locator('xpath=following-sibling::dd[1]')
    .locator('time');

export async function readShownFinalDate(card: Locator): Promise<string> {
  const date = await shownFinalDate(card).getAttribute('datetime');
  if (date === null) {
    throw new RangeError('決勝実施日の日時の属性がありません');
  }
  return date;
}

// 候補はサーバーが返し、一覧を開くまで描かれないため、開いた一覧の日付から選ぶ
export async function chooseFinalDate(
  page: Page,
  card: Locator,
  year: number,
): Promise<{ readonly from: string; readonly to: string }> {
  const from = await readShownFinalDate(card);
  const combobox = finalDateCombobox(card);
  const listbox = page.getByRole('listbox');
  await expect(async () => {
    if (!(await listbox.isVisible())) {
      await combobox.click();
    }
    await expect(listbox).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  const choices = await listbox
    .getByRole('option')
    .locator('time')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('datetime') ?? ''),
    );
  const to = pickFinalDateChoice({
    choices,
    current: from,
    preferred: defaultFinalDate(year),
  });
  const label = formatBusinessDateWithWeekdayLabel(to);
  await listbox.getByRole('option', { name: label, exact: true }).click();
  await expect(listbox).toHaveCount(0);
  await expect(combobox).toContainText(label);
  return { from, to };
}

// 「保存する」は確認のダイアログを開くだけで、ダイアログにも同じ名前の確定のボタンがあるため、確定はダイアログの中で押す
export async function saveFinalDate(
  page: Page,
  card: Locator,
  year: number,
  date: string,
  reason: string,
): Promise<void> {
  await submitButton(card).click();
  const { before, after } = finalDateConfirmTitleOf(year);
  const dialog = page.getByRole('dialog', {
    name: `${before}${formatBusinessDateWithWeekdayLabel(date)}${after}`,
  });
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  await dialog.getByLabel(OPTIONAL_REASON_LABEL, { exact: true }).fill(reason);
  await dialog
    .getByRole('button', { name: FINAL_DATE_CONFIRM_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(FINAL_DATE_SAVED_MESSAGE)).toBeVisible();
}

export async function expectSavedFinalDate(
  card: Locator,
  date: string,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<void> {
  await expect(shownFinalDate(card)).toHaveAttribute('datetime', date);
  await expect(card).toContainText(FINAL_DATE_SOURCE_LABELS.EXPLICIT);
  await expect(card).toContainText(admin.nickname);
}

export async function expectReadOnlyFinalDate(card: Locator): Promise<void> {
  await expect(shownFinalDate(card)).toHaveCount(1);
  await expect(card).toContainText(FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE);
  await expect(finalDateCombobox(card)).toHaveCount(0);
  await expect(submitButton(card)).toHaveCount(0);
}

export async function finalDateAuditLogRows(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, AUDIT_LOGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
  ).toBeVisible();
  return page
    .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
    .getByRole('row')
    .filter({ hasText: YEAR_FINAL_DATE_UPDATE_ACTION.label })
    .filter({ hasText: admin.nickname });
}

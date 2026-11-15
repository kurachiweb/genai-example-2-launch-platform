import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import {
  SENDER_INFO_CONFIRM_LABEL,
  SENDER_INFO_CONFIRM_TITLE,
  SENDER_INFO_SAVED_MESSAGE,
  SENDER_INFO_SUBMIT_LABEL,
  SENDER_INFO_TITLE,
  senderInfoFieldLabelOf,
} from '../../apps/admin/src/components/notifications/sender-info-messages.ts';
import { SETTINGS_TITLE } from '../../apps/admin/src/components/settings/settings-messages.ts';
import { NOTIFICATION_SENDER_UPDATE_ACTION } from '../../apps/common-lib/admin/audit-actions/notifications.ts';
import { OPTIONAL_REASON_LABEL } from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import { TEST_EMAIL_DOMAIN } from '../support/test-email.ts';

export interface SenderInfoInput {
  readonly businessName: string;
  readonly contactEmail: string;
  readonly postalAddress: string;
}

const SETTINGS_PATH = '/settings';

const AUDIT_LOGS_PATH = '/audit-logs';

// 前回の実行の値と区別できるよう、実行ごとに乱数から作る。送信者情報はメールの末尾に載るため、実在の事業者・住所を使わない
export function createSenderInfoInput(): SenderInfoInput {
  const suffix = randomBytes(4).toString('hex');
  return {
    businessName: `E2E事業者${suffix}`,
    contactEmail: `sender-${suffix}@${TEST_EMAIL_DOMAIN}`,
    postalAddress: `E2E県E2E市1-2-3 ${suffix}`,
  };
}

export const senderInfoSection = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: SENDER_INFO_TITLE, exact: true });

const senderInfoField = (
  section: Locator,
  field: keyof SenderInfoInput,
): Locator =>
  section.getByLabel(senderInfoFieldLabelOf(field), { exact: true });

// 入力欄はハイドレーションの前に入れた値がフォームの状態に入らないため、ハイドレーション済みの画面から管理画面のナビゲーションで開く
export async function openSenderInfoSettings(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: SETTINGS_TITLE }),
  ).toBeVisible();
  const section = senderInfoSection(page);
  await expect(senderInfoField(section, 'businessName')).toBeEditable();
  return section;
}

// フォームの「保存する」は確認のダイアログを開くだけで、ダイアログにも同じ名前の確定のボタンがあるため、確定はダイアログの中で押す
export async function saveSenderInfo(
  page: Page,
  section: Locator,
  input: SenderInfoInput,
  reason: string,
): Promise<void> {
  await senderInfoField(section, 'businessName').fill(input.businessName);
  await senderInfoField(section, 'contactEmail').fill(input.contactEmail);
  await senderInfoField(section, 'postalAddress').fill(input.postalAddress);
  await section
    .getByRole('button', { name: SENDER_INFO_SUBMIT_LABEL, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: SENDER_INFO_CONFIRM_TITLE });
  await dialog.getByLabel(OPTIONAL_REASON_LABEL, { exact: true }).fill(reason);
  await dialog
    .getByRole('button', { name: SENDER_INFO_CONFIRM_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(SENDER_INFO_SAVED_MESSAGE)).toBeVisible();
}

export async function expectSavedSenderInfo(
  section: Locator,
  input: SenderInfoInput,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<void> {
  await expect(senderInfoField(section, 'businessName')).toHaveValue(
    input.businessName,
  );
  await expect(senderInfoField(section, 'contactEmail')).toHaveValue(
    input.contactEmail,
  );
  await expect(senderInfoField(section, 'postalAddress')).toHaveValue(
    input.postalAddress,
  );
  await expect(section).toContainText(admin.nickname);
}

export async function senderInfoAuditLogRows(
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
    .filter({ hasText: NOTIFICATION_SENDER_UPDATE_ACTION.label })
    .filter({ hasText: admin.nickname });
}

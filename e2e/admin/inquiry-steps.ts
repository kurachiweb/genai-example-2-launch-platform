import { expect, type Locator, type Page } from '@playwright/test';

import {
  INQUIRY_DETAIL_TITLE,
  INQUIRY_LIST_CAPTION,
} from '../../apps/admin/src/components/inquiry/admin-inquiries-messages.ts';
import {
  type BootstrappedAdmin,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';

export const INQUIRIES_PATH = '/inquiries';

const DETAIL_PATH_PATTERN = /\/inquiries\/[0-9A-HJKMNP-TV-Z]{26}$/u;

export const inquiryListRow = (page: Page, senderName: string): Locator =>
  page
    .getByRole('table', { name: INQUIRY_LIST_CAPTION, exact: true })
    .getByRole('row')
    .filter({
      has: page.getByRole('link', { name: senderName, exact: true }),
    });

// 一覧は受付日時の新しい順のため、直前に送られた問い合わせは最初のページにある。送信者の表示名は実行ごとの乱数を含むため、他の問い合わせと取り違えない。返す値は開いた詳細のパス
export async function openInquiryDetailFromList(
  page: Page,
  senderName: string,
): Promise<string> {
  await inquiryListRow(page, senderName)
    .getByRole('link', { name: senderName, exact: true })
    .click();
  await expect(page).toHaveURL(DETAIL_PATH_PATTERN);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: INQUIRY_DETAIL_TITLE,
      exact: true,
    }),
  ).toBeVisible();
  return new URL(page.url()).pathname;
}

export async function openInquiryFromList(
  page: Page,
  admin: BootstrappedAdmin,
  senderName: string,
): Promise<string> {
  await openFromAdminNavigation(page, admin, INQUIRIES_PATH);
  return openInquiryDetailFromList(page, senderName);
}

// 管理画面の詳細と利用者側のチャットは項目を名前と値の組の一覧で表示するため、項目の名前の直後の値を返す
export const inquiryDetailValue = (page: Page, term: string): Locator =>
  page
    .getByRole('main')
    .getByRole('term')
    .and(page.getByText(term, { exact: true }))
    .locator('xpath=following-sibling::*[1]');

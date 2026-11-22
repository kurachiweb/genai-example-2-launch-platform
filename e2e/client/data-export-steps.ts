import {
  type APIResponse,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import { DATA_EXPORT_DISPLAY_STATUS_LABELS } from '../../apps/common-lib/data-export/data-export-rules.ts';
import {
  DATA_EXPORT_FILE_NAME_LABEL,
  DATA_EXPORT_PAGE_TITLE,
  DATA_EXPORT_REQUEST_LABEL,
  DATA_EXPORT_REQUESTED_MESSAGE,
} from '../../apps/client/src/components/data-export/data-export-messages.ts';
import { SETTINGS_NAVIGATION_LABEL } from '../../apps/client/src/components/settings/settings-messages.ts';
import { SETTINGS_NAV_ITEMS } from '../../apps/client/src/composition/settings-navigation.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';
import { waitForToastDismissed } from '../support/toast.ts';
import {
  MAIL_FLOW_TIMEOUT_MS,
  openProfileSettings,
  type TestAccount,
} from './auth/account-steps.ts';

// 2人分の登録とメールの確認、プロフィールとプロダクトの用意、生成の完了待ちとダウンロードを1つの流れで行うため、メールの流れの待ちの3倍にする
export const DATA_EXPORT_FLOW_TIMEOUT_MS = MAIL_FLOW_TIMEOUT_MS * 3;

export const DATA_EXPORT_PATH = '/settings/export';

export const READY_EMAIL_SUBJECT = 'データエクスポートの準備ができました';

export const READY_EMAIL_ACTION_LABEL = 'ダウンロードページを開く';

// 生成はQueueのconsumerが非同期に行い、メールの送信もQueueを経るため、開発サーバーの初回の変換の遅れを含めても完了する長さにする
const GENERATION_TIMEOUT_MS = 60_000;

const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const DOWNLOAD_LINK_PATTERN = /^ダウンロード/u;

const dataExportNavLabel = (): string => {
  const item = SETTINGS_NAV_ITEMS.find(({ to }) => to === DATA_EXPORT_PATH);
  if (item === undefined) {
    throw new Error(
      `設定のナビゲーションに${DATA_EXPORT_PATH}の項目がありません`,
    );
  }
  return item.label;
};

export const exportList = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('list', { name: DATA_EXPORT_PAGE_TITLE, exact: true });

export const exportItems = (page: Page): Locator =>
  exportList(page).getByRole('listitem');

const downloadLinkOf = (item: Locator): Locator =>
  item.getByRole('link', { name: DOWNLOAD_LINK_PATTERN });

// 要求のボタンはハイドレーションの前に押しても効かないため、ハイドレーション済みの設定ページからナビゲーションのリンクで開く
export async function openDataExportFromSettingsNavigation(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openProfileSettings(page, account);
  await page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: dataExportNavLabel(), exact: true })
    .click();
  await expect(page).toHaveURL(DATA_EXPORT_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: DATA_EXPORT_PAGE_TITLE }),
  ).toBeVisible();
}

// 受け付けのトーストを待ち、トーストが消えるまで待って後続の表示と取り違えない
export async function requestDataExport(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: DATA_EXPORT_REQUEST_LABEL, exact: true })
    .click();
  const toast = page.getByText(DATA_EXPORT_REQUESTED_MESSAGE, { exact: true });
  await expect(toast).toBeVisible();
  await waitForToastDismissed(page, toast);
}

export async function expectPendingExport(page: Page): Promise<void> {
  await expect(exportItems(page)).toHaveCount(1);
  await expect(
    exportItems(page)
      .first()
      .getByText(DATA_EXPORT_DISPLAY_STATUS_LABELS.pending, { exact: true }),
  ).toBeVisible();
}

export async function waitForReadyEmail(
  account: TestAccount,
  receivedAfter: Date,
): Promise<MailpitMessage> {
  return waitForEmailWithSubject(
    { to: account.email, receivedAfter, subject: READY_EMAIL_SUBJECT },
    { timeoutMs: GENERATION_TIMEOUT_MS },
  );
}

export function exportPageLinkOf(message: MailpitMessage): string {
  const link = message.links.find(
    (candidate) => new URL(candidate).pathname === DATA_EXPORT_PATH,
  );
  if (link === undefined) {
    throw new Error(
      `完了のメールに${DATA_EXPORT_PATH}のリンクがありません: ${message.links.join(', ')}`,
    );
  }
  return link;
}

export interface ReadyExport {
  readonly downloadPath: string;
  readonly fileName: string;
}

// 完了の項目に、ファイル名の表示と、/_bff/exports/<ID>を指すダウンロードのリンクが出る
export async function expectReadyExport(page: Page): Promise<ReadyExport> {
  const item = exportItems(page).first();
  await expect(
    item.getByText(DATA_EXPORT_DISPLAY_STATUS_LABELS.ready, { exact: true }),
  ).toBeVisible({ timeout: GENERATION_TIMEOUT_MS });
  await expect(
    item.getByText(DATA_EXPORT_DISPLAY_STATUS_LABELS.pending),
  ).toHaveCount(0);
  const link = downloadLinkOf(item);
  await expect(link).toBeVisible();
  const downloadPath = await link.getAttribute('href');
  if (downloadPath === null) {
    throw new Error('ダウンロードのリンクにhrefがありません');
  }
  const fileName = await item
    .getByText(DATA_EXPORT_FILE_NAME_LABEL, { exact: true })
    .locator('xpath=following-sibling::dd[1]')
    .innerText();
  return { downloadPath, fileName };
}

// ブラウザの保存の動作が受け取るファイル名は、一覧に示したファイル名と同じになる
export async function clickDownloadAndReadFileName(
  page: Page,
): Promise<string> {
  const downloadPromise = page.waitForEvent('download');
  await downloadLinkOf(exportItems(page).first()).click();
  const download = await downloadPromise;
  return download.suggestedFilename();
}

export interface DownloadedArchive {
  readonly status: number;
  readonly contentDisposition: string | undefined;
  readonly contentType: string | undefined;
  readonly body: Buffer;
}

export async function requestArchive(
  page: Page,
  downloadPath: string,
): Promise<DownloadedArchive> {
  const response: APIResponse = await page.request.get(downloadPath);
  const headers = response.headers();
  return {
    status: response.status(),
    contentDisposition: headers['content-disposition'],
    contentType: headers['content-type'],
    body: await response.body(),
  };
}

export const startsWithZipSignature = (body: Buffer): boolean =>
  body.subarray(0, ZIP_LOCAL_FILE_HEADER.length).equals(ZIP_LOCAL_FILE_HEADER);

// ZIPのエントリ名は圧縮されずに局所ヘッダーと中央ディレクトリへ書かれるため、本文のバイト列から探せる
export const containsEntryName = (body: Buffer, entryName: string): boolean =>
  body.includes(Buffer.from(entryName, 'utf8'));

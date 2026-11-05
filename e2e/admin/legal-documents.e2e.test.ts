import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import {
  editLegalDocumentName,
  OPEN_PUBLIC_PAGE_LABEL,
} from '../../apps/admin/src/components/legal/legal-documents-messages.ts';
import {
  LEGAL_BODY_LABEL,
  PUBLISH_LABEL,
  SAVE_DRAFT_LABEL,
} from '../../apps/admin/src/components/legal/legal-draft-form-messages.ts';
import {
  DRAFT_PRESENT_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  LEGAL_DOCUMENT_PUBLISHED_MESSAGE,
  NO_DRAFT_MESSAGE,
} from '../../apps/admin/src/components/legal/legal-editor-messages.ts';
import {
  LEGAL_REVISION_TABLE_EMPTY_MESSAGE,
  LEGAL_REVISION_TABLE_HEADING,
} from '../../apps/admin/src/components/legal/legal-revision-messages.ts';
import {
  CHANGE_SUMMARY_LABEL,
  PUBLISH_CONFIRM_LABEL,
  publishLegalDocumentTitle,
} from '../../apps/admin/src/components/legal/publish-legal-document-messages.ts';
import {
  LAST_REVISED_LABEL,
  pastVersionNotice,
  REVISION_HISTORY_TITLE,
  VIEW_LATEST_VERSION_LABEL,
} from '../../apps/client/src/components/legal/legal-messages.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
  legalRevisionPath,
  legalVersionLabel,
} from '../../apps/common-lib/legal/legal-documents.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { expect, test } from './admin-test.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

const KIND = 'terms';

const DOCUMENT_LABEL = LEGAL_DOCUMENT_LABELS[KIND];

const PUBLIC_PATH = LEGAL_DOCUMENT_PATHS[KIND];

const LEGAL_DOCUMENTS_PATH = '/legal-documents';

const VERSION_LABEL_PATTERN = /^第(\d+)版$/;

interface PublishedRevision {
  readonly versionNumber: number;
  readonly publishedAt: string;
  readonly changeSummary: string;
  readonly body: string;
}

// 前回の実行や他の確認で残った本文・変更概要と取り違えないよう、実行ごとに乱数を含める
const uniqueText = (prefix: string): string =>
  `${prefix}${randomBytes(6).toString('hex')}`;

const editorMain = (page: Page): Locator => page.getByRole('main');

const revisionTable = (page: Page): Locator =>
  editorMain(page).getByRole('table', { name: LEGAL_REVISION_TABLE_HEADING });

const versionNumberOf = (label: string): number => {
  const matched = VERSION_LABEL_PATTERN.exec(label.trim());
  if (matched?.[1] === undefined) {
    throw new Error(`版の表示が想定と異なります: ${label}`);
  }
  return Number.parseInt(matched[1], 10);
};

async function readLatestVersionNumber(page: Page): Promise<number> {
  const table = revisionTable(page);
  const empty = editorMain(page).getByText(LEGAL_REVISION_TABLE_EMPTY_MESSAGE);
  await expect(table.or(empty)).toBeVisible();
  if (await empty.isVisible()) {
    return 0;
  }
  const firstVersionCell = table.getByRole('row').nth(1).getByRole('cell');
  return versionNumberOf(await firstVersionCell.first().innerText());
}

async function openTermsEditor(page: Page): Promise<void> {
  await editorMain(page)
    .getByRole('link', { name: editLegalDocumentName(DOCUMENT_LABEL) })
    .click();
  await expect(page).toHaveURL(`${LEGAL_DOCUMENTS_PATH}/${KIND}`);
  await expect(
    editorMain(page).getByRole('heading', { level: 1, name: DOCUMENT_LABEL }),
  ).toBeVisible();
}

// 入力欄は読み込みの後に編集できるようになり、値はフォーカスを外した時に確定するため、書式のツールが押せるようになってから入力し、保存のボタンの押下で確定させる
async function saveDraft(page: Page, body: string): Promise<void> {
  const main = editorMain(page);
  const editable = main.getByRole('textbox', { name: LEGAL_BODY_LABEL });
  await expect(editable).toBeVisible();
  await expect(
    main
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  await editable.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(body);
  await expect(editable).toContainText(body);

  await main
    .getByRole('button', { name: SAVE_DRAFT_LABEL, exact: true })
    .click();

  await expect(page.getByText(DRAFT_SAVED_MESSAGE)).toBeVisible();
  await expect(main.getByText(DRAFT_PRESENT_MESSAGE)).toBeVisible();
}

async function publishDraft(
  page: Page,
  body: string,
  expectedVersionNumber: number,
): Promise<PublishedRevision> {
  const main = editorMain(page);
  const changeSummary = uniqueText('E2Eで確かめる公開の変更概要');
  await main.getByRole('button', { name: PUBLISH_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: publishLegalDocumentTitle(DOCUMENT_LABEL),
  });
  await dialog
    .getByRole('textbox', { name: CHANGE_SUMMARY_LABEL })
    .fill(changeSummary);
  await dialog
    .getByRole('button', { name: PUBLISH_CONFIRM_LABEL, exact: true })
    .click();

  await expect(page.getByText(LEGAL_DOCUMENT_PUBLISHED_MESSAGE)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
  const newestRow = revisionTable(page).getByRole('row').nth(1);
  await expect(newestRow).toContainText(
    legalVersionLabel(expectedVersionNumber),
  );
  await expect(newestRow).toContainText(changeSummary);
  const publishedAt = await newestRow.locator('time').getAttribute('datetime');
  if (publishedAt === null) {
    throw new Error('改訂履歴の先頭の版に公開日時がありません');
  }
  return {
    versionNumber: expectedVersionNumber,
    publishedAt,
    changeSummary,
    body,
  };
}

const publicMain = (page: Page): Locator => page.getByRole('main');

const publicRevisionItems = (page: Page): Locator =>
  publicMain(page)
    .getByRole('region', { name: REVISION_HISTORY_TITLE })
    .getByRole('listitem');

async function openPublicPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(
    publicMain(page).getByRole('heading', { level: 1, name: DOCUMENT_LABEL }),
  ).toBeVisible();
}

async function expectRevisionItem(
  item: Locator,
  revision: PublishedRevision,
): Promise<void> {
  await expect(
    item.getByRole('link', {
      name: legalVersionLabel(revision.versionNumber),
      exact: true,
    }),
  ).toHaveAttribute('href', legalRevisionPath(KIND, revision.versionNumber));
  await expect(item.locator('time')).toHaveAttribute(
    'datetime',
    revision.publishedAt,
  );
  await expect(item).toContainText(revision.changeSummary);
}

async function expectLatestOnPublicPage(
  page: Page,
  latest: PublishedRevision,
): Promise<void> {
  const main = publicMain(page);
  await expect(main).toContainText(latest.body);
  await expect(
    main.locator('dl').filter({ hasText: LAST_REVISED_LABEL }).locator('time'),
  ).toHaveAttribute('datetime', latest.publishedAt);
  await expectRevisionItem(publicRevisionItems(page).first(), latest);
}

test.describe('法務文書の下書きの保存から公開・過去版まで', () => {
  test(`最上位管理者が${DOCUMENT_LABEL}の下書きを保存しても公開ページは変わらず、公開すると公開ページに本文・最終改訂日・改訂履歴の先頭の版が出て、続けて公開すると改訂履歴が新しい順に2版増え、1つ前の版のページに過去の版である旨と最新版へのリンクが出る`, async ({
    page,
    context,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'super_admin' });
    await openFromAdminNavigation(page, admin, LEGAL_DOCUMENTS_PATH);
    await openTermsEditor(page);
    const startVersionNumber = await readLatestVersionNumber(page);
    // 利用者側は別のオリジンにあるため、管理画面が案内する公開ページのURLを辿り、そのリンク先も合わせて確かめる
    const publicUrl = await editorMain(page)
      .getByRole('link', { name: OPEN_PUBLIC_PAGE_LABEL, exact: true })
      .getAttribute('href');
    if (publicUrl === null || !publicUrl.endsWith(PUBLIC_PATH)) {
      throw new Error(
        `公開ページへのリンクが想定と異なります: ${String(publicUrl)}`,
      );
    }
    const publicPage = await context.newPage();

    const firstBody = uniqueText('E2Eで確かめる利用規約の本文');
    await saveDraft(page, firstBody);

    await openPublicPage(publicPage, publicUrl);
    await expect(publicMain(publicPage)).not.toContainText(firstBody);

    const first = await publishDraft(page, firstBody, startVersionNumber + 1);

    await openPublicPage(publicPage, publicUrl);
    await expectLatestOnPublicPage(publicPage, first);

    const secondBody = uniqueText('E2Eで確かめる利用規約の改訂した本文');
    await saveDraft(page, secondBody);
    const second = await publishDraft(page, secondBody, startVersionNumber + 2);

    await openPublicPage(publicPage, publicUrl);
    await expectLatestOnPublicPage(publicPage, second);
    await expect(publicRevisionItems(publicPage)).toHaveCount(
      startVersionNumber + 2,
    );
    await expectRevisionItem(publicRevisionItems(publicPage).nth(1), first);

    await publicRevisionItems(publicPage)
      .nth(1)
      .getByRole('link', {
        name: legalVersionLabel(first.versionNumber),
        exact: true,
      })
      .click();
    await expect(publicPage).toHaveURL(
      new URL(legalRevisionPath(KIND, first.versionNumber), publicUrl).href,
    );
    const notice = publicMain(publicPage).getByRole('note');
    await expect(notice).toContainText(pastVersionNotice(first.versionNumber));
    const latestLink = notice.getByRole('link', {
      name: VIEW_LATEST_VERSION_LABEL,
      exact: true,
    });
    await expect(latestLink).toHaveAttribute('href', PUBLIC_PATH);
    await expect(publicMain(publicPage)).toContainText(first.body);
    await expect(publicMain(publicPage)).not.toContainText(second.body);

    await latestLink.click();
    await expect(publicPage).toHaveURL(publicUrl);
    await expect(publicMain(publicPage)).toContainText(second.body);
  });
});

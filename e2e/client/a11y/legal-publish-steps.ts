import { randomBytes } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

import {
  LEGAL_BODY_LABEL,
  PUBLISH_LABEL,
  SAVE_DRAFT_LABEL,
} from '../../../apps/admin/src/components/legal/legal-draft-form-messages.ts';
import {
  DRAFT_PRESENT_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  LEGAL_DOCUMENT_PUBLISHED_MESSAGE,
  NO_DRAFT_MESSAGE,
} from '../../../apps/admin/src/components/legal/legal-editor-messages.ts';
import {
  CHANGE_SUMMARY_LABEL,
  PUBLISH_CONFIRM_LABEL,
  publishLegalDocumentTitle,
} from '../../../apps/admin/src/components/legal/publish-legal-document-messages.ts';
import {
  type LegalDocumentKind,
  LEGAL_DOCUMENT_LABELS,
} from '../../../apps/common-lib/legal/legal-documents.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { waitForToastDismissed } from '../../support/toast.ts';

// 開発サーバーは初めて開く画面の部品の変換に時間が掛かり、既定の5秒の待ちを超えるため、書式のツールが使えるまで先に長く待つ
const EDITOR_READY_TIMEOUT_MS = 120_000;

const legalEditorPath = (kind: LegalDocumentKind): string =>
  `/legal-documents/${kind}`;

async function openLegalEditor(
  page: Page,
  kind: LegalDocumentKind,
): Promise<void> {
  await page.goto(legalEditorPath(kind));
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', {
      level: 1,
      name: LEGAL_DOCUMENT_LABELS[kind],
    }),
  ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
  await expect(
    main
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled({ timeout: EDITOR_READY_TIMEOUT_MS });
}

// 値はフォーカスを外した時に確定するため、入力の後に保存のボタンを押して確定させる
async function saveDraft(page: Page, body: string): Promise<void> {
  const main = page.getByRole('main');
  const savedToast = page.getByText(DRAFT_SAVED_MESSAGE);
  await waitForToastDismissed(page, savedToast);
  const editable = main.getByRole('textbox', { name: LEGAL_BODY_LABEL });
  await editable.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(body);
  await expect(editable).toContainText(body);
  await main
    .getByRole('button', { name: SAVE_DRAFT_LABEL, exact: true })
    .click();
  await expect(savedToast).toBeVisible();
  await expect(main.getByText(DRAFT_PRESENT_MESSAGE)).toBeVisible();
}

async function publishDraft(
  page: Page,
  kind: LegalDocumentKind,
  changeSummary: string,
): Promise<void> {
  const main = page.getByRole('main');
  const publishedToast = page.getByText(LEGAL_DOCUMENT_PUBLISHED_MESSAGE);
  await waitForToastDismissed(page, publishedToast);
  await main.getByRole('button', { name: PUBLISH_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: publishLegalDocumentTitle(LEGAL_DOCUMENT_LABELS[kind]),
  });
  await dialog
    .getByRole('textbox', { name: CHANGE_SUMMARY_LABEL })
    .fill(changeSummary);
  await dialog
    .getByRole('button', { name: PUBLISH_CONFIRM_LABEL, exact: true })
    .click();
  await expect(publishedToast).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText(NO_DRAFT_MESSAGE)).toBeVisible();
}

// 公開に要るロールは最上位管理者だけのため、呼び出し側は最上位管理者でログインしたページを渡す。公開は取り消せない
export async function publishLegalDocument(
  page: Page,
  kind: LegalDocumentKind,
): Promise<void> {
  const suffix = randomBytes(6).toString('hex');
  await openLegalEditor(page, kind);
  await saveDraft(page, `E2Eの監査のための本文${suffix}です。`);
  await publishDraft(page, kind, `E2Eの監査のための初版${suffix}`);
}

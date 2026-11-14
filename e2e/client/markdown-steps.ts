import { expect, type Locator, type Page } from '@playwright/test';

import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
  LINK_ACTION_LABEL,
  LINK_APPLY_LABEL,
  LINK_DIALOG_TITLE,
  LINK_URL_LABEL,
} from '../../apps/frontend-lib/utilities/messages/markdown-messages.ts';

// 編集領域が選択を状態に取り込むと、その選択の直上に現れる浮動ツールバー。取り込む前にダイアログへフォーカスを移すと、選択が空のままリンクが付かない
const FLOATING_TOOLBAR_SELECTOR = '.milkdown-toolbar[data-show="true"]';

export interface MarkdownLink {
  readonly text: string;
  readonly url: string;
}

export const markdownEditable = (scope: Locator, label: string): Locator =>
  scope.getByRole('textbox', { name: label, exact: true });

// 入力欄は読み込みの後に編集できるようになり、値はフォーカスが外れた時に確定する。書式のツールが押せるようになってから入力し、次の操作のフォーカスの移動で確定させる。リンクは、段落を分けて入力した文字を行頭まで選んで書式のツールバーの「リンク」のダイアログで設定する。選択の直上に編集領域の浮動ツールバーが現れて書式のツールバーの押下を遮るため、ボタンへ直接クリックを送る
export async function fillMarkdownWithLink(
  page: Page,
  scope: Locator,
  label: string,
  text: string,
  link: MarkdownLink,
): Promise<void> {
  const editable = markdownEditable(scope, label);
  const toolbar = scope.getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL });
  await expect(editable).toBeVisible();
  await expect(
    toolbar.getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  await editable.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.keyboard.type(link.text);
  await page.keyboard.press('Shift+Home');
  await expect(page.locator(FLOATING_TOOLBAR_SELECTOR)).toBeVisible();
  await toolbar
    .getByRole('button', { name: LINK_ACTION_LABEL, exact: true })
    .dispatchEvent('click');
  const dialog = page.getByRole('dialog', { name: LINK_DIALOG_TITLE });
  const urlField = dialog.getByLabel(LINK_URL_LABEL, { exact: true });
  await expect(urlField).toBeFocused();
  await urlField.fill(link.url);
  await dialog
    .getByRole('button', { name: LINK_APPLY_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expectMarkdownLink(scope, label, link);
}

export async function expectMarkdownLink(
  scope: Locator,
  label: string,
  link: MarkdownLink,
): Promise<void> {
  await expect(
    markdownEditable(scope, label).locator('a', { hasText: link.text }),
  ).toHaveAttribute('href', link.url);
}

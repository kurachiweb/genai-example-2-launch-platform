import { expect, type Locator, type Page } from '@playwright/test';

import {
  CATEGORY_CREATE_LABEL,
  CATEGORY_CREATE_SUBMIT_LABEL,
  CATEGORY_DELETE_LABEL,
  CATEGORY_EDIT_LABEL,
  CATEGORY_HANDLE_LABEL,
  CATEGORY_UPDATE_SUBMIT_LABEL,
  categoryDeleteTitle,
  categoryEditTitle,
  categoryRowActionTarget,
  REQUIRED_CATEGORY_NAME_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';

export const CATEGORIES_PATH = '/categories';

export interface CategoryValues {
  readonly name: string;
  readonly handle?: string;
}

// カテゴリのページは種類ごとの区画を並べるため、区画の見出しで絞り込む
export const categorySection = (page: Page, title: string): Locator =>
  page.getByRole('main').getByRole('region', { name: title, exact: true });

export const categoryRows = (page: Page, title: string): Locator =>
  categorySection(page, title)
    .getByRole('table', { name: title, exact: true })
    .getByRole('row');

// 行の操作は読み上げだけのカテゴリ名を前に置いた名前を持つ
export const categoryRowAction = (
  page: Page,
  title: string,
  categoryName: string,
  label: string,
): Locator =>
  categorySection(page, title).getByRole('button', {
    name: `${categoryRowActionTarget(categoryName)}${label}`,
    exact: true,
  });

async function fillCategoryForm(
  dialog: Locator,
  values: CategoryValues,
  submitLabel: string,
): Promise<void> {
  await dialog
    .getByLabel(REQUIRED_CATEGORY_NAME_LABEL, { exact: true })
    .fill(values.name);
  if (values.handle !== undefined) {
    await dialog
      .getByLabel(CATEGORY_HANDLE_LABEL, { exact: true })
      .fill(values.handle);
  }
  await dialog.getByRole('button', { name: submitLabel, exact: true }).click();
}

export async function createCategory(
  page: Page,
  title: string,
  values: CategoryValues,
): Promise<void> {
  await categorySection(page, title)
    .getByRole('button', { name: CATEGORY_CREATE_LABEL, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: CATEGORY_CREATE_LABEL });
  await fillCategoryForm(dialog, values, CATEGORY_CREATE_SUBMIT_LABEL);
  await expect(dialog).toHaveCount(0);
  await expect(
    categoryRows(page, title).filter({ hasText: values.name }),
  ).toHaveCount(1);
}

// 編集のダイアログで保存を送り、ダイアログを返す。拒否されたときはダイアログが開いたまま理由を示す
export async function submitCategoryEdit(
  page: Page,
  title: string,
  currentName: string,
  values: CategoryValues,
): Promise<Locator> {
  await categoryRowAction(
    page,
    title,
    currentName,
    CATEGORY_EDIT_LABEL,
  ).click();
  const dialog = page.getByRole('dialog', {
    name: categoryEditTitle(currentName),
  });
  await fillCategoryForm(dialog, values, CATEGORY_UPDATE_SUBMIT_LABEL);
  return dialog;
}

// 区画は表示の時点の一覧を持つため、ページを読み込み直してから削除の確認を開く。読み込み直した直後はハイドレーションの前に押した操作が効かないため、確認が開くまで押し直す
export async function openCategoryDeletionAfterReload(
  page: Page,
  title: string,
  name: string,
): Promise<Locator> {
  await page.goto(CATEGORIES_PATH);
  const dialog = page.getByRole('dialog', { name: categoryDeleteTitle(name) });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await categoryRowAction(page, title, name, CATEGORY_DELETE_LABEL).click();
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  return dialog;
}

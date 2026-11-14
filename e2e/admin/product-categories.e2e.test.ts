import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import {
  PRODUCT_CATEGORIES_TITLE,
  PRODUCT_CATEGORY_DELETE_DESCRIPTION,
} from '../../apps/admin/src/components/product/product-category-messages.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../apps/common-lib/product/product-category-constants.ts';
import {
  AUDITED_ACTION_NOTICE,
  CATEGORY_DELETE_LABEL,
  CATEGORY_EDIT_LABEL,
  CONFIRM_ACTION_CANCEL_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { createTestAccount } from '../client/auth/account-steps.ts';
import { uniqueText } from '../client/inquiry/inquiry-steps.ts';
import {
  createProductInput,
  expectMyProductCard,
  fillProduct,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  registerProduct,
  upcomingLaunchDates,
} from '../client/product-steps.ts';
import { registerVerifiedAccount } from '../client/profile-steps.ts';
import {
  CATEGORIES_PATH,
  type CategoryValues,
  categoryRowAction,
  categoryRows,
  createCategory,
  openCategoryDeletionAfterReload,
  submitCategoryEdit,
} from './category-steps.ts';
import { expect, test } from './client-page-test.ts';

// 管理者の用意と利用者側のプロダクトの登録を1つの流れで行うため、両方の待ちの長さを足す
test.describe.configure({
  timeout: ADMIN_FLOW_TIMEOUT_MS + PRODUCT_FLOW_TIMEOUT_MS,
});

// APIサーバーのプロダクトのエラーの定義(PRODUCT_ERRORSのproduct_category_protected・product_category_in_use)の文言。定義のファイルはWorkersの型を前提とする部品を読み込み、ルートの型検査に含められないため写して持つ
const CATEGORY_PROTECTED_MESSAGE = `標準カテゴリ「${PRODUCT_CATEGORY_OTHER_NAME}」は変更・削除できません。`;

const CATEGORY_IN_USE_MESSAGE =
  'このカテゴリにはプロダクトが紐付いているため削除できません。削除から14日以内のプロダクトも含みます。';

// 前の実行で追加したカテゴリと名前・ハンドルが重ならないよう、乱数から作る
const createCategoryValues = (label: string): Required<CategoryValues> => ({
  name: uniqueText(label),
  handle: `e2e-category-${randomBytes(6).toString('hex')}`,
});

const productCategoryRow = (page: Page, name: string): Locator =>
  categoryRows(page, PRODUCT_CATEGORIES_TITLE).filter({ hasText: name });

async function expectCategoryRow(
  page: Page,
  values: Required<CategoryValues>,
): Promise<void> {
  const row = productCategoryRow(page, values.name);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(values.handle);
}

async function renameCategory(
  page: Page,
  currentName: string,
  values: Required<CategoryValues>,
): Promise<void> {
  const dialog = await submitCategoryEdit(
    page,
    PRODUCT_CATEGORIES_TITLE,
    currentName,
    values,
  );
  await expect(dialog).toHaveCount(0);
  await expect(productCategoryRow(page, currentName)).toHaveCount(0);
  await expectCategoryRow(page, values);
}

// 標準カテゴリは削除の操作を示さず、名前の変更の送信はAPIサーバーが拒否して理由をダイアログに示す
async function expectOtherCategoryProtected(page: Page): Promise<void> {
  const otherRow = categoryRows(page, PRODUCT_CATEGORIES_TITLE).last();
  await expect(otherRow).toContainText(PRODUCT_CATEGORY_OTHER_NAME);
  await expect(otherRow).toContainText(PRODUCT_CATEGORY_OTHER_HANDLE);
  await expect(
    categoryRowAction(
      page,
      PRODUCT_CATEGORIES_TITLE,
      PRODUCT_CATEGORY_OTHER_NAME,
      CATEGORY_DELETE_LABEL,
    ),
  ).toHaveCount(0);
  await expect(
    categoryRowAction(
      page,
      PRODUCT_CATEGORIES_TITLE,
      PRODUCT_CATEGORY_OTHER_NAME,
      CATEGORY_EDIT_LABEL,
    ),
  ).toBeVisible();

  const dialog = await submitCategoryEdit(
    page,
    PRODUCT_CATEGORIES_TITLE,
    PRODUCT_CATEGORY_OTHER_NAME,
    { name: uniqueText('その他の変更'), handle: PRODUCT_CATEGORY_OTHER_HANDLE },
  );
  await expect(dialog.getByRole('alert')).toHaveText(
    CATEGORY_PROTECTED_MESSAGE,
  );
  await dialog
    .getByRole('button', { name: CONFIRM_ACTION_CANCEL_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(otherRow).toContainText(PRODUCT_CATEGORY_OTHER_NAME);
}

// 紐付くプロダクトのあるカテゴリの削除はAPIサーバーが拒否し、確認のダイアログに理由を示して行を残す
async function expectDeletionRejected(page: Page, name: string): Promise<void> {
  const dialog = await openCategoryDeletionAfterReload(
    page,
    PRODUCT_CATEGORIES_TITLE,
    name,
  );
  await expect(dialog).toContainText(PRODUCT_CATEGORY_DELETE_DESCRIPTION);
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  await dialog
    .getByRole('button', { name: CATEGORY_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toHaveText(CATEGORY_IN_USE_MESSAGE);
  await dialog
    .getByRole('button', { name: CONFIRM_ACTION_CANCEL_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(productCategoryRow(page, name)).toHaveCount(1);
}

test.describe('プロダクトカテゴリの管理', () => {
  test('モデレーターが追加したカテゴリの名前とハンドルを変更でき、「その他」は削除も名前の変更もできず、利用者がそのカテゴリでプロダクトを登録した後はカテゴリの削除が拒否される', async ({
    page,
    clientPage,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openFromAdminNavigation(page, admin, CATEGORIES_PATH);
    const created = createCategoryValues('カテゴリ');
    await createCategory(page, PRODUCT_CATEGORIES_TITLE, created);
    await expectCategoryRow(page, created);

    const renamed = createCategoryValues('変更後のカテゴリ');
    await renameCategory(page, created.name, renamed);
    await expectOtherCategoryProtected(page);

    await registerVerifiedAccount(clientPage, createTestAccount());
    const input = { ...createProductInput(), categoryName: renamed.name };
    const [launchDate] = upcomingLaunchDates();
    const form = await openProductRegistration(clientPage);
    await fillProduct(clientPage, form, input, launchDate);
    await registerProduct(clientPage, form);
    await expectMyProductCard(clientPage, input, launchDate);

    await expectDeletionRejected(page, renamed.name);
  });
});

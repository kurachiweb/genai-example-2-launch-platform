import type { Page } from '@playwright/test';

import { CATEGORY_LABEL } from '../../apps/admin/src/components/inquiry/admin-inquiries-messages.ts';
import {
  INQUIRY_CATEGORIES_TITLE,
  inquiryCategoryDeleteDescription,
} from '../../apps/admin/src/components/inquiry/inquiry-category-messages.ts';
import { INQUIRY_CATEGORY_OTHER_NAME } from '../../apps/common-lib/inquiry/inquiry-category-constants.ts';
import {
  AUDITED_ACTION_NOTICE,
  CATEGORY_DELETE_LABEL,
  CATEGORY_EDIT_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import {
  createGuestInquiryInput,
  expectGuestInquiryCompleted,
  INQUIRY_FLOW_TIMEOUT_MS,
  openContactForm,
  submitGuestInquiry,
  uniqueText,
} from '../client/inquiry/inquiry-steps.ts';
import {
  CATEGORIES_PATH,
  categoryRowAction,
  categoryRows,
  createCategory,
  openCategoryDeletionAfterReload,
} from './category-steps.ts';
import { expect, test } from './client-page-test.ts';
import { inquiryDetailValue, openInquiryFromList } from './inquiry-steps.ts';

// 管理者の用意と利用者側の問い合わせの送信を1つの流れで行うため、両方の待ちの長さを足す
test.describe.configure({
  timeout: ADMIN_FLOW_TIMEOUT_MS + INQUIRY_FLOW_TIMEOUT_MS,
});

async function expectOtherCategoryProtected(page: Page): Promise<void> {
  await expect(
    categoryRows(page, INQUIRY_CATEGORIES_TITLE).last(),
  ).toContainText(INQUIRY_CATEGORY_OTHER_NAME);
  await expect(
    categoryRowAction(
      page,
      INQUIRY_CATEGORIES_TITLE,
      INQUIRY_CATEGORY_OTHER_NAME,
      CATEGORY_EDIT_LABEL,
    ),
  ).toBeVisible();
  await expect(
    categoryRowAction(
      page,
      INQUIRY_CATEGORIES_TITLE,
      INQUIRY_CATEGORY_OTHER_NAME,
      CATEGORY_DELETE_LABEL,
    ),
  ).toHaveCount(0);
}

// 紐付く件数は区画の表示の時点で取得するため、問い合わせを送った後にページを読み込み直してから削除の確認を開く
async function deleteCategoryAfterReload(
  page: Page,
  name: string,
  linkedCount: number,
): Promise<void> {
  const dialog = await openCategoryDeletionAfterReload(
    page,
    INQUIRY_CATEGORIES_TITLE,
    name,
  );
  await expect(dialog).toContainText(
    inquiryCategoryDeleteDescription(linkedCount),
  );
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  await dialog
    .getByRole('button', { name: CATEGORY_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    categoryRows(page, INQUIRY_CATEGORIES_TITLE).filter({ hasText: name }),
  ).toHaveCount(0);
}

test.describe('問い合わせカテゴリの管理', () => {
  test('モデレーターが追加したカテゴリを利用者が問い合わせで選べ、そのカテゴリを削除すると問い合わせのカテゴリが「その他」に付け替わり、「その他」には削除の操作が無い', async ({
    page,
    clientPage,
  }) => {
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    await openFromAdminNavigation(page, admin, CATEGORIES_PATH);
    const categoryName = uniqueText('カテゴリ');
    await createCategory(page, INQUIRY_CATEGORIES_TITLE, {
      name: categoryName,
    });
    await expectOtherCategoryProtected(page);

    const input = { ...createGuestInquiryInput(), categoryName };
    await submitGuestInquiry(await openContactForm(clientPage), input);
    await expectGuestInquiryCompleted(clientPage);

    await openInquiryFromList(page, admin, input.nickname);
    await expect(inquiryDetailValue(page, CATEGORY_LABEL)).toHaveText(
      categoryName,
    );

    await deleteCategoryAfterReload(page, categoryName, 1);
    await expectOtherCategoryProtected(page);

    await openInquiryFromList(page, admin, input.nickname);
    await expect(inquiryDetailValue(page, CATEGORY_LABEL)).toHaveText(
      INQUIRY_CATEGORY_OTHER_NAME,
    );
  });
});

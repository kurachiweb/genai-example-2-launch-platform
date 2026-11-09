import { LAUNCH_HISTORY_EMPTY_TITLE } from '../../apps/client/src/components/launch-history/launch-history-messages.ts';
import { MY_PRODUCTS_EMPTY_TITLE } from '../../apps/client/src/components/product/my-product-messages.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { createTestAccount } from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  chooseLaunchDate,
  createProductHandle,
  createProductInput,
  deleteProduct,
  expectLaunchHistoryItem,
  expectMyProductCard,
  expectSavedProduct,
  fillProduct,
  fillProductHandle,
  productArticle,
  myProductEditPath,
  openMyProducts,
  openProductEditor,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  registerProduct,
  requestWithoutFollowing,
  saveProductChanges,
  upcomingLaunchDates,
} from './product-steps.ts';
import {
  openProfileEditor,
  openPublicProfile,
  readCurrentHandle,
  registerVerifiedAccount,
} from './profile-steps.ts';

test.describe.configure({ timeout: PRODUCT_FLOW_TIMEOUT_MS });

const REDIRECT_STATUS = 302;

const pathOf = (url: string, baseURL: string | undefined): string =>
  new URL(url, baseURL).pathname;

test.describe('自分のプロダクト', () => {
  test('登録したプロダクトが一覧にキックオフ予定で出て、ハンドルの変更で旧ハンドルの編集画面が転送され、ローンチ日を変えると本人のローンチ履歴にだけ未掲載のバッジ付きで出て、削除すると一覧から消える', async ({
    page,
    browser,
    baseURL,
  }) => {
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    const profileHandle = await readCurrentHandle(
      await openProfileEditor(page, account),
    );
    const input = createProductInput();
    const [registeredDate, changedDate] = upcomingLaunchDates();

    const registrationForm = await openProductRegistration(page);
    await fillProduct(page, registrationForm, input, registeredDate);
    await registerProduct(page, registrationForm);

    await expectMyProductCard(page, input, registeredDate);

    const handleForm = await openProductEditor(page, input.name);
    await expectSavedProduct(handleForm, input, registeredDate);
    const changedHandle = createProductHandle();
    await fillProductHandle(handleForm, changedHandle);
    await saveProductChanges(page, handleForm);
    await expect(page).toHaveURL(
      (url) => pathOf(url.href, baseURL) === myProductEditPath(changedHandle),
    );

    const redirect = await requestWithoutFollowing(
      page,
      myProductEditPath(input.handle),
    );
    expect(redirect.status).toBe(REDIRECT_STATUS);
    expect(pathOf(redirect.location ?? '', baseURL)).toBe(
      myProductEditPath(changedHandle),
    );

    const launchDateForm = await openProductEditor(page, input.name);
    await expect(page).toHaveURL(
      (url) => pathOf(url.href, baseURL) === myProductEditPath(changedHandle),
    );
    await chooseLaunchDate(launchDateForm, changedDate);
    await saveProductChanges(page, launchDateForm);
    await expectMyProductCard(
      page,
      { ...input, handle: changedHandle },
      changedDate,
    );

    await openPublicProfile(page, profileHandle);
    await expectLaunchHistoryItem(page, input, changedDate);

    const guestContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(guestContext, baseURL);
      const guestPage = await guestContext.newPage();
      await openPublicProfile(guestPage, profileHandle);
      await expect(
        guestPage.getByText(LAUNCH_HISTORY_EMPTY_TITLE),
      ).toBeVisible();
      await expect(productArticle(guestPage, input.name)).toHaveCount(0);
    } finally {
      await guestContext.close();
    }

    const deleteForm = await openProductEditor(page, input.name);
    await deleteProduct(page, deleteForm, input.name);
    await openMyProducts(page);
    await expect(productArticle(page, input.name)).toHaveCount(0);
    await expect(page.getByText(MY_PRODUCTS_EMPTY_TITLE)).toBeVisible();
  });
});

import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';

import { ADMIN_FLOW_TIMEOUT_MS } from '../../support/admin-bootstrap.ts';
import { createListedProducts } from '../../support/directory-fixtures.ts';
import { KeyboardOperator } from '../../support/keyboard-operator.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
  openAccountSettings as openAccountSettingsForKeyboard,
  registerAccount,
} from '../auth/account-steps.ts';
import { CHECKOUT_FLOW_TIMEOUT_MS } from '../checkout-steps.ts';
import { openEngagementProductPage } from '../engagement-steps.ts';
import {
  createMatchCategory,
  isNearQualifierFullTime,
  type MatchProductNames,
  moveLaunchesToDate,
  openTopPageMatch,
  QUALIFIER_FULL_TIME_SKIP_REASON,
  startQualifiers,
  todayBusinessDate,
} from '../match-steps.ts';
import {
  createProductInput,
  fillProduct,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  type ProductInput,
  registerProduct,
  upcomingLaunchDates,
} from '../product-steps.ts';
import { registerVerifiedAccount } from '../profile-steps.ts';
import {
  consentByKeyboard,
  editProfileByKeyboard,
  openSecuritySettingsByKeyboard,
  openSettingsByKeyboard,
  registerByKeyboard,
  startCheckoutByKeyboard,
} from './keyboard-account-steps.ts';
import {
  openCommentMenuAndEscape,
  postCommentByKeyboard,
  reportProductByKeyboard,
} from './keyboard-engagement-steps.ts';
import { upvoteAndCancelByKeyboard } from './keyboard-match-steps.ts';
import { registerProductByKeyboard } from './keyboard-product-steps.ts';
import { test } from './keyboard-flows-test.ts';

const SUFFIX_BYTES = 4;

// 登録・メールの確認・データの用意・キーボードの操作の分を足す
const FLOW_TIMEOUT_MS = MAIL_FLOW_TIMEOUT_MS * 3;

// 管理者の用意・2人のプロダクトの登録・3人目の登録とキーボードの操作を1つの流れで行うため、それぞれの待ちの長さを足す
const MATCH_FLOW_TIMEOUT_MS =
  ADMIN_FLOW_TIMEOUT_MS +
  PRODUCT_FLOW_TIMEOUT_MS * 2 +
  MAIL_FLOW_TIMEOUT_MS * 2;

const COMMENT_BODY = `E2Eのキーボード操作のコメント${randomBytes(SUFFIX_BYTES).toString('hex')}です。`;

async function registerOwnerProduct(
  page: Page,
  categoryName: string,
): Promise<ProductInput> {
  await registerVerifiedAccount(page, createTestAccount());
  const input = { ...createProductInput(), categoryName };
  const [launchDate] = upcomingLaunchDates();
  const form = await openProductRegistration(page);
  await fillProduct(page, form, input, launchDate);
  await registerProduct(page, form);
  return input;
}

// 操作の対象は実行のたびに乱数の接尾辞で別に作り、前回の実行のデータを消さないため、後片付けをしない。マウスもクリックも使わず、`page.keyboard`のキーだけで操作する
test.describe('利用者側のキーボード操作', () => {
  test('登録のフォームを、Tabで入力欄・規約への同意・送信のボタンへ移り、入力とSpaceとEnterだけで送信でき、登録の後のページでTabの移動が先へ進む', async ({
    page,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    const operator = new KeyboardOperator(page);

    await registerByKeyboard(operator, account);

    await operator.expectTabAdvancesThroughPage('登録の後のページ');
  });

  test('ユーザーメニューを開いて設定へ移り、プロフィールのヘッドラインを保存し、設定のナビゲーションからセキュリティの設定を開くまでをキーボードだけで操作でき、メニューはEscapeで閉じる', async ({
    page,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerAccount(page, account);
    const operator = new KeyboardOperator(page);

    await openSettingsByKeyboard(operator, account);
    await editProfileByKeyboard(
      operator,
      `E2Eのキーボード操作のヘッドライン${randomBytes(SUFFIX_BYTES).toString('hex')}`,
    );
    await openSecuritySettingsByKeyboard(operator);

    await operator.expectTabAdvancesThroughPage('セキュリティの設定');
  });

  test('プロダクトの登録のフォームを、画像の選択とEscapeでの取り消し・選択の部品・説明文の編集領域・カレンダーを含め、キーボードだけで入力して送信できる', async ({
    page,
  }) => {
    test.setTimeout(PRODUCT_FLOW_TIMEOUT_MS * 2);
    await registerVerifiedAccount(page, createTestAccount());
    const operator = new KeyboardOperator(page);

    await registerProductByKeyboard(operator, createProductInput());

    await operator.expectTabAdvancesThroughPage('自分のプロダクトの一覧');
  });

  test('当日の予選の対戦カードのUpvoteをEnterで、取り消しをSpaceで、キーボードだけで押せる', async ({
    page,
    openAdminPage,
    openClientPage,
  }) => {
    test.setTimeout(MATCH_FLOW_TIMEOUT_MS);
    test.skip(
      isNearQualifierFullTime(new Date()),
      QUALIFIER_FULL_TIME_SKIP_REASON,
    );
    const today = todayBusinessDate();
    const adminPage = await openAdminPage();
    const categoryName = await createMatchCategory(adminPage);
    await adminPage.context().close();
    const own = await registerOwnerProduct(page, categoryName);
    const rival = await registerOwnerProduct(
      await openClientPage(),
      categoryName,
    );
    await moveLaunchesToDate([own.handle, rival.handle], today);
    await startQualifiers(today);

    const supporterPage = await openClientPage();
    await registerVerifiedAccount(supporterPage, createTestAccount());
    const names: MatchProductNames = [own.name, rival.name];
    const card = await openTopPageMatch(supporterPage, names);
    const operator = new KeyboardOperator(supporterPage);

    await upvoteAndCancelByKeyboard(operator, card, own.name);

    await operator.expectTabAdvancesThroughPage('トップページ');
  });

  test('プロダクトページのコメント欄へ本文を入力して星の評価を選んで送信でき、コメントの操作のメニューはEscapeで閉じる', async ({
    page,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const {
      products: [product],
    } = await createListedProducts({ count: 1 });
    if (product === undefined) {
      throw new Error('掲載中のプロダクトを作れませんでした');
    }
    await registerVerifiedAccount(page, createTestAccount());
    await openEngagementProductPage(page, product);
    const operator = new KeyboardOperator(page);

    const article = await postCommentByKeyboard(operator, COMMENT_BODY);
    await openCommentMenuAndEscape(operator, article);

    await operator.expectTabAdvancesThroughPage('プロダクトページ');
  });

  test('未ログインの閲覧者が、プロダクトの通報のダイアログを開き、Escapeで閉じ、開き直してカテゴリと理由を入力して送信するまでをキーボードだけで操作できる', async ({
    page,
  }) => {
    const {
      products: [product],
    } = await createListedProducts({ count: 1 });
    if (product === undefined) {
      throw new Error('掲載中のプロダクトを作れませんでした');
    }
    await openEngagementProductPage(page, product);
    const operator = new KeyboardOperator(page);

    await reportProductByKeyboard(operator, page);

    await operator.expectTabAdvancesThroughPage('プロダクトページ');
  });

  test('決済履歴の疎通確認の購入の開始をキーボードだけで押し、決済画面の同意のチェックボックスをSpaceで選べる', async ({
    page,
  }) => {
    test.setTimeout(CHECKOUT_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    await openAccountSettingsForKeyboard(page, account);
    const operator = new KeyboardOperator(page);

    await startCheckoutByKeyboard(operator);
    await consentByKeyboard(operator);

    await operator.expectTabAdvancesThroughPage('決済画面');
  });
});

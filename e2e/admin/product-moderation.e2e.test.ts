import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { createModerationTargets } from '../support/moderation-fixtures.ts';
import { expectProductNotFound } from '../client/directory-steps.ts';
import { test } from './client-page-test.ts';
import {
  expectHiddenProductDetail,
  expectProductHiddenNotice,
  expectPublicProductPage,
  expectVisibleProductDetail,
  moderateProductVisibility,
  openAdminProductDetail,
} from './product-moderation-steps.ts';

// 管理者の招待の完了に、ローカルのD1の操作と非公開化の通知の待ちと利用者側の確認の分を足す
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 2 });

// 監査ログと通知に残る理由。個人情報を含めない
const HIDE_REASON = 'E2Eの掲載基準違反による非公開化の確認';

const UNHIDE_REASON = 'E2Eの復元の確認';

// 措置の対象は実行のたびに乱数の接尾辞で別に作り、前回の実行のデータを消さないため、後片付けをしない
test.describe('プロダクトの措置(管理者側)', () => {
  test('モデレーターがプロダクトの詳細で非公開化すると、利用者側の詳細ページが他者に404になり、投稿者へ通知が届き、理由を入力した復元で表示に戻る', async ({
    page,
    clientPage,
  }) => {
    const targets = await createModerationTargets();
    const product = {
      handle: targets.productHandle,
      name: targets.productName,
    };
    await expectPublicProductPage(clientPage, product);
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });

    const hiddenAfter = new Date();
    await openAdminProductDetail(page, admin, product);
    await moderateProductVisibility(
      page,
      'product.hide',
      product.name,
      HIDE_REASON,
    );
    await expectHiddenProductDetail(page, HIDE_REASON);

    await expectProductNotFound(clientPage, product.handle);
    await expectProductHiddenNotice(
      targets.product.ownerEmail,
      product,
      HIDE_REASON,
      hiddenAfter,
    );

    await moderateProductVisibility(
      page,
      'product.unhide',
      product.name,
      UNHIDE_REASON,
    );
    await expectVisibleProductDetail(page);
    await expectPublicProductPage(clientPage, product);
  });
});

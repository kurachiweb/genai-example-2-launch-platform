import { createTestAccount } from '../client/auth/account-steps.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { test } from './client-page-test.ts';
import {
  approveQuarantinedAvatar,
  expectQuarantinedImageLoaded,
  openAutoQuarantinedAvatar,
  registerAutoQuarantinedAvatar,
} from './media-moderation-steps.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

// 利用者と画像は実行ごとに新しく作り、承認した画像は隔離画像の一覧から外れるため、後片付けをしない
test.describe('画像モデレーション(管理者側)', () => {
  test('利用者が登録した99×99のプロフィール画像は自動判定で隔離され、モデレーターの自動判定のタブに読み込まれた画像で表示され、公開承認で一覧から消える', async ({
    page,
    clientPage,
  }) => {
    const owner = await registerAutoQuarantinedAvatar(
      clientPage,
      createTestAccount(),
    );

    await signInAsNewAdmin(page, { role: 'moderator' });
    const card = await openAutoQuarantinedAvatar(page, owner);
    await expectQuarantinedImageLoaded(card);

    await approveQuarantinedAvatar(page, card, owner);
  });
});

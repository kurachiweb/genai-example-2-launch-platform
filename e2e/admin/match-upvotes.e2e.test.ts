import type { Page } from '@playwright/test';

import { ADMIN_FLOW_TIMEOUT_MS } from '../support/admin-bootstrap.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
} from '../client/auth/account-steps.ts';
import {
  cancelUpvote,
  createMatchCategory,
  expectAutoRefreshSwitch,
  expectLiveUpvoteHistoryItem,
  expectOwnMatchRestriction,
  expectUpvoteState,
  isNearQualifierFullTime,
  type MatchProductNames,
  moveLaunchesToDate,
  openTopPageMatch,
  QUALIFIER_FULL_TIME_SKIP_REASON,
  startQualifiers,
  todayBusinessDate,
  upvoteEntry,
} from '../client/match-steps.ts';
import {
  createProductInput,
  fillProduct,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  type ProductInput,
  registerProduct,
  upcomingLaunchDates,
} from '../client/product-steps.ts';
import {
  openProfileEditor,
  readCurrentHandle,
  registerVerifiedAccount,
} from '../client/profile-steps.ts';
import { test } from './client-page-test.ts';

// 管理者の用意・2人のプロダクトの登録・3人目の登録を1つの流れで行うため、それぞれの待ちの長さを足す
test.describe.configure({
  timeout:
    ADMIN_FLOW_TIMEOUT_MS + PRODUCT_FLOW_TIMEOUT_MS * 2 + MAIL_FLOW_TIMEOUT_MS,
});

// 確認済みの利用者として登録し、専用のカテゴリでプロダクトを登録する。ローンチ日は画面で選べる日に登録し、後で当日へ書き換える
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

test.describe('トップページの予選のマッチ', () => {
  test('当日の予選で組まれた2つのプロダクトの対戦カードで、利用者がUpvote・付け替え・取り消しをするとUpvote数と通知が変わり、投稿者には自分の側のボタンが無く相手の側が理由付きで押せず、再びUpvoteするとUpvote履歴に未掲載・マッチ中の項目が出る', async ({
    page,
    clientPage,
    openClientPage,
  }) => {
    test.skip(
      isNearQualifierFullTime(new Date()),
      QUALIFIER_FULL_TIME_SKIP_REASON,
    );
    const today = todayBusinessDate();
    const categoryName = await createMatchCategory(page);

    const ownerPage = clientPage;
    const rivalPage = await openClientPage();
    const supporterPage = await openClientPage();
    const own = await registerOwnerProduct(ownerPage, categoryName);
    const rival = await registerOwnerProduct(rivalPage, categoryName);
    await moveLaunchesToDate([own.handle, rival.handle], today);
    await startQualifiers(today);

    const supporter = createTestAccount();
    await registerVerifiedAccount(supporterPage, supporter);
    const supporterHandle = await readCurrentHandle(
      await openProfileEditor(supporterPage, supporter),
    );

    const names: MatchProductNames = [own.name, rival.name];
    const card = await openTopPageMatch(supporterPage, names);
    await expectAutoRefreshSwitch(supporterPage);
    await expectUpvoteState(card, own.name, { count: 0, upvoted: false });
    await expectUpvoteState(card, rival.name, { count: 0, upvoted: false });

    await upvoteEntry(supporterPage, card, own.name);
    await expectUpvoteState(card, own.name, { count: 1, upvoted: true });
    await expectUpvoteState(card, rival.name, { count: 0, upvoted: false });

    await upvoteEntry(supporterPage, card, rival.name);
    await expectUpvoteState(card, own.name, { count: 0, upvoted: false });
    await expectUpvoteState(card, rival.name, { count: 1, upvoted: true });

    await cancelUpvote(supporterPage, card, rival.name);
    await expectUpvoteState(card, own.name, { count: 0, upvoted: false });
    await expectUpvoteState(card, rival.name, { count: 0, upvoted: false });

    const ownerCard = await openTopPageMatch(ownerPage, names);
    await expectOwnMatchRestriction(ownerPage, ownerCard, own.name, rival.name);

    await upvoteEntry(supporterPage, card, rival.name);
    await expectUpvoteState(card, rival.name, { count: 1, upvoted: true });
    await expectLiveUpvoteHistoryItem(
      supporterPage,
      supporterHandle,
      rival.name,
    );
  });
});

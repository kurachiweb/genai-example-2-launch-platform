import { assumeDistinctClientIp } from '../support/client-ip.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
} from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  expectFollowerCount,
  expectFollowing,
  expectNotFollowing,
  expectOwnProfileWithoutFollowButton,
  followFromProfile,
  openFollowList,
  unfollowFromProfile,
} from './follow-steps.ts';
import {
  openProfileEditor,
  openPublicProfile,
  readCurrentHandle,
  registerVerifiedAccount,
} from './profile-steps.ts';

test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS });

test.describe('フォロー', () => {
  test('フォローするとフォロワー数とフォロー一覧に反映され、解除すると戻り、自分のプロフィールにはフォローのボタンが出ない', async ({
    page,
    browser,
    baseURL,
  }) => {
    const follower = createTestAccount();
    await registerVerifiedAccount(page, follower);
    const followerForm = await openProfileEditor(page, follower);
    const followerHandle = await readCurrentHandle(followerForm);

    const targetContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(targetContext, baseURL);
      const targetPage = await targetContext.newPage();
      const target = createTestAccount();
      await registerVerifiedAccount(targetPage, target);
      const targetForm = await openProfileEditor(targetPage, target);
      const targetHandle = await readCurrentHandle(targetForm);

      await openPublicProfile(page, targetHandle);
      await expectNotFollowing(page);
      await expectFollowerCount(page, 0);

      await followFromProfile(page, targetHandle);
      await expectFollowing(page);
      await expectFollowerCount(page, 1);

      await openFollowList(page, follower, 'following');
      await expect(
        page.getByRole('link', { name: new RegExp(`@${targetHandle}`, 'u') }),
      ).toContainText(target.nickname);

      await openPublicProfile(targetPage, targetHandle);
      await expectFollowerCount(targetPage, 1);
      await openFollowList(targetPage, target, 'followers');
      await expect(
        targetPage.getByRole('link', {
          name: new RegExp(`@${followerHandle}`, 'u'),
        }),
      ).toContainText(follower.nickname);

      await openPublicProfile(page, targetHandle);
      await expectFollowing(page);
      await unfollowFromProfile(page, targetHandle);
      await expectNotFollowing(page);
      await expectFollowerCount(page, 0);

      await expectOwnProfileWithoutFollowButton(page, followerHandle);
    } finally {
      await targetContext.close();
    }
  });
});

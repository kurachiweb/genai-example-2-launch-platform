import { expect, type Locator, type Page } from '@playwright/test';

import {
  FOLLOW_LIST_PAGE_TITLE,
  FOLLOW_LIST_TAB_LABELS,
  FOLLOW_LIST_TABS_LABEL,
} from '../../apps/client/src/components/profile/follow-list-messages.ts';
import {
  FOLLOW_LABEL,
  FOLLOWER_LABEL,
  FOLLOWER_UNIT,
  FOLLOWING_LABEL,
  followedMessageOf,
  PROFILE_EDIT_LABEL,
  unfollowedMessageOf,
} from '../../apps/client/src/components/profile/profile-messages.ts';
import { SETTINGS_NAVIGATION_LABEL } from '../../apps/client/src/components/settings/settings-messages.ts';
import { SETTINGS_NAV_ITEMS } from '../../apps/client/src/composition/settings-navigation.ts';
import type { FollowListDirection } from '../../apps/client/src/graphql/follow-list.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { openProfileSettings, type TestAccount } from './auth/account-steps.ts';
import { openPublicProfile } from './profile-steps.ts';

const FOLLOWS_PATH = '/settings/follows';

const followButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true });

const followsNavLabel = (): string => {
  const item = SETTINGS_NAV_ITEMS.find(({ to }) => to === FOLLOWS_PATH);
  if (item === undefined) {
    throw new Error(`設定のナビゲーションに${FOLLOWS_PATH}の項目がありません`);
  }
  return item.label;
};

export async function expectNotFollowing(page: Page): Promise<void> {
  await expect(followButton(page, FOLLOW_LABEL)).toHaveAttribute(
    'aria-pressed',
    'false',
  );
}

export async function expectFollowing(page: Page): Promise<void> {
  await expect(followButton(page, FOLLOWING_LABEL)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

// 人数は「フォロワー」の見出しの語と「N人」が同じ親の要素に並ぶため、親の表示全体で確かめる
export async function expectFollowerCount(
  page: Page,
  count: number,
): Promise<void> {
  await expect(
    page.getByText(FOLLOWER_LABEL, { exact: true }).locator('..'),
  ).toHaveText(`${FOLLOWER_LABEL}${String(count)}${FOLLOWER_UNIT}`);
}

// ハイドレーションの前に押したボタンは何もしないため、トーストが現れるまで押し直す。押下が効くとラベルが楽観的に反転して元のラベルのボタンが消えるため、元のラベルのボタンが見えている間(押下が効いていない間)だけ押し、消えた後は待つだけにして、上限の無い自動待機で固まるのを避ける
async function toggleFollowUntilNotified(
  page: Page,
  button: Locator,
  message: string,
): Promise<void> {
  await expect(async () => {
    if (!(await page.getByText(message).isVisible())) {
      if (await button.isVisible()) {
        await button.click({ timeout: REACTION_TIMEOUT_MS });
      }
    }
    await expect(page.getByText(message)).toBeVisible({
      timeout: REACTION_TIMEOUT_MS,
    });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

export async function followFromProfile(
  page: Page,
  handle: string,
): Promise<void> {
  await toggleFollowUntilNotified(
    page,
    followButton(page, FOLLOW_LABEL),
    followedMessageOf(handle),
  );
}

export async function unfollowFromProfile(
  page: Page,
  handle: string,
): Promise<void> {
  await toggleFollowUntilNotified(
    page,
    followButton(page, FOLLOWING_LABEL),
    unfollowedMessageOf(handle),
  );
}

// 設定のナビゲーションのリンクで移り、フォロワーの一覧はタブで切り替える。一覧は開いているタブのものだけが描かれる
export async function openFollowList(
  page: Page,
  account: TestAccount,
  direction: FollowListDirection,
): Promise<void> {
  await openProfileSettings(page, account);
  await page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: followsNavLabel(), exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${FOLLOWS_PATH}(\\?|$)`, 'u'));
  await expect(
    page.getByRole('heading', { level: 1, name: FOLLOW_LIST_PAGE_TITLE }),
  ).toBeVisible();
  if (direction === 'following') {
    return;
  }
  await page
    .getByRole('tablist', { name: FOLLOW_LIST_TABS_LABEL })
    .getByRole('tab', { name: FOLLOW_LIST_TAB_LABELS[direction], exact: true })
    .click();
  await expect(page).toHaveURL(/tab=followers/u);
}

// 自分のプロフィールでは、編集のリンクが出てフォローのボタンは出ない。編集のリンクの表示を待ってから無いことを確かめる
export async function expectOwnProfileWithoutFollowButton(
  page: Page,
  handle: string,
): Promise<void> {
  await openPublicProfile(page, handle);
  await expect(
    page.getByRole('link', { name: PROFILE_EDIT_LABEL, exact: true }),
  ).toBeVisible();
  await expect(followButton(page, FOLLOW_LABEL)).toHaveCount(0);
  await expect(followButton(page, FOLLOWING_LABEL)).toHaveCount(0);
}

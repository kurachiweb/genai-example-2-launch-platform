import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesContext } from '../../../lib/components/datetime/use-display-preferences.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { elementsOverflowingContainer } from '../../../lib/test/overflow.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { FollowListEntry } from '../../graphql/follow-list.ts';
import { FollowListItem } from './follow-list-item.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// 日時の文言が長くなるロケールで、幅の足りない時の配置を確かめる
const TOKYO_EN: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'en-US',
});

const ENTRY: FollowListEntry = Object.freeze({
  handle: 'pitch_author',
  nickname: 'ピッチの作者',
  avatar: null,
  followedAt: '2026-11-23T00:25:00.000Z',
});

const LIST_TEST_ID = 'follow-list';

const ENLARGED_FONT_SIZE = '150%';

const renderItem = (widthClass: string) =>
  renderInRouter(
    <DisplayPreferencesContext value={TOKYO_EN}>
      <ul data-testid={LIST_TEST_ID} className={widthClass}>
        <FollowListItem entry={ENTRY} direction="following" />
      </ul>
    </DisplayPreferencesContext>,
  );

const item = () => page.getByRole('link', { name: /ピッチの作者/u });

const rectOf = (element: Element): DOMRect => element.getBoundingClientRect();

const timeElement = (): Element => {
  const time = item().element().querySelector('time');
  if (time === null) {
    throw new Error('フォローした日時がありません。');
  }
  return time;
};

const nicknameElement = (): Element =>
  page.getByText(ENTRY.nickname, { exact: true }).element();

afterEach(() => {
  document.documentElement.style.fontSize = '';
  applyColorScheme('light');
});

describe('FollowListItem', () => {
  test('幅が足りるときは、フォローした日時を名前と同じ行の右端に置く', async () => {
    await renderItem('w-[40rem]');
    await expect.element(item()).toBeVisible();
    const link = rectOf(item().element());
    const time = rectOf(timeElement());
    const name = rectOf(nicknameElement());

    expect(time.top).toBeLessThan(name.bottom);
    expect(link.right - time.right).toBeLessThanOrEqual(
      Number.parseFloat(getComputedStyle(item().element()).paddingRight) + 1,
    );
  });

  test('幅320pxの画面の一覧で文字を1.5倍にしても、フォローした日時は項目の枠からはみ出さず、名前の下へ移る', async () => {
    document.documentElement.style.fontSize = ENLARGED_FONT_SIZE;
    await renderItem('w-[272px]');
    await expect.element(item()).toBeVisible();

    expect(
      elementsOverflowingContainer(page.getByTestId(LIST_TEST_ID).element()),
    ).toStrictEqual([]);
    expect(rectOf(timeElement()).top).toBeGreaterThanOrEqual(
      rectOf(nicknameElement()).bottom,
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('幅の狭い一覧で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderItem('w-[272px]');
      await expect.element(item()).toBeVisible();

      expect(
        await runAxe(page.getByTestId(LIST_TEST_ID).element()),
      ).toStrictEqual([]);
    });
  });
});

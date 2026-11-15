import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { SettingsNavItem } from '../../composition/settings-navigation.ts';
import { SettingsShell } from './settings-shell.tsx';

// ログイン中の利用者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const ITEMS: readonly SettingsNavItem[] = Object.freeze([
  { to: '/settings/security', label: 'セキュリティ', order: 30 },
  { to: '/settings/profile', label: 'プロフィール', order: 10 },
  { to: '/settings/account', label: 'アカウント', order: 20 },
]);

const navigation = () => page.getByRole('navigation', { name: '設定' });
const links = () => navigation().getByRole('link');

async function renderShell(path = '/settings/account') {
  return renderInRouter(
    <main>
      <SettingsShell items={ITEMS}>
        <h1>アカウント</h1>
      </SettingsShell>
    </main>,
    { path },
  );
}

const flexDirectionOfList = (): string => {
  const list = navigation().getByRole('list').element();
  return getComputedStyle(list).flexDirection;
};

afterEach(() => {
  applyColorScheme('light');
});

describe('SettingsShell', () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  test('登録された項目だけを順に並べ、現在の項目をaria-currentで示す', async () => {
    await renderShell();

    await expect.element(navigation()).toBeVisible();
    expect(
      links()
        .elements()
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toStrictEqual([
      ['プロフィール', '/settings/profile'],
      ['アカウント', '/settings/account'],
      ['セキュリティ', '/settings/security'],
    ]);
    expect(
      links()
        .elements()
        .map((link) => link.getAttribute('aria-current')),
    ).toStrictEqual([null, 'page', null]);
  });

  test('項目の内容を、ナビゲーションの後に描く', async () => {
    await renderShell();

    const heading = page.getByRole('heading', { level: 1 }).element();
    expect(
      navigation().element().compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('1024px以上では縦の一覧、それ未満では折り返す横並びにする', async () => {
    await renderShell();

    await expect.element(navigation()).toBeVisible();
    expect(flexDirectionOfList()).toBe('column');

    await page.viewport(1023, 800);

    await expect.poll(flexDirectionOfList).toBe('row');
    const list = navigation().getByRole('list').element();
    expect(getComputedStyle(list).flexWrap).toBe('wrap');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderShell();
      await expect.element(navigation()).toBeVisible();

      expect(await runAxe(page.getByRole('main').element())).toStrictEqual([]);
    });
  });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { GuestHero } from './guest-hero.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TITLE = '1対1のマッチでローンチ。必ず半分は勝者になる。';
const DESCRIPTION =
  '同じカテゴリのプロダクトと1日限りの対戦。サポーターのUpvoteで勝てばディレクトリに掲載され、Product of the Weekへの道が開きます。';

const hero = () => page.getByRole('region', { name: TITLE });

const renderHero = () =>
  renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <GuestHero />
    </main>,
  );

afterEach(() => {
  applyColorScheme('light');
});

describe('GuestHero', () => {
  test('キャッチコピーを見出しにした案内に、見出しの上のサービス名と説明を置く', async () => {
    await renderHero();

    await expect
      .element(hero().getByRole('heading', { level: 2, name: TITLE }))
      .toBeVisible();
    await expect
      .element(hero().getByText('Launch Stadium', { exact: true }))
      .toBeVisible();
    await expect
      .element(hero().getByText(DESCRIPTION, { exact: true }))
      .toBeVisible();
    const serviceName = hero()
      .getByText('Launch Stadium', { exact: true })
      .element();
    const heading = hero().getByRole('heading').element();
    expect(
      serviceName.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  test('「登録してローンチする」はユーザー登録へ、「ログイン」はトップページを戻り先にしたログインへ遷移する', async () => {
    await renderHero();

    await expect
      .element(hero().getByRole('link', { name: '登録してローンチする' }))
      .toHaveAttribute('href', '/auth/register');
    await expect
      .element(hero().getByRole('link', { name: 'ログイン', exact: true }))
      .toHaveAttribute('href', '/auth/login?redirect=%2F');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderHero();
      await expect.element(hero()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});

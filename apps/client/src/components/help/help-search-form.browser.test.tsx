import { useRouterState } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { normalizeHelpSearchText } from '../../../common-lib/help/help-query-rules.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { HelpSearchForm } from './help-search-form.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOO_LONG_MESSAGE = '検索キーワードは50文字以内で入力してください。';

const OVER_LIMIT_ANNOUNCEMENT = '文字数が上限の50文字を超えています。';

const WITHIN_LIMIT_ANNOUNCEMENT = '文字数が上限以内に戻りました。';

const searchRegion = () => page.getByRole('search', { name: 'ヘルプ記事' });
const searchInput = () =>
  page.getByRole('searchbox', { name: '検索キーワード' });
const submitButton = () =>
  page.getByRole('button', { name: '検索', exact: true });
const clearButton = () =>
  page.getByRole('button', { name: '検索キーワードを消去' });
const counter = () => page.getByText(/^\d+\/50$/u);

// ルートのvalidateSearchと同じく、URLの検索語を正規化して部品へ渡す
function HelpSearchFormAtUrl() {
  const q = useRouterState({
    select: ({ location }) =>
      normalizeHelpSearchText(
        (location.search as Readonly<Record<string, unknown>>).q,
      ),
  });
  return (
    <div className="bg-background p-4 text-foreground">
      <HelpSearchForm value={q} />
    </div>
  );
}

const renderAt = (path: string) =>
  renderInRouter(<HelpSearchFormAtUrl />, { path });

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpSearchForm', () => {
  test('名前「ヘルプ記事」の検索の領域に、例文付きの検索欄と「検索」のボタンを置き、URLの検索語を入力欄に示す', async () => {
    await renderAt('/help?q=Upvote');

    await expect.element(searchRegion()).toBeInTheDocument();
    await expect.element(searchInput()).toHaveValue('Upvote');
    await expect
      .element(searchInput())
      .toHaveAttribute('placeholder', 'タイトル・サブタイトル・本文で検索');
    await expect.element(submitButton()).toBeInTheDocument();
  });

  test('記事詳細からでも、入力中は移動せず、Enterキーで前後の空白を除いた検索語のヘルプトップへ移動する', async () => {
    const router = await renderAt('/help/upvote-rules');

    await userEvent.type(searchInput(), '  ピン留め 記事 ');
    expect(router.state.location.pathname).toBe('/help/upvote-rules');

    await userEvent.keyboard('{Enter}');

    await expect.poll(() => router.state.location.pathname).toBe('/help');
    expect(router.state.location.search).toEqual({ q: 'ピン留め 記事' });
  });

  test('「検索」のボタンでも移動し、空白だけの入力では検索語の無いヘルプトップへ移る', async () => {
    const router = await renderAt('/help?q=Upvote');

    await userEvent.fill(searchInput(), ' 　');
    await userEvent.click(submitButton());

    await expect.poll(() => router.state.location.href).toBe('/help');
  });

  test('51文字の検索語は、送信しても誤りを示して移動せず、フォーカスを検索欄に残す', async () => {
    const router = await renderAt('/help');

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText(TOO_LONG_MESSAGE)).toBeInTheDocument();
    await expect.element(searchInput()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(searchInput()).toHaveFocus();
    await expect
      .element(searchInput())
      .toHaveAccessibleDescription(`文字数 51/50 ${TOO_LONG_MESSAGE}`);
    expect(router.state.location.href).toBe('/help');

    await userEvent.click(submitButton());
    expect(router.state.location.href).toBe('/help');
  });

  test('40文字までは文字数を示さず、41文字から「41/50」を示して検索欄の説明に関連付ける', async () => {
    await renderAt('/help');

    await userEvent.fill(searchInput(), 'あ'.repeat(40));
    await expect.element(counter()).not.toBeInTheDocument();
    await expect.element(searchInput()).not.toHaveAccessibleDescription();

    await userEvent.fill(searchInput(), 'あ'.repeat(41));
    await expect.element(counter()).toHaveTextContent('41/50');
    await expect
      .element(searchInput())
      .toHaveAccessibleDescription('文字数 41/50');
  });

  test('文字数は上限を超えた時と上限以内に戻った時だけ読み上げる', async () => {
    await renderAt('/help');
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();

    await userEvent.fill(searchInput(), 'あ'.repeat(45));
    await expect.element(counter()).toHaveTextContent('45/50');
    expect(liveRegion?.textContent).toBe('');

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await expect.element(counter()).toHaveTextContent('51/50');
    expect(liveRegion?.textContent).toBe(OVER_LIMIT_ANNOUNCEMENT);

    await userEvent.fill(searchInput(), 'あ'.repeat(52));
    await expect.element(counter()).toHaveTextContent('52/50');
    expect(liveRegion?.textContent).toBe(OVER_LIMIT_ANNOUNCEMENT);

    await userEvent.fill(searchInput(), 'あ'.repeat(50));
    await expect.element(counter()).toHaveTextContent('50/50');
    expect(liveRegion?.textContent).toBe(WITHIN_LIMIT_ANNOUNCEMENT);
  });

  test('消去のボタンは入力を消してフォーカスを戻し、未適用の入力の消去では移動しない', async () => {
    const router = await renderAt('/help');

    await userEvent.fill(searchInput(), '下書き');
    await userEvent.click(clearButton());

    await expect.element(searchInput()).toHaveValue('');
    await expect.element(searchInput()).toHaveFocus();
    await expect.element(clearButton()).not.toBeInTheDocument();
    expect(router.state.location.href).toBe('/help');
  });

  test('適用中の検索語を消去のボタンで消すと、検索語の無いヘルプトップへ移る', async () => {
    const router = await renderAt('/help?q=Upvote');

    await userEvent.click(clearButton());

    await expect.poll(() => router.state.location.href).toBe('/help');
    await expect.element(searchInput()).toHaveValue('');
    await expect.element(searchInput()).toHaveFocus();
  });

  test('ブラウザの戻る・進む操作でURLの検索語が変わると、入力欄をその値に戻す', async () => {
    const router = await renderAt('/help?q=Upvote');

    await userEvent.fill(searchInput(), 'ピン留め');
    await userEvent.keyboard('{Enter}');
    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ q: 'ピン留め' });

    router.history.back();
    await expect.element(searchInput()).toHaveValue('Upvote');

    router.history.forward();
    await expect.element(searchInput()).toHaveValue('ピン留め');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('上限の超過の誤りを示した状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderAt('/help');
      await userEvent.fill(searchInput(), 'あ'.repeat(51));
      await userEvent.tab();
      await expect
        .element(page.getByText(TOO_LONG_MESSAGE))
        .toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});

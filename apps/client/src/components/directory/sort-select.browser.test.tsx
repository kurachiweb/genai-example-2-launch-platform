import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { type AxeViolationSummary, runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../lib/test/keyboard.ts';
import { SortSelect } from './sort-select.tsx';

const RELEVANCE_REASON = '検索キーワードを入力すると選べます';

const trigger = () => page.getByRole('button', { name: /^並び順 / });
const menu = () => page.getByRole('menu');
const option = (name: string) =>
  page.getByRole('menuitemradio', { name, exact: true });

const NO_TERM: DirectoryQuery = {};
const WITH_TERM: DirectoryQuery = { q: 'ノート' };

async function openMenu(): Promise<void> {
  await userEvent.click(trigger());
  await expect.element(menu()).toBeInTheDocument();
}

// メニューを開くと外側はaria-hiddenになるため、開いたメニューを別に検査する
async function runAxeOnOpenMenu(): Promise<readonly AxeViolationSummary[]> {
  const opened = menu().element();
  return runAxe(opened);
}

afterEach(() => {
  applyColorScheme('light');
});

describe('SortSelect', () => {
  test.each([
    [NO_TERM, '並び順 ローンチ日が新しい順'],
    [WITH_TERM, '並び順 関連度'],
    [
      { q: 'ノート', sort: 'upvotes' } satisfies DirectoryQuery,
      '並び順 Upvote数が多い順',
    ],
    [{ sort: 'oldest' } satisfies DirectoryQuery, '並び順 ローンチ日が古い順'],
  ])(
    '選択欄は項目名「並び順」に続けて、検索語の有無を踏まえた選択中の並び順を示す(%o)',
    async (query, name) => {
      await render(<SortSelect query={query} onChange={() => undefined} />);

      await expect.element(trigger()).toHaveAccessibleName(name);
    },
  );

  test('選択肢は「関連度」「ローンチ日が新しい順」「ローンチ日が古い順」「Upvote数が多い順」の4つで、「Upvote数が少ない順」は無い', async () => {
    await render(<SortSelect query={WITH_TERM} onChange={() => undefined} />);

    await openMenu();

    const options = page.getByRole('menuitemradio');
    await expect.poll(() => options.elements().length).toBe(4);
    const expectedNames = [
      '関連度',
      'ローンチ日が新しい順',
      'ローンチ日が古い順',
      'Upvote数が多い順',
    ];
    for (const [index, name] of expectedNames.entries()) {
      await expect.element(options.nth(index)).toHaveAccessibleName(name);
    }
    await expect
      .element(page.getByText('Upvote数が少ない順'))
      .not.toBeInTheDocument();
    await expect
      .element(option('関連度'))
      .toHaveAttribute('aria-checked', 'true');
  });

  test('検索語が無い間は「関連度」を無効にして選べない理由を併記し、押しても変更を知らせない', async () => {
    const onChange = vi.fn();
    await render(<SortSelect query={NO_TERM} onChange={onChange} />);

    await openMenu();

    await expect
      .element(option('関連度'))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(option('関連度'))
      .toHaveAccessibleDescription(RELEVANCE_REASON);
    await expect.element(page.getByText(RELEVANCE_REASON)).toBeVisible();
    await expect
      .element(option('ローンチ日が新しい順'))
      .toHaveAttribute('aria-checked', 'true');

    await userEvent.click(option('関連度'), { force: true });

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(menu()).toBeInTheDocument();
  });

  test('検索語がある間は「関連度」を選べ、選べない理由を示さない', async () => {
    await render(
      <SortSelect
        query={{ q: 'ノート', sort: 'newest' }}
        onChange={() => undefined}
      />,
    );

    await openMenu();

    await expect.element(option('関連度')).not.toHaveAttribute('aria-disabled');
    await expect.element(option('関連度')).not.toHaveAccessibleDescription();
    await expect
      .element(page.getByText(RELEVANCE_REASON))
      .not.toBeInTheDocument();
  });

  test('別の並び順を選ぶと、その値を呼び出す側へ知らせてメニューを閉じる', async () => {
    const onChange = vi.fn();
    await render(<SortSelect query={NO_TERM} onChange={onChange} />);

    await openMenu();
    await userEvent.click(option('Upvote数が多い順'));

    expect(onChange.mock.calls).toEqual([['upvotes']]);
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('選択中の並び順を選び直しても、変更を知らせない', async () => {
    const onChange = vi.fn();
    await render(<SortSelect query={NO_TERM} onChange={onChange} />);

    await openMenu();
    await userEvent.click(option('ローンチ日が新しい順'));

    expect(onChange).not.toHaveBeenCalled();
  });

  test('キーボードで開いて矢印キーで選ぶと、無効の「関連度」を飛ばして移り、Enterで選んだ値を知らせる', async () => {
    const onChange = vi.fn();
    await render(
      <SortSelect query={{ sort: 'upvotes' }} onChange={onChange} />,
    );

    await userEvent.tab();
    await expect.element(trigger()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.element(option('ローンチ日が新しい順')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowDown');
    await expect.element(option('ローンチ日が古い順')).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onChange.mock.calls).toEqual([['oldest']]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['検索語が無い', NO_TERM],
      ['検索語がある', WITH_TERM],
    ])(
      '%s時、閉じた選択欄と開いたメニューで、アクセシビリティの検査の違反が0件',
      async (_label, query) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="bg-background p-4 text-foreground">
            <SortSelect query={query} onChange={() => undefined} />
          </div>,
        );
        expect(await runAxe(container)).toStrictEqual([]);

        await openMenu();

        expect(await runAxeOnOpenMenu()).toStrictEqual([]);
      },
    );
  });
});

import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { SearchForm } from './search-form.tsx';

const TOO_LONG_MESSAGE = '検索キーワードは50文字以内で入力してください。';

const OVER_LIMIT_ANNOUNCEMENT = '文字数が上限の50文字を超えています。';

const WITHIN_LIMIT_ANNOUNCEMENT = '文字数が上限以内に戻りました。';

// 家族の絵文字は複数のコードポイントをZWJで結合した1書記素
const FAMILY = '👨‍👩‍👧‍👦';

const searchRegion = () => page.getByRole('search', { name: 'プロダクト' });
const searchInput = () =>
  page.getByRole('searchbox', { name: '検索キーワード' });
const submitButton = () =>
  page.getByRole('button', { name: '検索', exact: true });
const clearButton = () =>
  page.getByRole('button', { name: '検索キーワードを消去' });
const counter = () => page.getByText(/^\d+\/50$/u);

function ControlledSearchForm({
  initial,
  onSearch,
}: {
  readonly initial?: string;
  readonly onSearch: (q: string | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="bg-background p-4 text-foreground">
      <SearchForm
        value={value}
        onSearch={(q) => {
          onSearch(q);
          setValue(q);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue('外から変えた検索語');
        }}
      >
        条件を変える
      </button>
    </div>
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('SearchForm', () => {
  test('名前「プロダクト」の検索の領域に、名前「検索キーワード」の例文付きの検索欄と「検索」のボタンを置き、URLの検索語を入力欄に示す', async () => {
    await render(<SearchForm value="ノート" onSearch={() => undefined} />);

    await expect.element(searchRegion()).toBeInTheDocument();
    await expect.element(searchInput()).toHaveValue('ノート');
    await expect
      .element(searchInput())
      .toHaveAttribute('placeholder', 'プロダクト名・タグライン・説明文で検索');
    await expect.element(submitButton()).toBeInTheDocument();
  });

  test('入力中は検索せず、Enterキーと「検索」のボタンでだけ、前後の空白を除いた検索語で検索する', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value={undefined} onSearch={onSearch} />);

    await userEvent.type(searchInput(), '  ノート アプリ ');
    expect(onSearch).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    await userEvent.click(submitButton());

    expect(onSearch.mock.calls).toEqual([['ノート アプリ'], ['ノート アプリ']]);
  });

  test('空白だけの入力で検索すると、検索語が無いものとして知らせる', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value="ノート" onSearch={onSearch} />);

    await userEvent.fill(searchInput(), ' 　\t');
    await userEvent.click(submitButton());

    expect(onSearch.mock.calls).toEqual([[undefined]]);
  });

  test('40文字までは文字数のカウンターを示さず、41文字から書記素で数えた「41/50」の形で示して検索欄の説明に関連付ける', async () => {
    await render(<SearchForm value={undefined} onSearch={() => undefined} />);

    await userEvent.fill(searchInput(), `${'あ'.repeat(39)}${FAMILY}`);
    await expect.element(counter()).not.toBeInTheDocument();
    await expect.element(searchInput()).not.toHaveAccessibleDescription();

    await userEvent.fill(searchInput(), `${'あ'.repeat(40)}${FAMILY}`);
    await expect.element(counter()).toHaveTextContent('41/50');
    await expect
      .element(searchInput())
      .toHaveAccessibleDescription('文字数 41/50');
  });

  test('文字数は入力のたびには読み上げず、上限を超えた時と上限以内に戻った時だけ読み上げる', async () => {
    const { container } = await render(
      <SearchForm value={undefined} onSearch={() => undefined} />,
    );
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();

    for (const length of [41, 45, 50]) {
      await userEvent.fill(searchInput(), 'あ'.repeat(length));
      await expect.element(counter()).toHaveTextContent(`${String(length)}/50`);
      expect(liveRegion?.textContent).toBe('');
    }

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await expect.element(counter()).toHaveTextContent('51/50');
    expect(liveRegion?.textContent).toBe(OVER_LIMIT_ANNOUNCEMENT);

    await userEvent.fill(searchInput(), 'あ'.repeat(55));
    await expect.element(counter()).toHaveTextContent('55/50');
    expect(liveRegion?.textContent).toBe(OVER_LIMIT_ANNOUNCEMENT);

    await userEvent.fill(searchInput(), 'あ'.repeat(50));
    await expect.element(counter()).toHaveTextContent('50/50');
    expect(liveRegion?.textContent).toBe(WITHIN_LIMIT_ANNOUNCEMENT);

    await userEvent.fill(searchInput(), 'あ'.repeat(45));
    await expect.element(counter()).toHaveTextContent('45/50');
    expect(liveRegion?.textContent).toBe(WITHIN_LIMIT_ANNOUNCEMENT);
  });

  test('URLの検索語が最初から上限を超えていても、表示した時点では読み上げない', async () => {
    const { container } = await render(
      <SearchForm value={'あ'.repeat(51)} onSearch={() => undefined} />,
    );

    await expect.element(counter()).toHaveTextContent('51/50');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '',
    );
  });

  test('50文字までは誤りを示さず、50文字を超えるとフォーカスアウトで誤りを示し、以降は入力のたびに判定し直す', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value={undefined} onSearch={onSearch} />);

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await expect
      .element(page.getByText(TOO_LONG_MESSAGE))
      .not.toBeInTheDocument();
    await expect.element(searchInput()).not.toHaveAttribute('aria-invalid');
    await userEvent.tab();

    await expect.element(page.getByText(TOO_LONG_MESSAGE)).toBeInTheDocument();
    await expect.element(searchInput()).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(searchInput())
      .toHaveAccessibleDescription(`文字数 51/50 ${TOO_LONG_MESSAGE}`);

    await userEvent.fill(searchInput(), 'あ'.repeat(50));
    await expect
      .element(page.getByText(TOO_LONG_MESSAGE))
      .not.toBeInTheDocument();
    await expect.element(searchInput()).not.toHaveAttribute('aria-invalid');
    expect(onSearch).not.toHaveBeenCalled();
  });

  test('書記素で数えて50文字の入力は、フォーカスアウトしても誤りを示さず検索できる', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value={undefined} onSearch={onSearch} />);

    await userEvent.fill(searchInput(), `${'あ'.repeat(49)}${FAMILY}`);
    await userEvent.tab();
    await expect
      .element(page.getByText(TOO_LONG_MESSAGE))
      .not.toBeInTheDocument();
    await expect.element(searchInput()).not.toHaveAttribute('aria-invalid');
    await userEvent.click(submitButton());

    expect(onSearch.mock.calls).toEqual([[`${'あ'.repeat(49)}${FAMILY}`]]);
  });

  test('50文字を超えた入力をEnterキーで送ると、誤りを示して検索せず、フォーカスを検索欄に残す', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value={undefined} onSearch={onSearch} />);

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText(TOO_LONG_MESSAGE)).toBeInTheDocument();
    await expect.element(searchInput()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(searchInput()).toHaveFocus();
    expect(onSearch).not.toHaveBeenCalled();
  });

  test('50文字を超えた入力を「検索」のボタンで送ると、誤りを示して検索せず、フォーカスを検索欄へ移す', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value={undefined} onSearch={onSearch} />);

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await userEvent.click(submitButton());

    await expect.element(page.getByText(TOO_LONG_MESSAGE)).toBeInTheDocument();
    await expect.element(searchInput()).toHaveFocus();
    expect(onSearch).not.toHaveBeenCalled();
  });

  test('消去のボタンは入力がある間だけ置き、押すと入力を消して検索欄へフォーカスを移す。検索語が未適用なら検索しない', async () => {
    const onSearch = vi.fn();
    await render(<SearchForm value={undefined} onSearch={onSearch} />);
    await expect.element(clearButton()).not.toBeInTheDocument();

    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await userEvent.click(submitButton());
    await expect.element(page.getByText(TOO_LONG_MESSAGE)).toBeInTheDocument();
    await userEvent.click(clearButton());

    await expect.element(searchInput()).toHaveValue('');
    await expect.element(searchInput()).toHaveFocus();
    await expect.element(clearButton()).not.toBeInTheDocument();
    await expect
      .element(page.getByText(TOO_LONG_MESSAGE))
      .not.toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
  });

  test('適用中の検索語を消去のボタンで消すと、検索語の解除を知らせる', async () => {
    const onSearch = vi.fn();
    await render(<ControlledSearchForm initial="ノート" onSearch={onSearch} />);

    await userEvent.click(clearButton());

    await expect.element(searchInput()).toHaveValue('');
    await expect.element(searchInput()).toHaveFocus();
    expect(onSearch.mock.calls).toEqual([[undefined]]);
  });

  test('URLの検索語が外から変わると、入力欄と誤りの表示をその値に合わせる', async () => {
    await render(<ControlledSearchForm onSearch={() => undefined} />);
    await userEvent.fill(searchInput(), 'あ'.repeat(51));
    await userEvent.tab();
    await expect.element(page.getByText(TOO_LONG_MESSAGE)).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: '条件を変える' }));

    await expect.element(searchInput()).toHaveValue('外から変えた検索語');
    await expect
      .element(page.getByText(TOO_LONG_MESSAGE))
      .not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('入力の無い状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <SearchForm value={undefined} onSearch={() => undefined} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('カウンターと上限の超過の誤りを示した状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <SearchForm value={undefined} onSearch={() => undefined} />
        </div>,
      );
      await userEvent.fill(searchInput(), 'あ'.repeat(51));
      await userEvent.tab();
      await expect
        .element(page.getByText(TOO_LONG_MESSAGE))
        .toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});

import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { type Locator, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { ReorderableList } from './reorderable-list.tsx';

interface Entry {
  readonly id: string;
  readonly title: string;
}

const ENTRIES: readonly Entry[] = Object.freeze([
  { id: 'a', title: 'ログインできない' },
  { id: 'b', title: '料金の支払い' },
  { id: 'c', title: '退会の手続き' },
]);

const LIST_LABEL = 'ピン留めの記事';

interface HarnessProps {
  readonly initial?: readonly Entry[];
  readonly disabled?: boolean;
  readonly onChange?: (items: readonly Entry[]) => void;
}

// 呼び出す側が変更の通知を受けて並びを持ち直す形で描く
function Harness({
  initial = ENTRIES,
  disabled = false,
  onChange,
}: HarnessProps) {
  const [items, setItems] = useState(initial);
  return (
    <>
      <button type="button">前の操作</button>
      <ReorderableList
        label={LIST_LABEL}
        items={items}
        itemKey={(entry) => entry.id}
        itemLabel={(entry) => entry.title}
        renderItem={(entry) => <span>{entry.title}</span>}
        onChange={(next) => {
          onChange?.(next);
          setItems(next);
        }}
        disabled={disabled}
      />
      <button type="button">次の操作</button>
    </>
  );
}

const list = () => page.getByRole('list', { name: LIST_LABEL });
const upOf = (title: string) =>
  page.getByRole('button', { name: `${title}を上へ移動` });
const downOf = (title: string) =>
  page.getByRole('button', { name: `${title}を下へ移動` });

const titlesInOrder = (): readonly string[] =>
  list()
    .getByRole('listitem')
    .elements()
    .map((element) => element.querySelector('span')?.textContent ?? '');

const announcementOf = (container: HTMLElement): string =>
  container.querySelector('[aria-live="polite"]')?.textContent ?? '';

// 押下でボタンにフォーカスを移さないブラウザ(WebKitのマウスの押下)とプログラムからの押下を、DOMのclick()で再現する
const clickWithoutFocus = (locator: Locator): void => {
  const element = locator.element();
  if (!(element instanceof HTMLButtonElement)) {
    throw new TypeError('押下の対象がボタンではありません');
  }
  element.click();
};

describe('上下の移動による並べ替えの一覧', () => {
  test('名前付きの一覧に項目を渡した順に並べ、項目ごとに対象の名前を含む上下の移動のボタンを置く', async () => {
    await render(<Harness />);

    await expect.element(list()).toBeVisible();
    expect(titlesInOrder()).toStrictEqual(ENTRIES.map(({ title }) => title));
    for (const { title } of ENTRIES) {
      await expect.element(upOf(title)).toBeVisible();
      await expect.element(downOf(title)).toBeVisible();
      await expect.element(upOf(title)).toHaveTextContent('上へ移動');
      await expect.element(downOf(title)).toHaveTextContent('下へ移動');
    }
  });

  test('先頭の項目の上へ移動と末尾の項目の下へ移動は押せない', async () => {
    await render(<Harness />);

    await expect.element(upOf('ログインできない')).toBeDisabled();
    await expect.element(downOf('ログインできない')).toBeEnabled();
    await expect.element(upOf('料金の支払い')).toBeEnabled();
    await expect.element(downOf('料金の支払い')).toBeEnabled();
    await expect.element(upOf('退会の手続き')).toBeEnabled();
    await expect.element(downOf('退会の手続き')).toBeDisabled();
  });

  test('項目が1つなら上下の移動はどちらも押せない', async () => {
    await render(<Harness initial={ENTRIES.slice(0, 1)} />);

    await expect.element(upOf('ログインできない')).toBeDisabled();
    await expect.element(downOf('ログインできない')).toBeDisabled();
  });

  test('上へ移動の押下で1つ前の項目と入れ替え、入れ替えた後の並びを通知する', async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);

    await upOf('退会の手続き').click();

    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      ENTRIES[0],
      ENTRIES[2],
      ENTRIES[1],
    ]);
    expect(titlesInOrder()).toStrictEqual([
      'ログインできない',
      '退会の手続き',
      '料金の支払い',
    ]);
  });

  test('下へ移動の押下で1つ後の項目と入れ替え、入れ替えた後の並びを通知する', async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);

    await downOf('ログインできない').click();

    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      ENTRIES[1],
      ENTRIES[0],
      ENTRIES[2],
    ]);
    expect(titlesInOrder()).toStrictEqual([
      '料金の支払い',
      'ログインできない',
      '退会の手続き',
    ]);
  });

  test('移動の後もフォーカスは移動した項目の同じボタンに残る', async () => {
    await render(<Harness />);

    await downOf('ログインできない').click();
    await expect.element(downOf('ログインできない')).toHaveFocus();

    await upOf('退会の手続き').click();
    await expect.element(upOf('退会の手続き')).toHaveFocus();
  });

  test('移動した項目の位置を、対象の名前と一覧の中の位置で読み上げる', async () => {
    const { container } = await render(<Harness />);

    expect(announcementOf(container)).toBe('');

    await downOf('ログインできない').click();
    await expect
      .poll(() => announcementOf(container))
      .toBe('ログインできないを2番目に移動しました。');

    await upOf('退会の手続き').click();
    await expect
      .poll(() => announcementOf(container))
      .toBe('退会の手続きを2番目に移動しました。');
  });

  test('端へ移動した項目のボタンはフォーカスを保ったまま押せない状態を伝え、押しても並びを変えず、フォーカスが離れたら押せなくなる', async () => {
    const onChange = vi.fn();
    const { container } = await render(<Harness onChange={onChange} />);

    await upOf('料金の支払い').click();
    await expect.element(upOf('料金の支払い')).toHaveFocus();
    await expect
      .element(upOf('料金の支払い'))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .poll(() => announcementOf(container))
      .toBe('料金の支払いを1番目に移動しました。');

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledOnce();
    expect(titlesInOrder()).toStrictEqual([
      '料金の支払い',
      'ログインできない',
      '退会の手続き',
    ]);

    await userEvent.keyboard('{Tab}');
    await expect.element(downOf('料金の支払い')).toHaveFocus();
    await expect.element(upOf('料金の支払い')).toBeDisabled();
  });

  test('末尾へ移動した項目の下へ移動もフォーカスを保つ', async () => {
    await render(<Harness />);

    await downOf('料金の支払い').click();

    await expect.element(downOf('料金の支払い')).toHaveFocus();
    await expect
      .element(downOf('料金の支払い'))
      .toHaveAttribute('aria-disabled', 'true');
  });

  test('フォーカスを移さない押下でも、移動した項目の同じボタンにフォーカスを置く', async () => {
    await render(<Harness />);

    clickWithoutFocus(downOf('ログインできない'));

    await expect.element(downOf('ログインできない')).toHaveFocus();
    await expect.element(downOf('ログインできない')).toBeEnabled();
    expect(titlesInOrder()).toStrictEqual([
      '料金の支払い',
      'ログインできない',
      '退会の手続き',
    ]);
  });

  test('フォーカスを移さない押下で端へ移した項目のボタンは、フォーカスを置いて押せない状態を伝え、フォーカスが離れたら押せなくなる', async () => {
    await render(<Harness />);

    clickWithoutFocus(upOf('料金の支払い'));

    await expect.element(upOf('料金の支払い')).toHaveFocus();
    await expect
      .element(upOf('料金の支払い'))
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.keyboard('{Tab}');
    await expect.element(downOf('料金の支払い')).toHaveFocus();
    await expect.element(upOf('料金の支払い')).toBeDisabled();
  });

  test('キーボードだけで移動のボタンへ進み、EnterとSpaceで並べ替えられる', async () => {
    await render(<Harness />);

    await page.getByRole('button', { name: '前の操作' }).click();
    await userEvent.keyboard('{Tab}');
    await expect.element(downOf('ログインできない')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(titlesInOrder()).toStrictEqual([
      '料金の支払い',
      'ログインできない',
      '退会の手続き',
    ]);
    await expect.element(downOf('ログインできない')).toHaveFocus();

    await userEvent.keyboard(' ');
    expect(titlesInOrder()).toStrictEqual([
      '料金の支払い',
      '退会の手続き',
      'ログインできない',
    ]);
    await expect.element(downOf('ログインできない')).toHaveFocus();

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(upOf('ログインできない')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(titlesInOrder()).toStrictEqual([
      '料金の支払い',
      'ログインできない',
      '退会の手続き',
    ]);
    await expect.element(upOf('ログインできない')).toHaveFocus();
  });

  test('無効の状態では項目の並びだけを描き、移動のボタンを描かない', async () => {
    await render(<Harness disabled />);

    await expect.element(list()).toBeVisible();
    expect(titlesInOrder()).toStrictEqual(ENTRIES.map(({ title }) => title));
    expect(page.getByRole('button', { name: /移動/u }).query()).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('アクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(<Harness />);
    await upOf('料金の支払い').click();

    expect(await runAxe(container)).toStrictEqual([]);
  });

  test('無効の状態でもアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(<Harness disabled />);

    expect(await runAxe(container)).toStrictEqual([]);
  });
});

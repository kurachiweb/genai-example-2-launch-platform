import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInMatchFrame } from './match-testing.tsx';
import { UpvoteButton } from './upvote-button.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const NOT_ACCEPTING_REASON = 'このマッチはUpvoteを受け付けていません。';

type ButtonOptions = {
  readonly pressed?: boolean;
  readonly pending?: boolean;
  readonly disabledReason?: string | null;
  readonly count?: number;
};

const renderButton = async ({
  pressed = false,
  pending = false,
  disabledReason = null,
  count = 1234,
}: ButtonOptions = {}) => {
  const onClick = vi.fn<() => void>();
  await renderInMatchFrame(
    <>
      <UpvoteButton
        productName="Pitch Notes"
        count={count}
        pressed={pressed}
        pending={pending}
        disabledReason={disabledReason}
        onClick={onClick}
      />
      <p>ボタンの外</p>
    </>,
  );
  return { onClick };
};

afterEach(() => {
  applyColorScheme('light');
});

describe('UpvoteButton', () => {
  test('Upvoteしていない側は「<名称>にUpvote」と見えている3桁区切りのUpvote数を名前にし、押されていない状態を伝える', async () => {
    await renderButton();

    const button = page.getByRole('button', { name: 'Pitch NotesにUpvote' });
    await expect
      .element(button)
      .toHaveAccessibleName(/^Pitch NotesにUpvote\s*1,234\s*票$/u);
    await expect.element(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('Upvote済みの側は「<名称>へのUpvoteを取り消す」の名前で押されている状態を伝える', async () => {
    await renderButton({ pressed: true });

    const button = page.getByRole('button', {
      name: 'Pitch NotesへのUpvoteを取り消す',
    });
    await expect.element(button).toHaveAttribute('aria-pressed', 'true');
  });

  test('押すと呼び出し元の関数を1回呼ぶ', async () => {
    const { onClick } = await renderButton();

    await page.getByRole('button', { name: 'Pitch NotesにUpvote' }).click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('キーボードでフォーカスしてEnterで押せる', async () => {
    const { onClick } = await renderButton();

    await userEvent.tab();
    await expect
      .element(page.getByRole('button', { name: 'Pitch NotesにUpvote' }))
      .toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('使えない間は押せない状態を伝え、フォーカスは残したまま理由を読み上げ用の説明とツールチップで示し、押しても呼ばない', async () => {
    const { onClick } = await renderButton({
      disabledReason: NOT_ACCEPTING_REASON,
    });

    const button = page.getByRole('button', { name: 'Pitch NotesにUpvote' });
    await expect.element(button).toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(button)
      .toHaveAccessibleDescription(NOT_ACCEPTING_REASON);

    await userEvent.tab();
    await expect.element(button).toHaveFocus();
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(NOT_ACCEPTING_REASON);

    await userEvent.keyboard('{Enter}');
    await button.click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  test('ポインターを重ねると、使えない理由のツールチップを開く', async () => {
    await renderButton({ disabledReason: NOT_ACCEPTING_REASON });

    await page.getByRole('button', { name: 'Pitch NotesにUpvote' }).hover();

    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(NOT_ACCEPTING_REASON);
  });

  test('送信中は処理中であることを伝え、押しても呼ばない', async () => {
    const { onClick } = await renderButton({ pending: true });

    const button = page.getByRole('button', { name: 'Pitch NotesにUpvote' });
    await expect.element(button).toHaveAttribute('aria-busy', 'true');
    await expect.element(button).toHaveAttribute('aria-disabled', 'true');

    await button.click({ force: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['Upvoteしていない', {}],
      ['Upvote済みの', { pressed: true }],
      ['使えない', { disabledReason: NOT_ACCEPTING_REASON }],
    ] as const)(
      '%sボタンのアクセシビリティの検査の違反が0件',
      async (_label, options) => {
        applyColorScheme(scheme);
        await renderButton(options);
        await expect.element(page.getByRole('button')).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});

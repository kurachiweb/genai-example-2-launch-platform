import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  isContentClipped,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../../test/overflow.ts';
import { Button } from './button.tsx';
import type { ButtonSize, ButtonVariant } from './button-variants.ts';

const VARIANTS: readonly ButtonVariant[] = [
  'default',
  'destructive',
  'outline',
  'secondary',
  'ghost',
  'link',
];

const TEXT_SIZES: readonly ButtonSize[] = ['xs', 'sm', 'default', 'lg'];

const NARROW_PARENT_WIDTH = 120;
const NARROW_PARENT_TEST_ID = 'narrow-parent';
const LONG_LABEL = 'Save your changes to this product page';

// ボタンは縮まないため、折り返さない親に複数のボタンを並べる配置は文書の規則で禁じており、確かめるのは1つだけ置いた時
const ROW_PARENT_LAYOUTS = [
  ['flex', '長い文言のボタンを置いても', 'flex gap-2', [LONG_LABEL]],
  [
    'flex flex-wrap',
    '短い文言のボタンと並べても',
    'flex flex-wrap gap-2',
    [LONG_LABEL, '保存'],
  ],
] as const;

afterEach(() => {
  applyColorScheme('light');
});

describe('Button', () => {
  test('Tabでフォーカスが移り、EnterとSpaceで押した時の処理を呼ぶ', async () => {
    const onClick = vi.fn();
    await render(<Button onClick={onClick}>投票する</Button>);
    const button = page.getByRole('button', { name: '投票する' });

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await expect.element(button).toHaveFocus();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test('無効の時は、Tabでフォーカスが移らず、押せないことを示す', async () => {
    await render(
      <>
        <Button disabled>保存する</Button>
        <Button>次へ</Button>
      </>,
    );
    const disabled = page.getByRole('button', { name: '保存する' });

    await userEvent.tab();

    await expect.element(disabled).toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: '次へ' }))
      .toHaveFocus();
    expect(getComputedStyle(disabled.element()).opacity).toBe('0.5');
  });

  test('支援技術向けの無効の指定では、フォーカスを保ったまま無効と同じ見た目で示す', async () => {
    await render(<Button aria-disabled>保存する</Button>);
    const button = page.getByRole('button', { name: '保存する' });

    await userEvent.tab();

    await expect.element(button).toHaveFocus();
    await expect.element(button).toHaveAttribute('aria-disabled', 'true');
    const { opacity, pointerEvents } = getComputedStyle(button.element());
    expect({ opacity, pointerEvents }).toStrictEqual({
      opacity: '0.5',
      pointerEvents: 'none',
    });
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<Button>投票する</Button>);
      const button = page.getByRole('button', { name: '投票する' });

      await userEvent.tab();

      await expect.element(button).toHaveFocus();
      await expect
        .poll(() => outlineOf(button.element()))
        .toStrictEqual(ringOutline());
    },
  );

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、既定の見た目はプライマリのトークンの色になる',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<Button>投票する</Button>);

      const { color, backgroundColor } = getComputedStyle(
        page.getByRole('button', { name: '投票する' }).element(),
      );

      expect(backgroundColor).toBe(tokenColorOf('primary'));
      expect(color).toBe(tokenColorOf('primary-foreground'));
    },
  );

  test('文言が翻訳で長くなっても、幅が文言に合わせて伸びて文言が切れない', async () => {
    await render(
      <>
        <Button>保存</Button>
        <Button>Save your changes to this product page</Button>
      </>,
    );
    const short = page.getByRole('button', { name: '保存' }).element();
    const long = page
      .getByRole('button', { name: 'Save your changes to this product page' })
      .element();

    expect(long.clientWidth).toBeGreaterThan(short.clientWidth * 2);
    expect(isContentClipped(long)).toBe(false);
  });

  test.each(TEXT_SIZES)(
    '大きさが%sのとき、幅を絞った親の中では長い文言を折り返し、親から溢れず文言が切れない',
    async (size) => {
      await render(
        <div
          data-testid={NARROW_PARENT_TEST_ID}
          style={{ width: NARROW_PARENT_WIDTH }}
        >
          <Button size={size}>{LONG_LABEL}</Button>
        </div>,
      );
      const parent = page.getByTestId(NARROW_PARENT_TEST_ID).element();
      const button = page.getByRole('button', { name: LONG_LABEL }).element();

      expect(elementsOverflowingContainer(parent)).toStrictEqual([]);
      expect(isContentClipped(button)).toBe(false);
    },
  );

  test.each(ROW_PARENT_LAYOUTS)(
    '幅を絞った%sの親の中で%s、長い文言を折り返し、親から溢れず文言が切れない',
    async (_layout, _arrangement, className, labels) => {
      await render(
        <div
          data-testid={NARROW_PARENT_TEST_ID}
          className={className}
          style={{ width: NARROW_PARENT_WIDTH }}
        >
          {labels.map((label) => (
            <Button key={label}>{label}</Button>
          ))}
        </div>,
      );
      const parent = page.getByTestId(NARROW_PARENT_TEST_ID).element();

      expect(elementsOverflowingContainer(parent)).toStrictEqual([]);
      for (const button of page.getByRole('button').elements()) {
        expect(isContentClipped(button)).toBe(false);
      }
    },
  );

  test('翻訳しない指定をボタンの要素へ渡す', async () => {
    await render(<Button translate="no">Upvote</Button>);

    await expect
      .element(page.getByRole('button', { name: 'Upvote' }))
      .toHaveAttribute('translate', 'no');
  });

  test('子の要素として描画する指定では、リンクにボタンの見た目を付けてキーボードで移れる', async () => {
    await render(
      <Button asChild>
        <a href="#launch">ローンチする</a>
      </Button>,
    );
    const link = page.getByRole('link', { name: 'ローンチする' });

    await userEvent.tab();

    await expect.element(link).toHaveFocus();
    await expect.element(link).toHaveAttribute('data-slot', 'button');
    expect(getComputedStyle(link.element()).backgroundColor).toBe(
      tokenColorOf('primary'),
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('すべての見た目の種類で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col items-start gap-3 p-4">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {`${variant}の操作`}
            </Button>
          ))}
          <Button disabled>無効の操作</Button>
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test.each(VARIANTS)(
      '見た目の種類が%sのボタンにポインターを重ねた状態で、アクセシビリティの検査の違反が0件',
      async (variant) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="p-4">
            <Button variant={variant}>{`${variant}の操作`}</Button>
          </div>,
        );

        await userEvent.hover(page.getByRole('button'));

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});

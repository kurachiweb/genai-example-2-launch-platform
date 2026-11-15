import { afterEach, describe, expect, test } from 'vitest';
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
import { Badge } from './badge.tsx';
import type { BadgeSize, BadgeVariant } from './badge-variants.ts';

const VARIANTS: readonly BadgeVariant[] = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'ghost',
  'link',
];

const SIZES: readonly BadgeSize[] = ['default', 'lg'];

const NARROW_PARENT_WIDTH = 120;
const NARROW_PARENT_TEST_ID = 'narrow-parent';
const LONG_LABEL = 'Winner of the weekly launch match';

afterEach(() => {
  applyColorScheme('light');
});

describe('Badge', () => {
  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、既定の見た目はプライマリのトークンの色になる',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<Badge>勝利</Badge>);

      const { color, backgroundColor } = getComputedStyle(
        page.getByText('勝利').element(),
      );

      expect(backgroundColor).toBe(tokenColorOf('primary'));
      expect(color).toBe(tokenColorOf('primary-foreground'));
    },
  );

  test('文言が翻訳で長くなっても、幅が文言に合わせて伸びて文言が切れない', async () => {
    await render(
      <div className="flex flex-col items-start gap-2">
        <Badge>勝利</Badge>
        <Badge>Winner of the weekly launch match</Badge>
      </div>,
    );
    const short = page.getByText('勝利').element();
    const long = page.getByText('Winner of the weekly launch match').element();

    expect(long.clientWidth).toBeGreaterThan(short.clientWidth * 2);
    expect(isContentClipped(long)).toBe(false);
  });

  test.each(SIZES)(
    '大きさが%sのとき、幅を絞った親の中では長い文言を折り返し、親から溢れず文言が切れない',
    async (size) => {
      await render(
        <div
          data-testid={NARROW_PARENT_TEST_ID}
          style={{ width: NARROW_PARENT_WIDTH }}
        >
          <Badge size={size}>{LONG_LABEL}</Badge>
        </div>,
      );
      const parent = page.getByTestId(NARROW_PARENT_TEST_ID).element();
      const badge = page.getByText(LONG_LABEL).element();

      expect(elementsOverflowingContainer(parent)).toStrictEqual([]);
      expect(isContentClipped(badge)).toBe(false);
    },
  );

  test('翻訳しない指定をバッジの要素へ渡す', async () => {
    await render(<Badge translate="no">Ultras</Badge>);

    await expect
      .element(page.getByText('Ultras'))
      .toHaveAttribute('translate', 'no');
  });

  test('Tabの移動先にならない', async () => {
    await render(
      <>
        <Badge>勝利</Badge>
        <button type="button">次へ</button>
      </>,
    );

    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '次へ' }))
      .toHaveFocus();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、リンクとして描画したバッジは、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(
        <Badge asChild>
          <a href="#directory">ディレクトリ</a>
        </Badge>,
      );
      const link = page.getByRole('link', { name: 'ディレクトリ' });

      await userEvent.tab();

      await expect.element(link).toHaveFocus();
      await expect.element(link).toHaveAttribute('data-slot', 'badge');
      await expect
        .poll(() => outlineOf(link.element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('すべての見た目の種類で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col items-start gap-3 p-4">
          {VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {`${variant}の表示`}
            </Badge>
          ))}
          <Badge size="lg">大きい表示</Badge>
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test.each(VARIANTS)(
      '見た目の種類が%sのリンクのバッジにポインターを重ねた状態で、アクセシビリティの検査の違反が0件',
      async (variant) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="p-4">
            <Badge asChild variant={variant}>
              <a href="#directory">{`${variant}のリンク`}</a>
            </Badge>
          </div>,
        );

        await userEvent.hover(page.getByRole('link'));

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});

import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../test/computed-style.ts';
import { MarkdownLengthCounter } from './markdown-length-counter.tsx';

const OVER_LIMIT = '文字数が上限の2,000文字を超えています。';

const WITHIN_LIMIT = '文字数が上限以内に戻りました。';

const countOf = (container: HTMLElement): HTMLElement => {
  const count = container.querySelector<HTMLElement>(
    '[data-slot="markdown-length-counter"] p:not([aria-live])',
  );
  if (count === null) {
    throw new Error('文字数が描画されていません。');
  }
  return count;
};

const liveRegionOf = (container: HTMLElement): HTMLElement => {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]');
  if (region === null) {
    throw new Error('読み上げの領域が描画されていません。');
  }
  return region;
};

afterEach(() => {
  applyColorScheme('light');
});

describe('MarkdownLengthCounter', () => {
  test('書記素の数と上限を3桁区切りで「1,234 / 2,000」の形に表示する', async () => {
    const { container } = await render(
      <MarkdownLengthCounter value={'あ'.repeat(1234)} max={2000} />,
    );

    expect(countOf(container).textContent).toBe('1,234 / 2,000');
  });

  test('絵文字の結合や結合文字は見た目の1文字として数える', async () => {
    const { container } = await render(
      <MarkdownLengthCounter
        value={
          '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}か\u3099\u{1F1EF}\u{1F1F5}'
        }
        max={10}
      />,
    );

    expect(countOf(container).textContent).toBe('3 / 10');
  });

  test('上限を超えると注意色で示し、上限ちょうどは通常の色で示す', async () => {
    const { container, rerender } = await render(
      <MarkdownLengthCounter value="abc" max={3} />,
    );

    expect(getComputedStyle(countOf(container)).color).not.toBe(
      tokenColorOf('destructive'),
    );

    await rerender(<MarkdownLengthCounter value="abcd" max={3} />);

    expect(getComputedStyle(countOf(container)).color).toBe(
      tokenColorOf('destructive'),
    );
  });

  test('上限を超えた時と上限以内に戻った時だけ読み上げの文言を変え、入力のたびには変えない', async () => {
    const { container, rerender } = await render(
      <MarkdownLengthCounter value={'あ'.repeat(1999)} max={2000} />,
    );
    const region = liveRegionOf(container);

    expect(region.textContent).toBe('');

    await rerender(
      <MarkdownLengthCounter value={'あ'.repeat(2000)} max={2000} />,
    );
    expect(region.textContent).toBe('');

    await rerender(
      <MarkdownLengthCounter value={'あ'.repeat(2001)} max={2000} />,
    );
    expect(region.textContent).toBe(OVER_LIMIT);

    await rerender(
      <MarkdownLengthCounter value={'あ'.repeat(2005)} max={2000} />,
    );
    expect(region.textContent).toBe(OVER_LIMIT);

    await rerender(
      <MarkdownLengthCounter value={'あ'.repeat(1990)} max={2000} />,
    );
    expect(region.textContent).toBe(WITHIN_LIMIT);

    await rerender(
      <MarkdownLengthCounter value={'あ'.repeat(1980)} max={2000} />,
    );
    expect(region.textContent).toBe(WITHIN_LIMIT);
  });

  test('最初から上限を超えていても、表示した時点では読み上げない', async () => {
    const { container } = await render(
      <MarkdownLengthCounter value="abcd" max={3} />,
    );

    expect(liveRegionOf(container).textContent).toBe('');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('上限以内と超過のどちらでもアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container, rerender } = await render(
        <div className="bg-card p-4">
          <MarkdownLengthCounter value="abc" max={3} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);

      await rerender(
        <div className="bg-card p-4">
          <MarkdownLengthCounter value="abcd" max={3} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});

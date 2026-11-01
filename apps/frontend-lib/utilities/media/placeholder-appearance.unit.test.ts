import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLACEHOLDER_COLOR_TOKENS,
  placeholderAppearanceOf,
} from './placeholder-appearance.ts';

const WCAG_AA_TEXT_CONTRAST = 4.5;

const TOKENS_CSS = readFileSync(
  join(import.meta.dirname, '..', '..', 'styles', 'tokens.css'),
  'utf8',
);

type ColorScheme = 'light' | 'dark';

const SCHEME_SELECTORS: Readonly<Record<ColorScheme, string>> = {
  light: ':root',
  dark: '.dark',
};

const OKLCH_PATTERN =
  /^oklch\((?<lightness>[\d.]+) (?<chroma>[\d.]+) (?<hue>[\d.]+)\)$/u;

const GAMUT_TOLERANCE = 1e-4;

const blockOf = (selector: string): string => {
  const start = TOKENS_CSS.indexOf(`${selector} {`);
  const end = TOKENS_CSS.indexOf('}', start);
  if (start === -1 || end === -1) {
    throw new Error(`配色のトークンの区画${selector}が見つかりません。`);
  }
  return TOKENS_CSS.slice(start, end);
};

const placeholderTokensOf = (
  scheme: ColorScheme,
): ReadonlyMap<string, string> =>
  new Map(
    [
      ...blockOf(SCHEME_SELECTORS[scheme]).matchAll(
        /(?<name>--placeholder-[\w-]+):\s*(?<value>[^;]+);/gu,
      ),
    ].map((match) => [match.groups?.name ?? '', match.groups?.value ?? '']),
  );

// CSS Color 4のOKLCHから線形のsRGBへの変換
const linearSrgbOf = (value: string): readonly number[] => {
  const groups = OKLCH_PATTERN.exec(value)?.groups;
  if (groups === undefined) {
    throw new Error(`oklch(L C H)の形でない色です: ${value}`);
  }
  const lightness = Number(groups.lightness);
  const chroma = Number(groups.chroma);
  const hue = (Number(groups.hue) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ];
};

const isInSrgbGamut = (value: string): boolean =>
  linearSrgbOf(value).every(
    (channel) => channel >= -GAMUT_TOLERANCE && channel <= 1 + GAMUT_TOLERANCE,
  );

// WCAG 2.2の相対輝度は線形のsRGBの重み付きの和
const relativeLuminanceOf = (value: string): number => {
  const [red = 0, green = 0, blue = 0] = linearSrgbOf(value).map((channel) =>
    Math.min(1, Math.max(0, channel)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatioOf = (first: string, second: string): number => {
  const [lighter = 0, darker = 0] = [
    relativeLuminanceOf(first),
    relativeLuminanceOf(second),
  ].toSorted((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

const SCHEME_PAIRS = (['light', 'dark'] as const).flatMap((scheme) =>
  PLACEHOLDER_COLOR_TOKENS.map(
    (pair) => [scheme, pair.background, pair.foreground] as const,
  ),
);

describe('プレースホルダーの先頭1文字', () => {
  test.each([
    ['pitch-notes', 'P'],
    ['倉地', '倉'],
    ['👨‍👩‍👧家族', '👨‍👩‍👧'],
    ['🇯🇵 Japan', '🇯🇵'],
    ['が', 'が'],
    ['  花子', '花'],
  ])(
    '名前%sの先頭の書記素%sを、結合文字や絵文字を分断せずに取り出す',
    (label, initial) => {
      expect(placeholderAppearanceOf({ label, seed: 'id' }).initial).toBe(
        initial,
      );
    },
  );

  test('大文字にすると2文字以上になる文字は大文字にしない', () => {
    expect(placeholderAppearanceOf({ label: 'ßeta', seed: 'id' }).initial).toBe(
      'ß',
    );
  });

  test('空白だけの名前は「?」にする', () => {
    expect(placeholderAppearanceOf({ label: ' 　', seed: 'id' }).initial).toBe(
      '?',
    );
  });
});

describe('プレースホルダーの配色', () => {
  test('背景色と文字色は、組になった配色のトークンの参照にする', () => {
    const { background, foreground } = placeholderAppearanceOf({
      label: 'A',
      seed: 'user-1',
    });

    expect(
      PLACEHOLDER_COLOR_TOKENS.map((pair) => [
        `var(${pair.background})`,
        `var(${pair.foreground})`,
      ]),
    ).toContainEqual([background, foreground]);
  });

  test('配色は色を決めるIDから決定論的に選び、名前に左右されない', () => {
    const first = placeholderAppearanceOf({ label: 'A', seed: 'user-1' });
    const again = placeholderAppearanceOf({ label: 'B', seed: 'user-1' });

    expect(again.background).toBe(first.background);
    expect(again.foreground).toBe(first.foreground);
  });

  test('IDが変わると、すべての配色の組が使われる', () => {
    const backgrounds = new Set(
      Array.from(
        { length: 1_000 },
        (_, index) =>
          placeholderAppearanceOf({ label: 'A', seed: `user-${String(index)}` })
            .background,
      ),
    );

    expect(backgrounds.size).toBe(PLACEHOLDER_COLOR_TOKENS.length);
  });

  test.each(['light', 'dark'] as const)(
    '%sの配色のトークンは、組の背景色と文字色をすべて定義し、他のプレースホルダーのトークンを持たない',
    (scheme) => {
      const expected = PLACEHOLDER_COLOR_TOKENS.flatMap((pair) => [
        pair.background,
        pair.foreground,
      ]).toSorted();

      expect([...placeholderTokensOf(scheme).keys()].toSorted()).toEqual(
        expected,
      );
    },
  );

  test.each(SCHEME_PAIRS)(
    '%sの配色で、背景色%sと文字色%sはsRGBの範囲に収まり、WCAG 2.2 AAの4.5:1以上になる',
    (scheme, background, foreground) => {
      const tokens = placeholderTokensOf(scheme);
      const backgroundValue = tokens.get(background) ?? '';
      const foregroundValue = tokens.get(foreground) ?? '';

      expect(isInSrgbGamut(backgroundValue)).toBe(true);
      expect(isInSrgbGamut(foregroundValue)).toBe(true);
      expect(
        contrastRatioOf(backgroundValue, foregroundValue),
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST);
    },
  );
});

describe('テストのコントラスト比の計算', () => {
  test('白と黒の比は21:1で、引数の順に依らない', () => {
    expect(contrastRatioOf('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 3);
    expect(contrastRatioOf('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 3);
  });

  test('sRGBの#1d4ed8に当たるoklch(0.488 0.217 264.376)と白の比は、16進から求めた約6.70:1になる', () => {
    expect(
      contrastRatioOf('oklch(0.488 0.217 264.376)', 'oklch(1 0 0)'),
    ).toBeCloseTo(6.7, 1);
  });

  test('sRGBの範囲外の色を範囲外と判定する', () => {
    expect(isInSrgbGamut('oklch(0.7 0.4 150)')).toBe(false);
  });
});

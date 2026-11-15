import type { Appearance } from '@stripe/stripe-js';

import type { ThemePreference } from '../../../lib/utilities/theme/theme-preference.ts';

type ColorVariable =
  'colorPrimary' | 'colorBackground' | 'colorText' | 'colorDanger';

const COLOR_TOKENS: Readonly<Record<ColorVariable, string>> = Object.freeze({
  colorPrimary: '--primary',
  colorBackground: '--background',
  colorText: '--foreground',
  colorDanger: '--destructive',
});

const FONT_TOKEN = '--font-sans';

const RADIUS_TOKEN = '--radius';

// 入力欄はStripeのiframeの中に描かれ画面のCSSの変数を読めず、配色のトークンのoklchの値もそのままでは渡せないため、canvasで1画素を塗ってsRGBの色に直す
const toRgbColor = (
  context: CanvasRenderingContext2D,
  value: string,
): string => {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
};

const colorVariablesOf = (
  style: CSSStyleDeclaration,
): Partial<Record<ColorVariable, string>> => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(COLOR_TOKENS).map(([variable, token]) => [
      variable,
      toRgbColor(context, style.getPropertyValue(token).trim()),
    ]),
  );
};

// 表示中の配色(ライト・ダーク)と、その配色で計算した配色のトークンから、Stripeの入力欄の外観を組み立てる
export function checkoutAppearanceOf(
  root: HTMLElement,
  theme: ThemePreference,
): Appearance {
  const style = getComputedStyle(root);
  return {
    theme: theme === 'dark' ? 'night' : 'stripe',
    variables: {
      ...colorVariablesOf(style),
      fontFamily: style.getPropertyValue(FONT_TOKEN).trim(),
      borderRadius: style.getPropertyValue(RADIUS_TOKEN).trim(),
    },
  };
}

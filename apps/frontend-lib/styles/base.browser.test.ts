import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import './base.css';

const TOKENS = {
  light: {
    background: 'oklch(0.985 0.006 150)',
    foreground: 'oklch(0.2 0.03 160)',
    primary: 'oklch(0.42 0.12 155)',
    primaryForeground: 'oklch(0.99 0 0)',
    ring: 'oklch(0.6 0.1 155)',
  },
  dark: {
    background: 'oklch(0.15 0.02 160)',
    foreground: 'oklch(0.96 0.01 150)',
    primary: 'oklch(0.74 0.15 150)',
    primaryForeground: 'oklch(0.15 0.04 160)',
    ring: 'oklch(0.6 0.12 150)',
  },
} as const;

type ColorScheme = keyof typeof TOKENS;

const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

// 計算値の色の表記はブラウザが正規化するため、トークンの値も同じ経路で計算値にしてから比べる
function computedColorOf(value: string): string {
  const probe = document.createElement('div');
  probe.style.color = value;
  document.body.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
}

function mount(className: string, tagName = 'div'): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = 'テスト用の要素';
  document.body.append(element);
  return element;
}

function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.classList.toggle('dark', scheme === 'dark');
}

function durationInSeconds(value: string): number {
  return Number.parseFloat(value);
}

async function emulateReducedMotion(
  value: 'reduce' | 'no-preference',
): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
}

beforeAll(async () => {
  await emulateReducedMotion('no-preference');
});

afterEach(async () => {
  document.body.replaceChildren();
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('デザイントークン', () => {
  describe.each(['light', 'dark'] as const)('配色が%sのとき', (scheme) => {
    test('本文の文字色と背景色がトークンの値になる', () => {
      applyColorScheme(scheme);

      const { color, backgroundColor } = getComputedStyle(document.body);

      expect(color).toBe(computedColorOf(TOKENS[scheme].foreground));
      expect(backgroundColor).toBe(computedColorOf(TOKENS[scheme].background));
    });

    test('トークンの色のクラスがトークンの値になる', () => {
      applyColorScheme(scheme);
      const element = mount('bg-primary text-primary-foreground');

      const { color, backgroundColor } = getComputedStyle(element);

      expect(color).toBe(computedColorOf(TOKENS[scheme].primaryForeground));
      expect(backgroundColor).toBe(computedColorOf(TOKENS[scheme].primary));
    });
  });

  test('ルート要素のdarkクラスでdark:の指定が有効になる', () => {
    const element = mount('hidden dark:block');
    const displayInLight = getComputedStyle(element).display;

    applyColorScheme('dark');

    expect(displayInLight).toBe('none');
    expect(getComputedStyle(element).display).toBe('block');
  });

  test('幅480px以上でxs:の指定が有効になる', async () => {
    const element = mount('hidden xs:block');
    await page.viewport(479, DEFAULT_VIEWPORT.height);
    const displayBelow = getComputedStyle(element).display;

    await page.viewport(480, DEFAULT_VIEWPORT.height);

    expect(displayBelow).toBe('none');
    expect(getComputedStyle(element).display).toBe('block');
  });

  test('OSのフォントの並びで表示し、Webフォントを読み込まない', () => {
    const { fontFamily } = getComputedStyle(document.body);

    expect(fontFamily.startsWith('ui-sans-serif, system-ui')).toBe(true);
    expect(fontFamily).toContain('"Hiragino Sans"');
    expect(document.fonts.size).toBe(0);
  });
});

describe('視差効果を減らす設定', () => {
  test('設定が無効なら、アニメーションと遷移は指定どおりの時間で動く', () => {
    const element = mount('animate-in fade-in transition-colors scroll-smooth');

    const style = getComputedStyle(element);

    expect(style.animationName).toBe('enter');
    expect(durationInSeconds(style.animationDuration)).toBe(0.15);
    expect(durationInSeconds(style.transitionDuration)).toBe(0.15);
    expect(style.scrollBehavior).toBe('smooth');
  });

  test('設定が有効なら、アニメーションと遷移の時間を最小にし、スクロールを即時にする', async () => {
    const element = mount('animate-in fade-in transition-colors scroll-smooth');

    await emulateReducedMotion('reduce');
    const style = getComputedStyle(element);

    expect(style.animationName).toBe('enter');
    expect(durationInSeconds(style.animationDuration)).toBeLessThanOrEqual(
      0.00001,
    );
    expect(style.animationIterationCount).toBe('1');
    expect(durationInSeconds(style.transitionDuration)).toBeLessThanOrEqual(
      0.00001,
    );
    expect(style.scrollBehavior).toBe('auto');
  });
});

describe('フォーカスの輪郭', () => {
  test.each(['light', 'dark'] as const)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングのトークンの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      const button = mount('', 'button');

      await userEvent.tab();
      const { outlineStyle, outlineColor, outlineWidth } =
        getComputedStyle(button);

      expect(document.activeElement).toBe(button);
      expect(outlineStyle).toBe('solid');
      expect(Number.parseFloat(outlineWidth)).toBeGreaterThanOrEqual(2);
      expect(outlineColor).toBe(computedColorOf(TOKENS[scheme].ring));
    },
  );
});

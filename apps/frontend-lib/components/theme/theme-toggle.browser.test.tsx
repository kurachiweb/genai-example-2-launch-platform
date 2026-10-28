import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  emulatePreferredColorScheme,
  type PreferredColorScheme,
} from '../../test/preferred-color-scheme.ts';
import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../../utilities/theme/theme-preference.ts';
import { TooltipProvider } from '../ui/tooltip/tooltip-provider.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

const TO_DARK = 'ダークモードに切り替え';
const TO_LIGHT = 'ライトモードに切り替え';

const root = () => document.documentElement;
const toggleButton = () =>
  page.getByRole('button', { name: /モードに切り替え$/u });

function resetTheme(): void {
  root().classList.remove('dark');
  root().style.colorScheme = '';
  localStorage.removeItem(THEME_STORAGE_KEY);
}

// 初回描画前のスクリプトは文書へ差し込んだインラインスクリプトとして、ブラウザに実際に実行させる
function runBootstrapScript(): void {
  const script = document.createElement('script');
  script.textContent = THEME_BOOTSTRAP_SCRIPT;
  document.head.append(script);
  script.remove();
}

const toggleTree = (
  <TooltipProvider>
    <div className="bg-background p-12 text-foreground">
      <ThemeToggle />
    </div>
  </TooltipProvider>
);

async function renderToggle(): Promise<void> {
  await render(toggleTree);
}

// サーバー側の描画結果をReactに渡さずに置き、ハイドレーションより前の表示を再現する
function placeServerMarkup(): HTMLElement {
  const container = document.body.appendChild(document.createElement('div'));
  container.replaceChildren(
    ...new DOMParser().parseFromString(renderToString(toggleTree), 'text/html')
      .body.childNodes,
  );
  return container;
}

async function expectTheme(theme: ThemePreference): Promise<void> {
  await expect
    .element(toggleButton())
    .toHaveAccessibleName(theme === 'dark' ? TO_LIGHT : TO_DARK);
  await expect.element(toggleButton()).not.toHaveAttribute('aria-pressed');
  expect(root().classList.contains('dark')).toBe(theme === 'dark');
  expect(root().style.colorScheme).toBe(theme);
}

beforeEach(async () => {
  resetTheme();
  await emulatePreferredColorScheme('light');
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetTheme();
  await emulatePreferredColorScheme(null);
});

describe('ThemeToggle', () => {
  test('ライトの表示では切り替え先を示す「ダークモードに切り替え」の名前を持ち、押下の状態を持たない', async () => {
    runBootstrapScript();
    await renderToggle();

    await expectTheme('light');
  });

  test.each<[ThemePreference, string]>([
    ['dark', TO_LIGHT],
    ['light', TO_DARK],
  ])(
    '保存値が%sの時、ハイドレーションより前のサーバー側の描画結果の時点で、ボタンの名前を切り替え先の「%s」にする',
    async (stored, expectedName) => {
      localStorage.setItem(THEME_STORAGE_KEY, stored);
      runBootstrapScript();

      const container = placeServerMarkup();

      try {
        const button = page.getByRole('button', { name: /モードに切り替え$/u });
        await expect.element(button).toHaveAccessibleName(expectedName);
        await expect.element(button).not.toHaveAttribute('aria-pressed');
      } finally {
        container.remove();
      }
    },
  );

  test('操作でダークへ切り替えて選択を保存し、もう一度の操作でライトへ戻して保存する', async () => {
    runBootstrapScript();
    await renderToggle();

    await userEvent.click(toggleButton());

    await expectTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await userEvent.click(toggleButton());

    await expectTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  test('キーボードだけでフォーカスし、EnterとSpaceで切り替えられる', async () => {
    runBootstrapScript();
    await renderToggle();

    await userEvent.tab();
    await expect.element(toggleButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await expectTheme('dark');

    await userEvent.keyboard(' ');

    await expectTheme('light');
  });

  test.each<[PreferredColorScheme, ThemePreference]>([
    ['dark', 'dark'],
    ['light', 'light'],
  ])(
    '保存が無い時はOSの配色の設定(%s)に従って表示する',
    async (scheme, expected) => {
      await emulatePreferredColorScheme(scheme);
      runBootstrapScript();
      await renderToggle();

      await expectTheme(expected);
    },
  );

  test('保存した選択はOSの配色の設定より優先し、次回の表示でも使う', async () => {
    runBootstrapScript();
    await renderToggle();
    await userEvent.click(toggleButton());
    await expectTheme('dark');

    resetTheme();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await emulatePreferredColorScheme('light');
    runBootstrapScript();

    await expectTheme('dark');
  });

  test('選択を保存できなくても、その表示の間は切り替えを反映し、エラーを表示しない', async () => {
    const consoleError = vi.spyOn(console, 'error');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('保存できません', 'QuotaExceededError');
    });
    runBootstrapScript();
    await renderToggle();

    await userEvent.click(toggleButton());

    await expectTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('サイトデータを禁止していて保存先を参照するだけで例外になっても、切り替えを反映する', async () => {
    runBootstrapScript();
    await renderToggle();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('サイトデータを使えません', 'SecurityError');
    });

    await userEvent.click(toggleButton());

    await expectTheme('dark');
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test.each<[ThemePreference, string]>([
    ['light', TO_DARK],
    ['dark', TO_LIGHT],
  ])(
    '%sの表示でフォーカスすると、ツールチップで切り替え先の「%s」を示す',
    async (theme, expected) => {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      runBootstrapScript();
      await renderToggle();

      await userEvent.tab();

      await expect.element(page.getByRole('tooltip')).toBeInTheDocument();
      await expect
        .element(toggleButton())
        .toHaveAccessibleDescription(expected);
    },
  );

  test.each<ThemePreference>(['light', 'dark'])(
    '%sの表示でアクセシビリティの自動検査の違反が0件',
    async (theme) => {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      runBootstrapScript();
      const { container } = await render(
        <TooltipProvider>
          <div className="bg-background p-12 text-foreground">
            <ThemeToggle />
          </div>
        </TooltipProvider>,
      );
      await expectTheme(theme);

      expect(await runAxe(container)).toStrictEqual([]);
    },
  );
});

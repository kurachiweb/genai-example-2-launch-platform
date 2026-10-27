import { toast } from 'sonner';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../test/computed-style.ts';
import { notify, type NotifyKind } from './notify.ts';
import { Toaster } from './toaster.tsx';

const UPVOTED = 'Upvoteしました。';

const KINDS: readonly NotifyKind[] = ['success', 'info', 'warning', 'error'];

function liveRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('section[aria-live]');
  if (region === null) {
    throw new Error('トーストのライブリージョンがありません。');
  }
  return region;
}

// sonnerは読み込み時にレイヤー外の<style>を差し込むため、輪郭の検査がその規則の下で走っていることを確かめる
function sonnerRemovesToastOutline(): boolean {
  return [...document.querySelectorAll('style')].some((style) =>
    /\[data-sonner-toast\]\{[^}]*outline:0/u.test(style.textContent),
  );
}

function toastOf(message: string): HTMLElement {
  const element = page.getByText(message).element().closest('li');
  if (!(element instanceof HTMLElement)) {
    throw new Error(`「${message}」のトーストがありません。`);
  }
  return element;
}

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('Toaster・notify', () => {
  test('表示前から置かれた丁寧なライブリージョンの中にトーストを出し、内容を支援技術へ伝える', async () => {
    await render(<Toaster />);
    const region = liveRegion();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-relevant')).toBe('additions text');
    expect(region.getAttribute('aria-label')).toMatch(/^通知/u);

    notify.success(UPVOTED);

    await expect.element(page.getByText(UPVOTED)).toBeVisible();
    expect(liveRegion()).toBe(region);
    expect(region.contains(toastOf(UPVOTED))).toBe(true);
  });

  test('トーストは画面の下中央に出る', async () => {
    await render(<Toaster />);

    notify.success(UPVOTED);

    await expect.element(page.getByText(UPVOTED)).toBeVisible();
    const list = toastOf(UPVOTED).closest('ol');
    expect(list?.dataset.yPosition).toBe('bottom');
    expect(list?.dataset.xPosition).toBe('center');
    const { bottom } = toastOf(UPVOTED).getBoundingClientRect();
    expect(bottom).toBeGreaterThan(window.innerHeight / 2);
  });

  test.each(KINDS)(
    '%sの種類のトーストも同じライブリージョンへ出す',
    async (kind) => {
      await render(<Toaster />);
      const message = `${kind}の結果を表示しました。`;

      notify[kind](message);

      await expect.element(page.getByText(message)).toBeVisible();
      expect(toastOf(message).dataset.type).toBe(kind);
      expect(liveRegion().contains(toastOf(message))).toBe(true);
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('Tabでトーストへ移ると、sonnerの輪郭を消す規則があってもリングのトークンの実線の輪郭を出す', async () => {
      applyColorScheme(scheme);
      await render(<Toaster />);

      notify.success(UPVOTED);

      await expect.element(page.getByText(UPVOTED)).toBeVisible();
      expect(sonnerRemovesToastOutline()).toBe(true);
      const item = toastOf(UPVOTED);
      await userEvent.tab();
      expect(document.activeElement).toBe(item);
      await expect.poll(() => outlineOf(item)).toStrictEqual(ringOutline());
      expect(getComputedStyle(item).outlineOffset).toBe('2px');
    });

    test('トーストはポップオーバーのトークンの色で表示する', async () => {
      applyColorScheme(scheme);
      await render(<Toaster />);

      notify.success(UPVOTED);

      await expect.element(page.getByText(UPVOTED)).toBeVisible();
      const { backgroundColor, color } = getComputedStyle(toastOf(UPVOTED));
      expect(backgroundColor).toBe(tokenColorOf('popover'));
      expect(color).toBe(tokenColorOf('popover-foreground'));
    });

    test('すべての種類のトーストを出してもアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<Toaster />);

      for (const kind of KINDS) {
        notify[kind](`${kind}の結果を表示しました。`);
      }

      await expect
        .element(page.getByText('errorの結果を表示しました。'))
        .toBeVisible();
      expect(await runAxe(liveRegion())).toStrictEqual([]);
    });
  });
});

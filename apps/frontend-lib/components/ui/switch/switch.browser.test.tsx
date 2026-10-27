import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { Label } from '../label/label.tsx';
import { Switch } from './switch.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('Switch', () => {
  test('関連付けたラベルの名前を持ち、TabでフォーカスしてSpaceとEnterで切り替わる', async () => {
    await render(
      <>
        <Switch id="notify" />
        <Label htmlFor="notify">通知を受け取る</Label>
      </>,
    );
    const toggle = page.getByRole('switch', { name: '通知を受け取る' });

    await userEvent.tab();
    await userEvent.keyboard(' ');
    const checkedBySpace = toggle.element().getAttribute('aria-checked');
    await userEvent.keyboard('{Enter}');

    await expect.element(toggle).toHaveFocus();
    expect(checkedBySpace).toBe('true');
    await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('無効の時は、Tabでフォーカスが移らず、押しても切り替わらない', async () => {
    await render(
      <>
        <Switch aria-label="通知を受け取る" disabled />
        <button type="button">次へ</button>
      </>,
    );
    const toggle = page.getByRole('switch', { name: '通知を受け取る' });

    await userEvent.tab();
    const focusedByTab = document.activeElement;
    await toggle.click({ force: true });

    expect(focusedByTab).toBe(
      page.getByRole('button', { name: '次へ' }).element(),
    );
    await expect.element(toggle).toBeDisabled();
    await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
    expect(getComputedStyle(toggle.element()).opacity).toBe('0.5');
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<Switch aria-label="通知を受け取る" />);
      const toggle = page.getByRole('switch', { name: '通知を受け取る' });

      await userEvent.tab();

      await expect.element(toggle).toHaveFocus();
      await expect
        .poll(() => outlineOf(toggle.element()))
        .toStrictEqual(ringOutline());
    },
  );

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、オンとオフを動きに頼らず状態の属性と面の色で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(
        <>
          <Switch aria-label="オンの設定" defaultChecked />
          <Switch aria-label="オフの設定" />
        </>,
      );
      const on = page.getByRole('switch', { name: 'オンの設定' });
      const off = page.getByRole('switch', { name: 'オフの設定' });

      await expect.element(on).toHaveAttribute('aria-checked', 'true');
      await expect.element(off).toHaveAttribute('aria-checked', 'false');
      expect(getComputedStyle(on.element()).backgroundColor).toBe(
        tokenColorOf('primary'),
      );
      expect(getComputedStyle(off.element()).backgroundColor).not.toBe(
        tokenColorOf('primary'),
      );
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('オン・オフ・無効・小さい大きさで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col items-start gap-4 p-4">
          <Switch aria-label="オンの設定" defaultChecked />
          <Switch aria-label="オフの設定" />
          <Switch aria-label="無効の設定" disabled />
          <Switch aria-label="小さい設定" size="sm" />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});

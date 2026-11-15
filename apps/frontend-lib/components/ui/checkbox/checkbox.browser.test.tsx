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
import { Checkbox } from './checkbox.tsx';

const AGREEMENT = '利用規約に同意する';

const agreement = () => page.getByRole('checkbox', { name: AGREEMENT });

function AgreementCheckbox(props: { readonly disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="agreement" {...props} />
      <Label htmlFor="agreement">{AGREEMENT}</Label>
    </div>
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('Checkbox', () => {
  test('既定は未選択で、関連付けたラベルの名前を持つ', async () => {
    await render(<AgreementCheckbox />);

    await expect.element(agreement()).not.toBeChecked();
  });

  test('ラベルのクリックで選択と解除を切り替える', async () => {
    await render(<AgreementCheckbox />);

    await userEvent.click(page.getByText(AGREEMENT));
    const checkedByLabel = agreement().element().getAttribute('aria-checked');
    await userEvent.click(page.getByText(AGREEMENT));

    expect(checkedByLabel).toBe('true');
    await expect.element(agreement()).not.toBeChecked();
  });

  test('TabでフォーカスしてSpaceで切り替える', async () => {
    await render(<AgreementCheckbox />);

    await userEvent.tab();
    await userEvent.keyboard(' ');

    await expect.element(agreement()).toHaveFocus();
    await expect.element(agreement()).toBeChecked();
  });

  test('無効の時は、Tabでフォーカスが移らず、押しても切り替わらない', async () => {
    await render(
      <>
        <AgreementCheckbox disabled />
        <button type="button">次へ</button>
      </>,
    );

    await userEvent.tab();
    const focusedByTab = document.activeElement;
    await agreement().click({ force: true });

    expect(focusedByTab).toBe(
      page.getByRole('button', { name: '次へ' }).element(),
    );
    await expect.element(agreement()).toBeDisabled();
    await expect.element(agreement()).not.toBeChecked();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<AgreementCheckbox />);

      await userEvent.tab();

      await expect.element(agreement()).toHaveFocus();
      await expect
        .poll(() => outlineOf(agreement().element()))
        .toStrictEqual(ringOutline());
    },
  );

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、選択を状態の属性と面の色で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(
        <>
          <Checkbox aria-label="選択済み" defaultChecked />
          <Checkbox aria-label="未選択" />
        </>,
      );
      const checked = page.getByRole('checkbox', { name: '選択済み' });
      const unchecked = page.getByRole('checkbox', { name: '未選択' });

      await expect.element(checked).toBeChecked();
      await expect.element(unchecked).not.toBeChecked();
      expect(getComputedStyle(checked.element()).backgroundColor).toBe(
        tokenColorOf('primary'),
      );
      expect(getComputedStyle(unchecked.element()).backgroundColor).not.toBe(
        tokenColorOf('primary'),
      );
    },
  );

  test('入力のエラーの間は、枠を破壊的な操作の色で示す', async () => {
    await render(<Checkbox aria-label={AGREEMENT} aria-invalid />);

    expect(getComputedStyle(agreement().element()).borderTopColor).toBe(
      tokenColorOf('destructive'),
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('選択・未選択・無効・エラーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col items-start gap-4 p-4">
          <AgreementCheckbox />
          <Checkbox aria-label="選択済み" defaultChecked />
          <Checkbox aria-label="無効" disabled />
          <Checkbox aria-label="エラー" aria-invalid />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});

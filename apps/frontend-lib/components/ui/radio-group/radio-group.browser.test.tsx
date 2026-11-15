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
} from '../../../test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../test/keyboard.ts';
import { Label } from '../label/label.tsx';
import { RadioGroup } from './radio-group.tsx';
import { RadioGroupItem } from './radio-group-item.tsx';

interface PlanOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const PLANS: readonly PlanOption[] = [
  { value: 'free', label: '無料' },
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
];

function PlanRadioGroup({
  options = PLANS,
  disabled = false,
}: {
  readonly options?: readonly PlanOption[];
  readonly disabled?: boolean;
}) {
  return (
    <RadioGroup aria-label="プラン" defaultValue="free" disabled={disabled}>
      {options.map(({ value, label, disabled: itemDisabled }) => (
        <div key={value} className="flex items-center gap-2">
          <RadioGroupItem
            id={`plan-${value}`}
            value={value}
            disabled={itemDisabled}
          />
          <Label htmlFor={`plan-${value}`}>{label}</Label>
        </div>
      ))}
    </RadioGroup>
  );
}

const radioOf = (name: string) => page.getByRole('radio', { name });

const pressArrowDown = () => pressKeyUntilFocusMoves('ArrowDown');

afterEach(() => {
  applyColorScheme('light');
});

describe('RadioGroup・RadioGroupItem', () => {
  test('Tabで選択中の項目へフォーカスが移り、矢印キーで項目を移って選ぶ', async () => {
    await render(<PlanRadioGroup />);

    await userEvent.tab();
    const focusedByTab = document.activeElement;
    await pressArrowDown();
    await expect.element(radioOf('Silver')).toBeChecked();
    await pressArrowDown();
    await expect.element(radioOf('Gold')).toBeChecked();
    await pressArrowDown();

    expect(focusedByTab).toBe(radioOf('無料').element());
    await expect.element(radioOf('無料')).toHaveFocus();
    await expect.element(radioOf('無料')).toBeChecked();
    await expect.element(radioOf('Gold')).not.toBeChecked();
  });

  test('グループの名前と項目のラベルの名前を持つ', async () => {
    await render(<PlanRadioGroup />);

    await expect
      .element(page.getByRole('radiogroup', { name: 'プラン' }))
      .toBeInTheDocument();
    await expect.element(radioOf('Silver')).toBeInTheDocument();
  });

  test('無効の項目は、矢印キーの移動先にならず、無効であることを示す', async () => {
    await render(
      <PlanRadioGroup
        options={[
          { value: 'free', label: '無料' },
          { value: 'silver', label: 'Silver', disabled: true },
          { value: 'gold', label: 'Gold' },
        ]}
      />,
    );

    await userEvent.tab();
    await pressArrowDown();

    await expect.element(radioOf('Gold')).toHaveFocus();
    await expect.element(radioOf('Gold')).toBeChecked();
    await expect.element(radioOf('Silver')).toBeDisabled();
    expect(getComputedStyle(radioOf('Silver').element()).opacity).toBe('0.5');
  });

  test('グループ全体が無効の時は、Tabでフォーカスが移らない', async () => {
    await render(
      <>
        <PlanRadioGroup disabled />
        <button type="button">次へ</button>
      </>,
    );

    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '次へ' }))
      .toHaveFocus();
    await expect.element(radioOf('無料')).toBeDisabled();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<PlanRadioGroup />);

      await userEvent.tab();

      await expect.element(radioOf('無料')).toHaveFocus();
      await expect
        .poll(() => outlineOf(radioOf('無料').element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('選択中・未選択・無効の項目で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="p-4">
          <PlanRadioGroup
            options={[
              ...PLANS,
              { value: 'legend', label: 'Legend', disabled: true },
            ]}
          />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});

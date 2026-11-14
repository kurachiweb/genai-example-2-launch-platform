import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { type AxeViolationSummary, runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../test/keyboard.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../../test/reduced-motion.ts';
import { Label } from '../label/label.tsx';
import { Select } from './select.tsx';
import { SelectContent } from './select-content.tsx';
import { SelectGroup } from './select-group.tsx';
import { SelectItem } from './select-item.tsx';
import { SelectLabel } from './select-label.tsx';
import { SelectSeparator } from './select-separator.tsx';
import { SelectTrigger } from './select-trigger.tsx';
import { SelectValue } from './select-value.tsx';

const ROLE_LABEL = 'ロール';

function RoleSelect({
  defaultValue,
  disabled,
  invalid,
  name,
  onValueChange,
}: {
  readonly defaultValue?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly name?: string;
  readonly onValueChange?: (value: string) => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <Label htmlFor="role">{ROLE_LABEL}</Label>
      <Select
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        onValueChange={onValueChange}
      >
        <SelectTrigger id="role" aria-invalid={invalid}>
          <SelectValue placeholder="ロールを選択" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>管理者のロール</SelectLabel>
            <SelectItem value="owner">最上位管理者</SelectItem>
            <SelectItem value="admin" disabled>
              管理者
            </SelectItem>
            <SelectItem value="operator">運営者</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value="viewer">閲覧者</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

const trigger = () => page.getByRole('combobox', { name: ROLE_LABEL });
const listbox = () => page.getByRole('listbox');
const option = (name: string) =>
  page.getByRole('option', { name, exact: true });

async function openWithKeyboard(): Promise<void> {
  await userEvent.tab();
  await expect.element(trigger()).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(listbox()).toBeInTheDocument();
}

// 一覧を開くと外側はaria-hiddenになるため、検査の補助が外側の開いた元の要素を違反に数えないよう、開いた一覧だけを検査する
async function runAxeOnOpenListbox(): Promise<readonly AxeViolationSummary[]> {
  const openListboxes = page.getByRole('listbox').elements();
  expect(openListboxes.length).toBeGreaterThan(0);
  const violations: AxeViolationSummary[] = [];
  for (const openListbox of openListboxes) {
    violations.push(...(await runAxe(openListbox)));
  }
  return violations;
}

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('Select', () => {
  test('関連付けたラベルの名前を持ち、未選択の間は仮の文言を示す', async () => {
    await render(<RoleSelect />);

    await expect.element(trigger()).toHaveTextContent('ロールを選択');
    await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  test('キーボードで開くと、選択肢の一覧を示し、フォーカスが最初の選択肢へ移る', async () => {
    await render(<RoleSelect />);
    const triggerElement = trigger().element();

    await openWithKeyboard();

    expect(triggerElement).toHaveAttribute('aria-expanded', 'true');
    await expect.element(option('最上位管理者')).toHaveFocus();
    await expect
      .element(page.getByRole('group', { name: '管理者のロール' }))
      .toBeInTheDocument();
  });

  test('矢印キーで無効の選択肢を飛ばして移り、Enterで選ぶと閉じて選んだ値を示し、フォーカスが開いた元の要素へ戻る', async () => {
    const onValueChange = vi.fn();
    await render(<RoleSelect onValueChange={onValueChange} />);
    await openWithKeyboard();

    await pressKeyUntilFocusMoves('ArrowDown');
    await expect.element(option('運営者')).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('operator');
    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
    await expect.element(trigger()).toHaveTextContent('運営者');
    await expect.element(option('管理者')).not.toBeInTheDocument();
  });

  test('選択済みの値で開くと、フォーカスが選んだ選択肢へ移り、選んだ状態を示す', async () => {
    await render(<RoleSelect defaultValue="viewer" />);

    await openWithKeyboard();

    await expect.element(option('閲覧者')).toHaveFocus();
    await expect
      .element(option('閲覧者'))
      .toHaveAttribute('aria-selected', 'true');
    await expect
      .element(option('最上位管理者'))
      .toHaveAttribute('aria-selected', 'false');
    await expect
      .element(option('管理者'))
      .toHaveAttribute('aria-disabled', 'true');
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じると値を変えずに一覧が取り除かれ、フォーカスが開いた元の要素へ戻る',
    async (preference) => {
      await emulateReducedMotion(preference);
      const onValueChange = vi.fn();
      await render(
        <RoleSelect defaultValue="owner" onValueChange={onValueChange} />,
      );
      await openWithKeyboard();
      await pressKeyUntilFocusMoves('ArrowDown');

      await userEvent.keyboard('{Escape}');

      await expect.element(listbox()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
      await expect.element(trigger()).toHaveTextContent('最上位管理者');
      expect(onValueChange).not.toHaveBeenCalled();
    },
  );

  test('フォームの中では、名前を付けた選択の値をフォームの値として送る', async () => {
    const onSubmit = vi.fn<(role: FormDataEntryValue | null) => void>();
    await render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget).get('role'));
        }}
      >
        <RoleSelect name="role" defaultValue="operator" />
        <button type="submit">絞り込む</button>
      </form>,
    );

    await userEvent.click(page.getByRole('button', { name: '絞り込む' }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('operator');
  });

  test('無効の時は、Tabでフォーカスが移らず、押しても開かない', async () => {
    await render(
      <>
        <RoleSelect disabled />
        <button type="button">次へ</button>
      </>,
    );

    await userEvent.tab();
    const focusedByTab = document.activeElement;
    await trigger().click({ force: true });

    expect(focusedByTab).toBe(
      page.getByRole('button', { name: '次へ' }).element(),
    );
    await expect.element(trigger()).toBeDisabled();
    await expect.element(listbox()).not.toBeInTheDocument();
  });

  test('入力のエラーの間は、枠を破壊的な操作の色で示す', async () => {
    await render(<RoleSelect invalid />);

    expect(getComputedStyle(trigger().element()).borderTopColor).toBe(
      tokenColorOf('destructive'),
    );
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスを、開く要素と選択肢のどちらもリングの色の輪郭で示し、選択肢は着色した背景で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<RoleSelect />);

      await userEvent.tab();
      await expect
        .poll(() => outlineOf(trigger().element()))
        .toStrictEqual(ringOutline());
      await userEvent.keyboard('{Enter}');
      const focused = option('最上位管理者').element();
      await expect.element(option('最上位管理者')).toHaveFocus();

      await expect.poll(() => outlineOf(focused)).toStrictEqual(ringOutline());
      expect(getComputedStyle(focused).backgroundColor).toBe(
        tokenColorOf('accent'),
      );
      expect(getComputedStyle(focused).color).toBe(
        tokenColorOf('accent-foreground'),
      );
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('未選択・選択済み・無効・エラーの開く要素で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col gap-4 p-4">
          <RoleSelect />
          <Select defaultValue="owner">
            <SelectTrigger aria-label="選択済み">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">最上位管理者</SelectItem>
            </SelectContent>
          </Select>
          <Select disabled>
            <SelectTrigger aria-label="無効" size="sm">
              <SelectValue placeholder="選択できません" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">最上位管理者</SelectItem>
            </SelectContent>
          </Select>
          <Select>
            <SelectTrigger aria-label="エラー" aria-invalid>
              <SelectValue placeholder="ロールを選択" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">最上位管理者</SelectItem>
            </SelectContent>
          </Select>
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('開いた一覧で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<RoleSelect defaultValue="operator" />);
      await openWithKeyboard();

      expect(await runAxeOnOpenListbox()).toStrictEqual([]);
    });
  });
});

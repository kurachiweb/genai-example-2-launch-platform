import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../test/keyboard.ts';
import type { EditorAction, EditorController } from './editor-controller.ts';
import {
  MarkdownToolbar,
  type MarkdownToolbarProps,
} from './markdown-toolbar.tsx';

const EDITABLE_ID = 'markdown-editor-body';

const PREVIOUS_BUTTON = '前の要素';

const NEXT_BUTTON = '次の要素';

const ACTION_NAMES = [
  '見出し',
  '太字',
  '斜体',
  'リンク',
  '箇条書き',
  '番号付きリスト',
  '引用',
  'コード',
  'コードブロック',
  '表',
] as const;

const TOGGLE_ACTION_NAMES = [
  '見出し',
  '太字',
  '斜体',
  '箇条書き',
  '番号付きリスト',
  '引用',
  'コード',
  'コードブロック',
] as const;

const RUNNABLE_ACTIONS: readonly (readonly [
  string,
  Exclude<EditorAction, 'link'>,
])[] = [
  ['見出し', 'heading'],
  ['太字', 'bold'],
  ['斜体', 'italic'],
  ['箇条書き', 'bulletList'],
  ['番号付きリスト', 'orderedList'],
  ['引用', 'blockquote'],
  ['コード', 'inlineCode'],
  ['コードブロック', 'codeBlock'],
  ['表', 'table'],
];

const KEYBOARD_HINT =
  'リストの項目の階層を下げる操作と表の次のセルへの移動はCtrl+]、階層を上げる操作と表の前のセルへの移動はCtrl+[で行います(macOSではCtrlの代わりにCommand)。';

type FakeController = {
  readonly [Key in keyof EditorController]: Mock<EditorController[Key]>;
};

const createController = (): FakeController => ({
  run: vi.fn<EditorController['run']>(),
  currentLink: vi.fn<EditorController['currentLink']>(),
  applyLink: vi.fn<EditorController['applyLink']>(),
  replaceMarkdown: vi.fn<EditorController['replaceMarkdown']>(),
  readMarkdown: vi.fn<EditorController['readMarkdown']>(() => ''),
  focus: vi.fn<EditorController['focus']>(),
});

const toolbar = () => page.getByRole('toolbar', { name: '書式' });

const actionButton = (name: string) =>
  toolbar().getByRole('button', { name, exact: true });

type ToolbarOverrides = Partial<MarkdownToolbarProps>;

interface ToolbarHarnessOptions {
  readonly hasEditable?: boolean;
}

// 編集領域は読み込みの後にだけ描画されるため、読み込み前の状態は指す先の無いページで確かめる
const toolbarElement = (
  props: MarkdownToolbarProps,
  { hasEditable = true }: ToolbarHarnessOptions,
) => (
  <div>
    <button type="button">{PREVIOUS_BUTTON}</button>
    <MarkdownToolbar {...props} />
    {hasEditable ? <p id={EDITABLE_ID}>本文</p> : null}
    <button type="button">{NEXT_BUTTON}</button>
  </div>
);

async function renderToolbar(
  overrides: ToolbarOverrides = {},
  options: ToolbarHarnessOptions = {},
) {
  const controller = createController();
  const onRequestLink = vi.fn<MarkdownToolbarProps['onRequestLink']>();
  const props: MarkdownToolbarProps = {
    controller,
    activeActions: new Set(),
    controlsId: EDITABLE_ID,
    onRequestLink,
    ...overrides,
  };
  const screen = await render(toolbarElement(props, options));
  return {
    controller,
    onRequestLink,
    container: screen.container,
    rerender: async (next: ToolbarOverrides) => {
      await screen.rerender(toolbarElement({ ...props, ...next }, options));
    },
  };
}

async function focusFirstItem(): Promise<void> {
  await userEvent.click(page.getByRole('button', { name: PREVIOUS_BUTTON }));
  await userEvent.tab();
  await expect.element(actionButton('見出し')).toHaveFocus();
}

afterEach(() => {
  applyColorScheme('light');
});

describe('MarkdownToolbar', () => {
  test('書式のツールバーとして編集領域を指し、10個の操作に日本語の名前と同じ文言のツールチップを付ける', async () => {
    await renderToolbar();

    await expect
      .element(toolbar())
      .toHaveAttribute('aria-controls', EDITABLE_ID);
    const buttons = toolbar().getByRole('button').elements();
    expect(
      buttons.map((button) => button.getAttribute('aria-label')),
    ).toStrictEqual([...ACTION_NAMES]);
    expect(buttons.map((button) => button.getAttribute('title'))).toStrictEqual(
      [...ACTION_NAMES],
    );
    for (const button of buttons) {
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    }
  });

  test('切り替えの操作だけが押下状態を持ち、挿入の「表」は持たず、「リンク」はダイアログを開くことを伝える', async () => {
    await renderToolbar();

    for (const name of TOGGLE_ACTION_NAMES) {
      await expect
        .element(actionButton(name))
        .toHaveAttribute('aria-pressed', 'false');
    }
    await expect
      .element(actionButton('表'))
      .not.toHaveAttribute('aria-pressed');
    await expect
      .element(actionButton('リンク'))
      .not.toHaveAttribute('aria-pressed');
    await expect
      .element(actionButton('リンク'))
      .toHaveAttribute('aria-haspopup', 'dialog');
    await expect
      .element(actionButton('表'))
      .not.toHaveAttribute('aria-haspopup');
  });

  test('制御器が無い間は、まだ無い編集領域を指さない', async () => {
    const { rerender } = await renderToolbar(
      { controller: undefined },
      { hasEditable: false },
    );

    await expect.element(toolbar()).not.toHaveAttribute('aria-controls');

    await rerender({ controller: createController() });

    await expect
      .element(toolbar())
      .toHaveAttribute('aria-controls', EDITABLE_ID);
  });

  test('リストの階層の変更と表のセルの移動のキー操作を、ツールバーの説明として支援技術へ伝える', async () => {
    await renderToolbar();

    await expect.element(toolbar()).toHaveAccessibleDescription(KEYBOARD_HINT);
  });

  test('Tabキーで最初の項目へ入り、矢印キー・Home・Endで項目を移り、端からは反対の端へ回る', async () => {
    await renderToolbar();
    await focusFirstItem();

    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(actionButton('太字')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowLeft');
    await expect.element(actionButton('見出し')).toHaveFocus();
    await pressKeyUntilFocusMoves('End');
    await expect.element(actionButton('表')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(actionButton('見出し')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowLeft');
    await expect.element(actionButton('表')).toHaveFocus();
    await pressKeyUntilFocusMoves('Home');
    await expect.element(actionButton('見出し')).toHaveFocus();
  });

  test('ツールバーはTabの停止位置を1つだけ持ち、Tabキーで抜けて、戻ると最後に移った項目へ入る', async () => {
    await renderToolbar();
    await focusFirstItem();
    await pressKeyUntilFocusMoves('ArrowRight');
    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(actionButton('斜体')).toHaveFocus();

    await userEvent.tab();
    await expect
      .element(page.getByRole('button', { name: NEXT_BUTTON }))
      .toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect.element(actionButton('斜体')).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect
      .element(page.getByRole('button', { name: PREVIOUS_BUTTON }))
      .toHaveFocus();
  });

  test.each(RUNNABLE_ACTIONS)(
    '「%s」をEnterキーで押すと、制御器で操作%sを実行して編集領域へフォーカスを戻す',
    async (name, action) => {
      const { controller, onRequestLink } = await renderToolbar();
      await focusFirstItem();
      while (document.activeElement?.getAttribute('aria-label') !== name) {
        await pressKeyUntilFocusMoves('ArrowRight');
      }

      await userEvent.keyboard('{Enter}');

      expect(controller.run).toHaveBeenCalledExactlyOnceWith(action);
      expect(controller.focus).toHaveBeenCalledOnce();
      expect(onRequestLink).not.toHaveBeenCalled();
    },
  );

  test('Spaceキーとクリックでも操作を実行する', async () => {
    const { controller } = await renderToolbar();
    await focusFirstItem();
    await pressKeyUntilFocusMoves('End');

    await userEvent.keyboard(' ');
    expect(controller.run).toHaveBeenLastCalledWith('table');

    await userEvent.click(actionButton('太字'));
    expect(controller.run).toHaveBeenLastCalledWith('bold');
    expect(controller.run).toHaveBeenCalledTimes(2);
  });

  test('「リンク」は制御器の操作を実行せず、リンクのダイアログを要求する', async () => {
    const { controller, onRequestLink } = await renderToolbar();
    await focusFirstItem();
    await pressKeyUntilFocusMoves('ArrowRight');
    await pressKeyUntilFocusMoves('ArrowRight');
    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(actionButton('リンク')).toHaveFocus();

    await userEvent.keyboard('{Enter}');

    expect(onRequestLink).toHaveBeenCalledOnce();
    expect(controller.run).not.toHaveBeenCalled();
    expect(controller.focus).not.toHaveBeenCalled();
  });

  test('選択中の書式を切り替えの操作の押下状態で示し、選択が変わると押下状態を更新する', async () => {
    const { rerender } = await renderToolbar({
      activeActions: new Set<EditorAction>(['bold', 'link', 'table']),
    });

    await expect
      .element(actionButton('太字'))
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(actionButton('リンク'))
      .not.toHaveAttribute('aria-pressed');
    await expect
      .element(actionButton('表'))
      .not.toHaveAttribute('aria-pressed');
    await expect
      .element(actionButton('斜体'))
      .toHaveAttribute('aria-pressed', 'false');

    await rerender({ activeActions: new Set<EditorAction>(['italic']) });

    await expect
      .element(actionButton('太字'))
      .toHaveAttribute('aria-pressed', 'false');
    await expect
      .element(actionButton('斜体'))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('制御器が無い間は全ての操作を無効にしてTabの停止位置から外し、制御器を受け取ると操作できる', async () => {
    const onRequestLink = vi.fn<MarkdownToolbarProps['onRequestLink']>();
    const { rerender } = await renderToolbar({
      controller: undefined,
      onRequestLink,
    });

    for (const name of ACTION_NAMES) {
      await expect.element(actionButton(name)).toBeDisabled();
    }
    await userEvent.click(page.getByRole('button', { name: PREVIOUS_BUTTON }));
    await userEvent.tab();
    await expect
      .element(page.getByRole('button', { name: NEXT_BUTTON }))
      .toHaveFocus();

    const controller = createController();
    await rerender({ controller });

    await expect.element(actionButton('太字')).toBeEnabled();
    await userEvent.click(actionButton('太字'));
    expect(controller.run).toHaveBeenCalledExactlyOnceWith('bold');
  });

  test('入力欄が無効の間は、制御器があっても全ての操作を無効にする', async () => {
    const { controller } = await renderToolbar({ disabled: true });

    for (const name of ACTION_NAMES) {
      await expect.element(actionButton(name)).toBeDisabled();
    }
    expect(controller.run).not.toHaveBeenCalled();
  });

  test('プレビューの間は操作できない状態を伝えてフォーカスは受け、キーボードで押しても何もしない', async () => {
    const { controller, onRequestLink } = await renderToolbar({
      inactive: true,
    });

    for (const name of ACTION_NAMES) {
      await expect
        .element(actionButton(name))
        .toHaveAttribute('aria-disabled', 'true');
    }
    await focusFirstItem();
    await userEvent.keyboard('{Enter}');
    await pressKeyUntilFocusMoves('ArrowRight');
    await pressKeyUntilFocusMoves('ArrowRight');
    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(actionButton('リンク')).toHaveFocus();
    await userEvent.keyboard(' ');

    expect(controller.run).not.toHaveBeenCalled();
    expect(controller.focus).not.toHaveBeenCalled();
    expect(onRequestLink).not.toHaveBeenCalled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('押下状態の項目を含むツールバーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderToolbar({
        activeActions: new Set<EditorAction>([
          'heading',
          'bold',
          'bulletList',
          'codeBlock',
        ]),
      });

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('編集領域を読み込む前の操作できない状態のツールバーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderToolbar(
        { controller: undefined },
        { hasEditable: false },
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('プレビューの間のツールバーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderToolbar({ inactive: true });

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});

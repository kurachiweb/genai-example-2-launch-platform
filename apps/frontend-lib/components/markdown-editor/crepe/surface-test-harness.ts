import { createElement, type ReactElement } from 'react';
import { expect, type Mock, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type {
  EditorController,
  EditorSurfaceProps,
} from '../editor-controller.ts';
import CrepeEditorSurface from './crepe-editor-surface.tsx';

export const EDITABLE_ID = 'editor-body';

export const LABEL_ID = 'editor-label';

export const DESCRIPTION_ID = 'editor-description';

export const ERROR_ID = 'editor-error';

export const PLACEHOLDER = '本文を入力してください';

export const PREVIOUS_BUTTON = '前の要素';

export const NEXT_BUTTON = '次の要素';

export interface SurfaceHandlers {
  readonly onReady: Mock<EditorSurfaceProps['onReady']>;
  readonly onMarkdownChange: Mock<EditorSurfaceProps['onMarkdownChange']>;
  readonly onActiveActionsChange: Mock<
    EditorSurfaceProps['onActiveActionsChange']
  >;
  readonly onBlur: Mock<EditorSurfaceProps['onBlur']>;
  readonly onRequestLink: Mock<EditorSurfaceProps['onRequestLink']>;
}

const createHandlers = (): SurfaceHandlers => ({
  onReady: vi.fn<EditorSurfaceProps['onReady']>(),
  onMarkdownChange: vi.fn<EditorSurfaceProps['onMarkdownChange']>(),
  onActiveActionsChange: vi.fn<EditorSurfaceProps['onActiveActionsChange']>(),
  onBlur: vi.fn<EditorSurfaceProps['onBlur']>(),
  onRequestLink: vi.fn<EditorSurfaceProps['onRequestLink']>(),
});

export type SurfaceOverrides = Partial<
  Omit<EditorSurfaceProps, keyof SurfaceHandlers>
>;

// 部品のカタログの検査は`components/**/*.tsx`を部品として扱うため、テストの補助はJSXを使わず`.ts`に置く
const surfaceElement = (
  handlers: SurfaceHandlers,
  overrides: SurfaceOverrides = {},
): ReactElement =>
  createElement(
    'div',
    null,
    createElement('button', { type: 'button' }, PREVIOUS_BUTTON),
    createElement('span', { id: LABEL_ID }, '本文'),
    createElement('p', { id: DESCRIPTION_ID }, 'マークダウンで書けます。'),
    createElement('p', { id: ERROR_ID }, '本文を入力してください。'),
    createElement(CrepeEditorSurface, {
      initialValue: '',
      editableId: EDITABLE_ID,
      labelledBy: LABEL_ID,
      describedBy: DESCRIPTION_ID,
      invalid: false,
      disabled: false,
      placeholder: PLACEHOLDER,
      ...handlers,
      ...overrides,
    }),
    createElement('button', { type: 'button' }, NEXT_BUTTON),
  );

export interface RenderedSurface {
  readonly container: HTMLElement;
  readonly editable: HTMLElement;
  readonly controller: EditorController;
  readonly handlers: SurfaceHandlers;
  readonly rerender: (overrides: SurfaceOverrides) => Promise<void>;
}

const editableOf = (container: HTMLElement): HTMLElement => {
  const editable = container.querySelector<HTMLElement>(`#${EDITABLE_ID}`);
  if (editable === null) {
    throw new Error('編集領域が描画されていません。');
  }
  return editable;
};

export async function renderSurface(
  overrides: SurfaceOverrides = {},
): Promise<RenderedSurface> {
  const handlers = createHandlers();
  const screen = await render(surfaceElement(handlers, overrides));
  await expect.poll(() => handlers.onReady.mock.calls.length).toBe(1);
  const [[controller]] = handlers.onReady.mock.calls as [[EditorController]];
  return {
    container: screen.container,
    editable: editableOf(screen.container),
    controller,
    handlers,
    rerender: async (next) => {
      await screen.rerender(
        surfaceElement(handlers, { ...overrides, ...next }),
      );
    },
  };
}

// ProseMirrorはブラウザの選択範囲の変化(selectionchange)を受けて自身の選択範囲を更新するため、範囲を選んだ後は通知と次の描画を待つ
async function applyRange(editable: HTMLElement, range: Range): Promise<void> {
  editable.focus();
  const applied = new Promise((resolve) => {
    document.addEventListener(
      'selectionchange',
      () => requestAnimationFrame(resolve),
      { once: true },
    );
  });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await applied;
}

export async function selectTextOf(
  editable: HTMLElement,
  element: Element,
): Promise<void> {
  const range = document.createRange();
  range.selectNodeContents(element);
  await applyRange(editable, range);
}

export async function selectRange(
  editable: HTMLElement,
  node: Node,
  start: number,
  end: number,
): Promise<void> {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  await applyRange(editable, range);
}

export async function placeCursorAtEnd(
  editable: HTMLElement,
  element: Element,
): Promise<void> {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  await applyRange(editable, range);
}

export async function selectAll(editable: HTMLElement): Promise<void> {
  editable.focus();
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
}

export const elementIn = (root: Element, selector: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`${selector}が描画されていません。`);
  }
  return element;
};

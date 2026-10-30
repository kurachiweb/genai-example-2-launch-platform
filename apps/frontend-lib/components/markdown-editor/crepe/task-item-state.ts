import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

import {
  TASK_ITEM_CHECKED_LABEL,
  TASK_ITEM_UNCHECKED_LABEL,
} from '../../../utilities/messages/markdown-messages.ts';

const labelOf = (checked: boolean): string =>
  checked ? TASK_ITEM_CHECKED_LABEL : TASK_ITEM_UNCHECKED_LABEL;

const stateWidgetOf =
  (label: string) =>
  (view: EditorView): HTMLElement => {
    const element = view.dom.ownerDocument.createElement('span');
    element.className = 'sr-only';
    element.contentEditable = 'false';
    element.textContent = label;
    return element;
  };

// タスクの項目のチェックの箱は疑似要素の飾りで支援技術へ届かないため、項目の先頭に視覚的に隠した状態の文言を装飾として置く。装飾は文書に含まれず、マークダウンへ書き戻されない
const taskStateDecorationsOf = (
  doc: ProseNode,
  isListItem: (node: ProseNode) => boolean,
): DecorationSet => {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    const checked: unknown = node.attrs.checked;
    if (isListItem(node) && typeof checked === 'boolean') {
      const label = labelOf(checked);
      decorations.push(
        Decoration.widget(position + 1, stateWidgetOf(label), {
          side: -1,
          ignoreSelection: true,
          key: `task-state-${label}`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
};

export const taskItemStatePlugin: MilkdownPlugin = $prose((ctx) => {
  const isListItem = (node: ProseNode): boolean =>
    node.type === listItemSchema.type(ctx);
  const key = new PluginKey<DecorationSet>('MARKDOWN_EDITOR_TASK_STATE');
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => taskStateDecorationsOf(state.doc, isListItem),
      apply: (transaction, decorations) =>
        transaction.docChanged
          ? taskStateDecorationsOf(transaction.doc, isListItem)
          : decorations,
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
});

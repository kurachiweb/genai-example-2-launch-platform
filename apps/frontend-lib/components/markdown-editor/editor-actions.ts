import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  type LucideIcon,
  QuoteIcon,
  SquareCodeIcon,
  TableIcon,
} from 'lucide-react';

import {
  BLOCKQUOTE_ACTION_LABEL,
  BOLD_ACTION_LABEL,
  BULLET_LIST_ACTION_LABEL,
  CODE_BLOCK_ACTION_LABEL,
  HEADING_ACTION_LABEL,
  INLINE_CODE_ACTION_LABEL,
  ITALIC_ACTION_LABEL,
  LINK_ACTION_LABEL,
  ORDERED_LIST_ACTION_LABEL,
  TABLE_ACTION_LABEL,
} from '../../utilities/messages/markdown-messages.ts';
import type { EditorAction } from './editor-controller.ts';

// toggleは選択中の書式を付け外しする操作、insertは内容を挿入する操作、dialogは入力のダイアログを開く操作
export type EditorToolbarItemKind = 'toggle' | 'insert' | 'dialog';

export interface EditorToolbarItem {
  readonly action: EditorAction;
  readonly kind: EditorToolbarItemKind;
  readonly label: string;
  readonly icon: LucideIcon;
}

export const EDITOR_TOOLBAR_ITEMS: readonly EditorToolbarItem[] = [
  {
    action: 'heading',
    kind: 'toggle',
    label: HEADING_ACTION_LABEL,
    icon: Heading2Icon,
  },
  { action: 'bold', kind: 'toggle', label: BOLD_ACTION_LABEL, icon: BoldIcon },
  {
    action: 'italic',
    kind: 'toggle',
    label: ITALIC_ACTION_LABEL,
    icon: ItalicIcon,
  },
  { action: 'link', kind: 'dialog', label: LINK_ACTION_LABEL, icon: LinkIcon },
  {
    action: 'bulletList',
    kind: 'toggle',
    label: BULLET_LIST_ACTION_LABEL,
    icon: ListIcon,
  },
  {
    action: 'orderedList',
    kind: 'toggle',
    label: ORDERED_LIST_ACTION_LABEL,
    icon: ListOrderedIcon,
  },
  {
    action: 'blockquote',
    kind: 'toggle',
    label: BLOCKQUOTE_ACTION_LABEL,
    icon: QuoteIcon,
  },
  {
    action: 'inlineCode',
    kind: 'toggle',
    label: INLINE_CODE_ACTION_LABEL,
    icon: CodeIcon,
  },
  {
    action: 'codeBlock',
    kind: 'toggle',
    label: CODE_BLOCK_ACTION_LABEL,
    icon: SquareCodeIcon,
  },
  {
    action: 'table',
    kind: 'insert',
    label: TABLE_ACTION_LABEL,
    icon: TableIcon,
  },
];

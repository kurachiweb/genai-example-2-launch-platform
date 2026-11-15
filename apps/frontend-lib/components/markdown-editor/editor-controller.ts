export type EditorAction =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'inlineCode'
  | 'codeBlock'
  | 'table';

export interface EditorLink {
  readonly href: string;
}

export interface EditorController {
  run(action: Exclude<EditorAction, 'link'>): void;
  currentLink(): EditorLink | undefined;
  // undefinedを渡すと選択中のリンクを解除する
  applyLink(href: string | undefined): void;
  replaceMarkdown(markdown: string): void;
  readMarkdown(): string;
  focus(): void;
}

export interface EditorSurfaceProps {
  readonly initialValue: string;
  readonly editableId: string;
  readonly labelledBy: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly onReady: (controller: EditorController) => void;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onActiveActionsChange: (active: ReadonlySet<EditorAction>) => void;
  readonly onBlur: () => void;
  // 選択時のツールバーのリンクの項目とショートカットからの、リンクのダイアログを開く要求
  readonly onRequestLink: () => void;
}

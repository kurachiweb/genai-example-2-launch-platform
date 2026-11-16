import type { ComponentType, RefObject } from 'react';

export interface CommentActionContext {
  readonly comment: { readonly id: string; readonly authorNickname: string };
  readonly product: { readonly id: string; readonly handle: string };
  readonly launch: { readonly id: string };
}

export interface CommentActionItemProps extends CommentActionContext {
  // 選ぶとメニューを閉じ、同じ登録の`Dialog`を開く
  readonly onSelect: () => void;
}

export interface CommentActionDialogProps extends CommentActionContext {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // 閉じた後にフォーカスを戻す「…」のボタン
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export interface CommentAction {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // content-reportingの通報 10
  readonly order: number;
  // 他者の表示中のコメントの「…」メニューの中に描く。`DropdownMenuItem`を描いて選択で`onSelect`を呼び、該当しなければnullを描く
  readonly Item: ComponentType<CommentActionItemProps>;
  // メニューが閉じると中身が外れるため、メニューの外に描く。`open`の間だけ開き、閉じると`returnFocusRef`へフォーカスを戻す
  readonly Dialog: ComponentType<CommentActionDialogProps>;
}

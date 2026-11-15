import type { ComponentType } from 'react';

export interface CommentActionContext {
  readonly comment: { readonly id: string; readonly authorNickname: string };
  readonly product: { readonly id: string; readonly handle: string };
  readonly launch: { readonly id: string };
}

export interface CommentAction {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // content-reportingの通報 10
  readonly order: number;
  // 他者の表示中のコメントの「…」メニューに描く。`DropdownMenuItem`と自分のダイアログを描き、該当しなければnullを描く
  readonly component: ComponentType<CommentActionContext>;
}

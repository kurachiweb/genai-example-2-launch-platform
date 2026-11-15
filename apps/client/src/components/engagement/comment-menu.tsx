import { EllipsisIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DropdownMenu } from '../../../lib/components/ui/dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import { DropdownMenuTrigger } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-trigger.tsx';
import { COMMENT_ACTIONS } from '../../composition/comment-actions.ts';
import { orderSections } from '../layout/section-order.ts';
import type {
  CommentAction,
  CommentActionContext,
} from './comment-action-types.ts';
import {
  COMMENT_ACTIONS_MENU_LABEL,
  COMMENT_DELETE_LABEL,
  COMMENT_EDIT_LABEL,
} from './comment-messages.ts';
import { DeleteCommentDialog } from './delete-comment-dialog.tsx';

export interface CommentMenuProps {
  readonly context: CommentActionContext;
  readonly viewerIsAuthor: boolean;
  // 自身のコメントの「編集」。呼び出し元がその場の編集欄を開く
  readonly onEdit: () => void;
  // 自身のコメントの削除の確認で「削除」を確定した時の操作。解決すると確認のダイアログを閉じ、拒否するとダイアログに失敗の文言を示す
  readonly onDelete: (turnstileToken: string) => Promise<void>;
  // 他者のコメントの操作の登録口(COMMENT_ACTIONS)
  readonly actions?: readonly CommentAction[];
}

// 表示中のコメントにだけ描く。自身のコメントには「編集」「削除」を、他者のコメントには他の機能が登録した操作だけを出し、操作が無ければボタンごと出さない
export function CommentMenu({
  context,
  viewerIsAuthor,
  onEdit,
  onDelete,
  actions = COMMENT_ACTIONS,
}: CommentMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 確認のダイアログが自分の中へフォーカスを移すため、メニューを閉じた時にボタンへ戻すと奪い合いになる
  const focusHandOffRef = useRef(false);
  const ordered = viewerIsAuthor ? [] : orderSections(actions);
  if (!viewerIsAuthor && ordered.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            size="icon-xs"
            variant="ghost"
            aria-label={COMMENT_ACTIONS_MENU_LABEL}
          >
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            if (focusHandOffRef.current) {
              focusHandOffRef.current = false;
              event.preventDefault();
            }
          }}
        >
          {viewerIsAuthor ? (
            <>
              <DropdownMenuItem onSelect={onEdit}>
                <PencilIcon aria-hidden="true" />
                {COMMENT_EDIT_LABEL}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  focusHandOffRef.current = true;
                  setDeleteOpen(true);
                }}
              >
                <Trash2Icon aria-hidden="true" />
                {COMMENT_DELETE_LABEL}
              </DropdownMenuItem>
            </>
          ) : (
            ordered.map(({ id, component: Action }) => (
              <Action key={id} {...context} />
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {viewerIsAuthor ? (
        <DeleteCommentDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          returnFocusRef={triggerRef}
          onConfirm={onDelete}
        />
      ) : null}
    </>
  );
}

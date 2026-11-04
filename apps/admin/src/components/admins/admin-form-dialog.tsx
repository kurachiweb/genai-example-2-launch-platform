import { type ReactNode, type RefObject, useRef, useState } from 'react';

import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { AdminFormDialogControlsContext } from './admin-form-dialog-controls.ts';

export interface AdminFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  // 確定で開いた元の要素が消える操作で、閉じた後のフォーカスの移り先
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  // 中のフォームはuseAdminFormDialogControlsで処理中の状態と確定・取り消しの操作を読む
  readonly children: ReactNode;
}

// 共通部品のConfirmActionDialog・CategoryFormDialogと同じく、処理中は閉じず、外の押下で<body>へ落ちたフォーカスをダイアログへ戻し、閉じた後は開いた元の要素へフォーカスを戻す
export function AdminFormDialog({
  open,
  onOpenChange,
  title,
  description,
  returnFocusRef,
  children,
}: AdminFormDialogProps) {
  const [pending, setPending] = useState(false);
  // 処理中の状態は再描画の後に効くため、同じ描画の間に届いた閉じる操作もここで止める
  const pendingRef = useRef(false);
  const openerRef = useRef<Element | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const cancel = (): void => {
    if (!pendingRef.current) {
      onOpenChange(false);
    }
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // 開く元の要素を持たず状態で開くため、部品から届くのは閉じる要求だけ
      onOpenChange={(next) => {
        if (!next) {
          cancel();
        }
      }}
    >
      <DialogContent
        ref={contentRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        {...(description === undefined
          ? { 'aria-describedby': undefined }
          : {})}
        closeButtonDisabled={pending}
        onBlur={(event) => {
          // 処理中に受け付けなかったダイアログの外の押下は、フォーカスを<body>へ落として戻さないため、ダイアログへ戻す。ウィンドウの切り替えではフォーカスのある要素が変わらないため何もしない
          if (
            pendingRef.current &&
            event.relatedTarget === null &&
            document.activeElement === document.body
          ) {
            contentRef.current?.focus();
          }
        }}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef?.current ?? openerRef.current;
          if (target instanceof HTMLElement && target.isConnected) {
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <AdminFormDialogControlsContext value={{ pending, run, cancel }}>
          {children}
        </AdminFormDialogControlsContext>
      </DialogContent>
    </Dialog>
  );
}

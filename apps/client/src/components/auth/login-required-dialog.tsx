import { Link } from '@tanstack/react-router';
import { type RefObject, useRef } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { LOGIN_LABEL, REGISTER_LABEL } from './account-messages.ts';

export interface LoginRequiredDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly returnTo: string;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

export function LoginRequiredDialog({
  open,
  onOpenChange,
  title,
  description,
  returnTo,
  returnFocusRef,
}: LoginRequiredDialogProps) {
  const openerRef = useRef<Element | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement;
        }}
        // 開く元の操作をDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いた時のフォーカスの位置へ戻す
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
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild variant="outline">
            <Link to="/auth/register">{REGISTER_LABEL}</Link>
          </Button>
          <Button asChild>
            <Link to="/auth/login" search={{ redirect: returnTo }}>
              {LOGIN_LABEL}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

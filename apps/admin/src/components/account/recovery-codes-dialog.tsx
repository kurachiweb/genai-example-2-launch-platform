import type { RefObject } from 'react';

import { RecoveryCodeList } from '../../../lib/components/auth/recovery-code-list.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import {
  RECOVERY_CODES_DIALOG_DESCRIPTION,
  RECOVERY_CODES_DIALOG_TITLE,
} from './account-messages.ts';

export interface RecoveryCodesDialogProps {
  // nullの間は閉じている
  readonly codes: readonly string[] | null;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

export function RecoveryCodesDialog({
  codes,
  onClose,
  returnFocusRef,
}: RecoveryCodesDialogProps) {
  return (
    <Dialog
      open={codes !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        // 送信の結果で開くため、開いた元の送信ボタンではなく、再発行で変わった残数の文へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{RECOVERY_CODES_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>
            {RECOVERY_CODES_DIALOG_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        {codes === null ? null : <RecoveryCodeList codes={codes} />}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

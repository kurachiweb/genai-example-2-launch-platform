import { ScrollTextIcon } from 'lucide-react';

import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import {
  AUDITED_ACTION_NOTICE,
  CONFIRM_ACTION_CANCEL_LABEL,
} from '../../../lib/utilities/messages/admin-console-messages.ts';

export interface AdminFormDialogFooterProps {
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly onCancel: () => void;
  // 監査ログに記録される操作で、その旨を確定のボタンの前に示す
  readonly audited: boolean;
}

export function AdminFormDialogFooter({
  submitLabel,
  pending,
  onCancel,
  audited,
}: AdminFormDialogFooterProps) {
  return (
    <>
      {audited ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <ScrollTextIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{AUDITED_ACTION_NOTICE}</span>
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending ? true : undefined}
          onClick={onCancel}
        >
          {CONFIRM_ACTION_CANCEL_LABEL}
        </Button>
        <SubmitButton>{submitLabel}</SubmitButton>
      </DialogFooter>
    </>
  );
}

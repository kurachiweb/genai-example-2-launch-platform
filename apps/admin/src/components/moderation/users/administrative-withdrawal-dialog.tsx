import type { RefObject } from 'react';

import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
import { withdrawUserDialogCopy } from '../shared/moderation-messages.ts';

export interface AdministrativeWithdrawalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly target: AdminModerationUserView;
  readonly onCompleted: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

// 対象の利用者・取り消せない旨・本人の意思の確かめと完了の知らせをシステムの外のメールで行う旨を示し、理由を必須で受けて代理の退会を行う
export function AdministrativeWithdrawalDialog({
  open,
  onOpenChange,
  target,
  onCompleted,
  returnFocusRef,
}: AdministrativeWithdrawalDialogProps) {
  const copy = withdrawUserDialogCopy({
    nickname: target.nickname,
    handle: target.handle,
    suspended: target.status === 'suspended',
  });
  return (
    <ModerationActionDialog
      open={open}
      onOpenChange={onOpenChange}
      operation="user.administrative-withdraw"
      targetId={target.id}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      onCompleted={onCompleted}
      returnFocusRef={returnFocusRef}
    />
  );
}

import { type RefObject, useState } from 'react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { QuarantineImageButton } from '../media/quarantine-image-button.tsx';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
import {
  suspendUserDialogCopy,
  unsuspendUserDialogCopy,
  USER_ACTION_LABELS,
  userActionName,
} from '../shared/moderation-messages.ts';

export interface UserModerationActionsProps {
  readonly user: AdminModerationUserView;
  // 確定の後の取り直しで押した操作が別の操作に替わる・消えるため、閉じた後のフォーカスの移り先
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

type StatusOperation = 'user.suspend' | 'user.unsuspend';

const STATUS_ACTIONS = Object.freeze({
  'user.suspend': Object.freeze({
    kind: 'suspend',
    copyOf: suspendUserDialogCopy,
  }),
  'user.unsuspend': Object.freeze({
    kind: 'unsuspend',
    copyOf: unsuspendUserDialogCopy,
  }),
} as const);

// 利用中の利用者に停止、停止中の利用者に停止解除、公開中のプロフィール画像に隔離の操作を、モデレーター以上にだけ示す
export function UserModerationActions({
  user,
  returnFocusRef,
}: UserModerationActionsProps) {
  const statusOperation: StatusOperation =
    user.status === 'active' ? 'user.suspend' : 'user.unsuspend';
  // 閉じる間に取り直した状態で題名や操作が替わらないよう、開いた時の操作を保つ
  const [opened, setOpened] = useState<StatusOperation>(statusOperation);
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const { kind } = STATUS_ACTIONS[statusOperation];
  const copy = STATUS_ACTIONS[opened].copyOf(user.nickname);

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={userActionName(kind, user.nickname)}
        onClick={() => {
          setOpened(statusOperation);
          setCompleted(false);
          setOpen(true);
        }}
      >
        {USER_ACTION_LABELS[kind]}
      </Button>
      {user.avatar === null ? null : (
        <QuarantineImageButton
          file={user.avatar}
          accessibleName={userActionName('quarantineAvatar', user.nickname)}
          label={USER_ACTION_LABELS.quarantineAvatar}
          returnFocusRef={returnFocusRef}
        />
      )}
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation={opened}
        targetId={user.id}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        onCompleted={() => {
          setCompleted(true);
        }}
        {...(completed ? { returnFocusRef } : {})}
      />
    </RoleGate>
  );
}

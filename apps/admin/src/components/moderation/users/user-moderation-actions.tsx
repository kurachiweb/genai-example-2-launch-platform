import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { QuarantineImageButton } from '../media/quarantine-image-button.tsx';
import { useOpenModerationDialog } from '../shared/moderation-dialog-context.ts';
import {
  suspendUserDialogCopy,
  unsuspendUserDialogCopy,
  USER_ACTION_LABELS,
  userActionName,
} from '../shared/moderation-messages.ts';

export interface UserModerationActionsProps {
  readonly user: AdminModerationUserView;
}

const STATUS_ACTIONS = Object.freeze({
  active: Object.freeze({
    operation: 'user.suspend',
    kind: 'suspend',
    copyOf: suspendUserDialogCopy,
  }),
  suspended: Object.freeze({
    operation: 'user.unsuspend',
    kind: 'unsuspend',
    copyOf: unsuspendUserDialogCopy,
  }),
} as const);

// 利用中の利用者に停止、停止中の利用者に停止解除、公開中のプロフィール画像に隔離の操作を、モデレーター以上にだけ示す。確認は一覧の単位のダイアログで開く
export function UserModerationActions({ user }: UserModerationActionsProps) {
  const openDialog = useOpenModerationDialog();
  const { operation, kind, copyOf } = STATUS_ACTIONS[user.status];

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={userActionName(kind, user.nickname)}
        onClick={() => {
          openDialog({
            operation,
            targetId: user.id,
            copy: copyOf(user.nickname),
          });
        }}
      >
        {USER_ACTION_LABELS[kind]}
      </Button>
      {user.avatar === null ? null : (
        <QuarantineImageButton
          file={user.avatar}
          accessibleName={userActionName('quarantineAvatar', user.nickname)}
          label={USER_ACTION_LABELS.quarantineAvatar}
        />
      )}
    </RoleGate>
  );
}

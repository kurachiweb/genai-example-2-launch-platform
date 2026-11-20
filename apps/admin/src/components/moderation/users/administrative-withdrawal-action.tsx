import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { useOpenModerationDialog } from '../shared/moderation-dialog-context.ts';
import {
  USER_ACTION_LABELS,
  userActionName,
  withdrawUserDialogCopy,
} from '../shared/moderation-messages.ts';

export interface AdministrativeWithdrawalActionProps {
  readonly user: AdminModerationUserView;
}

// 対象の利用者・取り消せない旨・本人の意思の確かめと完了の知らせをシステムの外のメールで行う旨を示す確認を、確定で行ごと消えるため一覧の単位のダイアログで開く
export function AdministrativeWithdrawalAction({
  user,
}: AdministrativeWithdrawalActionProps) {
  const openDialog = useOpenModerationDialog();
  return (
    <RoleGate minimum="super_admin">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={userActionName('withdraw', user.nickname)}
        onClick={() => {
          openDialog({
            operation: 'user.administrative-withdraw',
            targetId: user.id,
            copy: withdrawUserDialogCopy({
              nickname: user.nickname,
              handle: user.handle,
              suspended: user.status === 'suspended',
            }),
          });
        }}
      >
        {USER_ACTION_LABELS.withdraw}
      </Button>
    </RoleGate>
  );
}

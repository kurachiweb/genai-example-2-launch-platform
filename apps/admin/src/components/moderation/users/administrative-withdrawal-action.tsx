import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import {
  USER_ACTION_LABELS,
  userActionName,
} from '../shared/moderation-messages.ts';

export interface AdministrativeWithdrawalActionProps {
  readonly user: AdminModerationUserView;
  readonly onOpen: (user: AdminModerationUserView) => void;
}

// 確定で行ごと消えるため、確認のダイアログは行の外(表の側)で開く
export function AdministrativeWithdrawalAction({
  user,
  onOpen,
}: AdministrativeWithdrawalActionProps) {
  return (
    <RoleGate minimum="super_admin">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={userActionName('withdraw', user.nickname)}
        onClick={() => {
          onOpen(user);
        }}
      >
        {USER_ACTION_LABELS.withdraw}
      </Button>
    </RoleGate>
  );
}

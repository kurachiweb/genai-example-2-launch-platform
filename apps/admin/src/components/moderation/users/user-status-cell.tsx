import type { AdminModerationUserView } from '../../../graphql/admin-moderation-users.ts';
import { ModerationNote } from '../shared/moderation-note.tsx';
import {
  SUSPENDED_AT_LABEL,
  USER_STATUS_LABELS,
} from '../shared/moderation-messages.ts';

export interface UserStatusCellProps {
  readonly user: Pick<
    AdminModerationUserView,
    'status' | 'suspendedAt' | 'latestSuspension'
  >;
}

// 停止中の利用者には、停止した日時と最新の停止の理由を添える
export function UserStatusCell({ user }: UserStatusCellProps) {
  if (user.status === 'active') {
    return <span>{USER_STATUS_LABELS.active}</span>;
  }
  return (
    <div className="flex min-w-48 flex-col gap-1">
      <span className="font-medium">{USER_STATUS_LABELS.suspended}</span>
      <ModerationNote
        dateLabel={SUSPENDED_AT_LABEL}
        occurredAt={user.suspendedAt}
        note={user.latestSuspension}
      />
    </div>
  );
}

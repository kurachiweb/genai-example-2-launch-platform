import { FlagIcon } from 'lucide-react';

import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import type { PublicProfileMenuItemProps } from '../profile/public-profile-section-types.ts';
import { REPORT_ACTION_LABELS } from './report-messages.ts';

// 停止中の利用者の公開プロフィールは本人にしか表示されないため、本人でなければ停止中かを見ずに描く
export function UserReportMenuItem({
  isOwner,
  onSelect,
}: PublicProfileMenuItemProps) {
  if (isOwner) {
    return null;
  }
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <FlagIcon aria-hidden="true" />
      {REPORT_ACTION_LABELS.user}
    </DropdownMenuItem>
  );
}

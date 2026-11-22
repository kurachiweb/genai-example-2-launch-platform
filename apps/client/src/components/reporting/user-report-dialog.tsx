import type { PublicProfileMenuDialogProps } from '../profile/public-profile-section-types.ts';
import { ReportDialog } from './report-dialog.tsx';

export function UserReportDialog({
  handle,
  open,
  onOpenChange,
  returnFocusRef,
}: PublicProfileMenuDialogProps) {
  return (
    <ReportDialog
      targetKind="user"
      targetRef={handle}
      open={open}
      onOpenChange={onOpenChange}
      returnFocusRef={returnFocusRef}
    />
  );
}

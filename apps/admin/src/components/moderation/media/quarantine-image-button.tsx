import { ShieldAlertIcon } from 'lucide-react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminMediaFileView } from '../../../graphql/admin-moderation-shared.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { useOpenModerationDialog } from '../shared/moderation-dialog-context.ts';
import {
  IMAGE_DIALOG_COPY,
  QUARANTINE_IMAGE_LABEL,
} from '../shared/moderation-messages.ts';

export interface QuarantineImageButtonProps {
  readonly file: AdminMediaFileView;
  // 見える名前「隔離」を含み、対象を示す名前(「ロゴを隔離」など)
  readonly accessibleName: string;
  // 見える名前。既定は「隔離」
  readonly label?: string;
}

// 公開中の画像を個別に隔離する操作。確認は一覧の単位のダイアログで開き、モデレーター以上にだけ示す
export function QuarantineImageButton({
  file,
  accessibleName,
  label = QUARANTINE_IMAGE_LABEL,
}: QuarantineImageButtonProps) {
  const openDialog = useOpenModerationDialog();

  if (file.quarantined) {
    return null;
  }
  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={accessibleName}
        onClick={() => {
          openDialog({
            operation: 'image.quarantine',
            targetId: file.id,
            copy: IMAGE_DIALOG_COPY['image.quarantine'],
          });
        }}
      >
        <ShieldAlertIcon aria-hidden="true" />
        {label}
      </Button>
    </RoleGate>
  );
}

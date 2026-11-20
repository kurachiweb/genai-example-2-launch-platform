import { ShieldAlertIcon } from 'lucide-react';
import { type RefObject, useState } from 'react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminMediaFileView } from '../../../graphql/admin-moderation-shared.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
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
  // 隔離の後に取り直した表示からボタンが消えるため、閉じた後のフォーカスの移り先
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

const COPY = IMAGE_DIALOG_COPY['image.quarantine'];

// 公開中の画像を個別に隔離する操作。モデレーター以上にだけ示す
export function QuarantineImageButton({
  file,
  accessibleName,
  label = QUARANTINE_IMAGE_LABEL,
  returnFocusRef,
}: QuarantineImageButtonProps) {
  const [open, setOpen] = useState(false);

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
          setOpen(true);
        }}
      >
        <ShieldAlertIcon aria-hidden="true" />
        {label}
      </Button>
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation="image.quarantine"
        targetId={file.id}
        title={COPY.title}
        description={COPY.description}
        confirmLabel={COPY.confirmLabel}
        {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
      />
    </RoleGate>
  );
}

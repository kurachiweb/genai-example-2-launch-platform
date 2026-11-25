import { Button } from '../../../../lib/components/ui/button/button.tsx';
import { RoleGate } from '../../layout/role-gate.tsx';
import { useOpenModerationDialog } from '../shared/moderation-dialog-context.ts';
import {
  IMAGE_ACTION_LABELS,
  IMAGE_DIALOG_COPY,
  imageActionName,
  type QuarantinedImageOperation,
} from '../shared/moderation-messages.ts';
import { quarantinedImageOperationsOf } from './quarantined-image-view.ts';
import type { AdminQuarantinedImageView } from '../../../graphql/admin-quarantined-images.ts';

export interface ImageModerationActionsProps {
  readonly image: AdminQuarantinedImageView;
  // 操作の名前に含める保有者と用途の表示名
  readonly ownerLabel: string;
  readonly purposeLabel: string;
}

const DESTRUCTIVE_OPERATIONS: ReadonlySet<QuarantinedImageOperation> = new Set([
  'image.reject',
  'image.delete',
]);

// 画像が持つ隔離理由に応じた操作を、モデレーター以上にだけ示す。確認は一覧の単位のダイアログで開く
export function ImageModerationActions({
  image,
  ownerLabel,
  purposeLabel,
}: ImageModerationActionsProps) {
  const openDialog = useOpenModerationDialog();
  const operations = quarantinedImageOperationsOf(image.file.quarantineReasons);

  if (operations.length === 0) {
    return null;
  }
  return (
    <RoleGate minimum="moderator">
      <div className="flex flex-wrap gap-2">
        {operations.map((operation) => (
          <Button
            key={operation}
            type="button"
            variant={
              DESTRUCTIVE_OPERATIONS.has(operation) ? 'destructive' : 'outline'
            }
            size="sm"
            aria-label={imageActionName(operation, ownerLabel, purposeLabel)}
            onClick={() => {
              openDialog({
                operation,
                targetId: image.file.id,
                copy: IMAGE_DIALOG_COPY[operation],
              });
            }}
          >
            {IMAGE_ACTION_LABELS[operation]}
          </Button>
        ))}
      </div>
    </RoleGate>
  );
}

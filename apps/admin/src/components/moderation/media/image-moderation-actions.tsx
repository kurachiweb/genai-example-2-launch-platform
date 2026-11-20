import { type RefObject, useState } from 'react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import { RoleGate } from '../../layout/role-gate.tsx';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
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
  // 確定の後の取り直しで項目や押した操作が消えるため、閉じた後のフォーカスの移り先
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

const DESTRUCTIVE_OPERATIONS: ReadonlySet<QuarantinedImageOperation> = new Set([
  'image.reject',
  'image.delete',
]);

// 画像が持つ隔離理由に応じた操作を、モデレーター以上にだけ示す
export function ImageModerationActions({
  image,
  ownerLabel,
  purposeLabel,
  returnFocusRef,
}: ImageModerationActionsProps) {
  const operations = quarantinedImageOperationsOf(image.file.quarantineReasons);
  // 閉じる間に取り直した状態で題名や操作が替わらないよう、開いた時の操作を保つ
  const [opened, setOpened] =
    useState<QuarantinedImageOperation>('image.delete');
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const copy = IMAGE_DIALOG_COPY[opened];

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
              setOpened(operation);
              setCompleted(false);
              setOpen(true);
            }}
          >
            {IMAGE_ACTION_LABELS[operation]}
          </Button>
        ))}
      </div>
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation={opened}
        targetId={image.file.id}
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

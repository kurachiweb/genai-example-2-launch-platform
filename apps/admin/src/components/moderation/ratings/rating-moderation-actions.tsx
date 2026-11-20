import { type RefObject, useState } from 'react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationRatingView } from '../../../graphql/admin-moderation-engagement.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
import {
  invalidateRatingDialogCopy,
  type ModerationDialogCopy,
  RATING_ACTION_LABELS,
  ratingActionName,
  revalidateRatingDialogCopy,
} from '../shared/moderation-messages.ts';
import type { ModerationOperation } from '../shared/moderation-operations.ts';

export interface RatingModerationActionsProps {
  readonly rating: Pick<AdminModerationRatingView, 'id' | 'state' | 'rater'>;
  // 確定の後の取り直しで評価が状態で絞った一覧から消える時の、閉じた後のフォーカスの移り先。無ければ押した操作へ戻す
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

type RatingActionKind = keyof typeof RATING_ACTION_LABELS;

const OPERATION_OF = Object.freeze({
  invalidate: 'rating.invalidate',
  revalidate: 'rating.revalidate',
} as const satisfies Record<RatingActionKind, ModerationOperation>);

const DIALOG_COPY_OF = Object.freeze({
  invalidate: invalidateRatingDialogCopy,
  revalidate: revalidateRatingDialogCopy,
} satisfies Record<
  RatingActionKind,
  (nickname: string | null) => ModerationDialogCopy
>);

// 有効な評価に無効化、無効化された評価に取り消しを示す。どちらも理由を必須とし、モデレーター以上にだけ示す
export function RatingModerationActions({
  rating,
  returnFocusRef,
}: RatingModerationActionsProps) {
  const nickname = rating.rater?.nickname ?? null;
  const kind: RatingActionKind =
    rating.state === 'valid' ? 'invalidate' : 'revalidate';
  const [open, setOpen] = useState(false);
  // 確定の後に取り直した状態で操作が替わっても、閉じる間は開いた時の確認を示し続ける
  const [openedKind, setOpenedKind] = useState<RatingActionKind>(kind);
  const [completed, setCompleted] = useState(false);
  const copy = DIALOG_COPY_OF[openedKind](nickname);

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={ratingActionName(kind, nickname)}
        onClick={() => {
          setOpenedKind(kind);
          setCompleted(false);
          setOpen(true);
        }}
      >
        {RATING_ACTION_LABELS[kind]}
      </Button>
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation={OPERATION_OF[openedKind]}
        targetId={rating.id}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        onCompleted={() => {
          setCompleted(true);
        }}
        {...(completed && returnFocusRef !== undefined
          ? { returnFocusRef }
          : {})}
      />
    </RoleGate>
  );
}

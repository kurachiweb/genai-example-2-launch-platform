import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationRatingView } from '../../../graphql/admin-moderation-engagement.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { useOpenModerationDialog } from '../shared/moderation-dialog-context.ts';
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

// 有効な評価に無効化、無効化された評価に取り消しを示す。どちらも理由を必須とし、モデレーター以上にだけ示す。確認は一覧の単位のダイアログで開く
export function RatingModerationActions({
  rating,
}: RatingModerationActionsProps) {
  const openDialog = useOpenModerationDialog();
  const nickname = rating.rater?.nickname ?? null;
  const kind: RatingActionKind =
    rating.state === 'valid' ? 'invalidate' : 'revalidate';

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={ratingActionName(kind, nickname)}
        onClick={() => {
          openDialog({
            operation: OPERATION_OF[kind],
            targetId: rating.id,
            copy: DIALOG_COPY_OF[kind](nickname),
          });
        }}
      >
        {RATING_ACTION_LABELS[kind]}
      </Button>
    </RoleGate>
  );
}

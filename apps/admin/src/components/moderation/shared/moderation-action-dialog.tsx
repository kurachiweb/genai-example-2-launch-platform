import type { ReactNode, RefObject } from 'react';

import { MODERATION_ACTION_DEFINITIONS } from '../../../../common-lib/moderation/moderation-actions.ts';
import { ConfirmActionDialog } from '../../../../lib/components/admin/confirm-action-dialog.tsx';
import { errorMessageOf } from '../../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import type { ModerationOutcomeView } from '../../../graphql/admin-moderation-shared.ts';
import {
  moderationActionOf,
  type ModerationOperation,
} from './moderation-operations.ts';
import { useModerationMutation } from './use-moderation-mutation.ts';

export interface ModerationActionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly operation: ModerationOperation;
  readonly targetId: string;
  readonly title: ReactNode;
  // 措置の影響は段落の中の文で示し、一覧の要素を渡さない
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly onCompleted?: (outcome: ModerationOutcomeView) => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

// 理由の要否は措置の定義に従い、監査ログに記録される旨を示して確定する。失敗はダイアログの中に示し、入力した理由を保つ
export function ModerationActionDialog({
  open,
  onOpenChange,
  operation,
  targetId,
  title,
  description,
  confirmLabel,
  onCompleted,
  returnFocusRef,
}: ModerationActionDialogProps) {
  const run = useModerationMutation(operation);
  const { reason } =
    MODERATION_ACTION_DEFINITIONS[moderationActionOf(operation)];

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      reason={reason}
      audited
      onConfirm={async (input) => {
        // 理由を任意とする措置の空の理由は、APIサーバーが理由なしとして記録する
        const outcome = await run({ targetId, reason: input.reason ?? '' });
        onCompleted?.(outcome);
      }}
      failureMessageOf={failureMessageOf}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
    />
  );
}

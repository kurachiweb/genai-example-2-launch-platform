import { type ReactNode, type RefObject, useEffect, useRef } from 'react';

import { MODERATION_ACTION_DEFINITIONS } from '../../../../common-lib/moderation/moderation-actions.ts';
import { ConfirmActionDialog } from '../../../../lib/components/admin/confirm-action-dialog.tsx';
import { errorMessageOf } from '../../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import type { ModerationOutcomeView } from '../../../graphql/admin-moderation-shared.ts';
import {
  moderationActionOf,
  type ModerationOperation,
} from './moderation-operations.ts';
import {
  isTargetMissing,
  useModerationMutation,
} from './use-moderation-mutation.ts';

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
  // 対象の不在で失敗した時。開いた元の操作が取り直しで消えるため、閉じた後のフォーカスの移り先を替える
  readonly onTargetMissing?: () => void;
  // 取り直しで対象が消えるとダイアログごと画面が替わる場所(詳細のページ)では、不在の失敗の取り直しを閉じるまで遅らせ、文言と理由を示し続ける
  readonly deferTargetMissingRefresh?: boolean;
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
  onTargetMissing,
  deferTargetMissingRefresh = false,
  returnFocusRef,
}: ModerationActionDialogProps) {
  const { run, refreshAffected } = useModerationMutation(operation, {
    deferTargetMissingRefresh,
  });
  const refreshOnCloseRef = useRef(false);
  // 開いたまま画面を離れるなど、閉じずに外れた時も遅らせた取り直しを行う
  useEffect(
    () => () => {
      if (refreshOnCloseRef.current) {
        refreshOnCloseRef.current = false;
        void refreshAffected();
      }
    },
    [refreshAffected],
  );
  const { reason } =
    MODERATION_ACTION_DEFINITIONS[moderationActionOf(operation)];

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && refreshOnCloseRef.current) {
          refreshOnCloseRef.current = false;
          void refreshAffected();
        }
        onOpenChange(next);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      reason={reason}
      audited
      onConfirm={async (input) => {
        try {
          // 理由を任意とする措置の空の理由は、APIサーバーが理由なしとして記録する
          const outcome = await run({ targetId, reason: input.reason ?? '' });
          onCompleted?.(outcome);
        } catch (error) {
          if (isTargetMissing(error)) {
            refreshOnCloseRef.current = deferTargetMissingRefresh;
            onTargetMissing?.();
          }
          throw error;
        }
      }}
      failureMessageOf={failureMessageOf}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
    />
  );
}

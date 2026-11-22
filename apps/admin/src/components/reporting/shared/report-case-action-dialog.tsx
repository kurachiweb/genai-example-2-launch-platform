import { type RefObject, useCallback, useEffect, useRef } from 'react';

import type { ReportTargetKind } from '../../../../common-lib/reporting/report-rules.ts';
import { ConfirmActionDialog } from '../../../../lib/components/admin/confirm-action-dialog.tsx';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import type { ReportCaseClosingOperation } from '../../../graphql/admin-reporting-cases.ts';
import {
  type ReportCaseDialogCopy,
  reportCaseActionLabel,
} from './report-messages.ts';
import {
  isReportCaseRefreshFailure,
  useReportCaseMutation,
} from './use-report-case-mutation.ts';

export interface ReportCaseActionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly operation: ReportCaseClosingOperation;
  readonly caseId: string;
  readonly targetKind: ReportTargetKind;
  // 措置の影響・通知・理由の注記は段落の中の文で示し、一覧の要素を渡さない
  readonly copy: ReportCaseDialogCopy;
  readonly onCompleted?: () => void;
  // 措置済みの失敗の後に、措置なしの対応済の確認へ切り替える
  readonly onSwitchOperation?: (operation: ReportCaseClosingOperation) => void;
  // 取り直しで確認の前提や画面ごとが替わる場所(詳細のページ)では、失敗の後の取り直しを閉じるまで遅らせ、文言と理由を示し続ける
  readonly deferRefresh?: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

const MEASURE_ALREADY_APPLIED = 'report_measure_already_applied';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const isMeasureAlreadyApplied = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.code === MEASURE_ALREADY_APPLIED;

// 措置・措置なしの対応済・却下は理由を必須とし、監査ログに記録される旨を示して確定する。失敗はダイアログの中に示し、入力した理由を保つ
export function ReportCaseActionDialog({
  open,
  onOpenChange,
  operation,
  caseId,
  targetKind,
  copy,
  onCompleted,
  onSwitchOperation,
  deferRefresh = false,
  returnFocusRef,
}: ReportCaseActionDialogProps) {
  const { run, refreshAfter } = useReportCaseMutation(operation, {
    targetKind,
    deferRefresh,
  });
  // 取り直しを遅らせた失敗。閉じた時と、閉じずに外れた時に取り直す
  const deferredFailureRef = useRef<unknown>(undefined);
  const refreshDeferred = useCallback((): void => {
    const failure = deferredFailureRef.current;
    deferredFailureRef.current = undefined;
    if (failure !== undefined) {
      void refreshAfter(failure);
    }
  }, [refreshAfter]);
  useEffect(() => refreshDeferred, [refreshDeferred]);

  const failureActionOf = (error: unknown) =>
    operation === 'resolve-with-measure' &&
    onSwitchOperation !== undefined &&
    isMeasureAlreadyApplied(error) ? (
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          onSwitchOperation('resolve-without-measure');
        }}
      >
        {reportCaseActionLabel('resolve-without-measure', targetKind)}
      </Button>
    ) : null;

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          refreshDeferred();
        }
        onOpenChange(next);
      }}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      reason="required"
      audited
      onConfirm={async (input) => {
        try {
          await run({ caseId, reason: input.reason ?? '' });
          onCompleted?.();
        } catch (error) {
          if (deferRefresh && isReportCaseRefreshFailure(error)) {
            deferredFailureRef.current = error;
          }
          throw error;
        }
      }}
      failureMessageOf={failureMessageOf}
      failureActionOf={failureActionOf}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
    />
  );
}

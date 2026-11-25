import { useId, useRef, useState } from 'react';

import {
  manualStatusChangeKind,
  REPORT_CASE_STATUSES,
  type ReportCaseStatus,
} from '../../../../common-lib/reporting/report-case-rules.ts';
import { REPORT_CASE_STATUS_LABELS } from '../../../../common-lib/reporting/report-labels.ts';
import type { ReportTargetKind } from '../../../../common-lib/reporting/report-rules.ts';
import { ConfirmActionDialog } from '../../../../lib/components/admin/confirm-action-dialog.tsx';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import { Label } from '../../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../../lib/components/ui/select/select-value.tsx';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import { useReportCaseMutation } from '../shared/use-report-case-mutation.ts';
import {
  REPORT_STATUS_CHANGE_COPY,
  reportStatusChangeDescription,
  reportStatusChangeTitle,
} from './report-case-messages.ts';
import { useDeferredReportCaseRefresh } from '../shared/use-deferred-report-case-refresh.ts';

export interface ReportCaseStatusControlProps {
  readonly caseId: string;
  readonly status: ReportCaseStatus;
  readonly targetKind: ReportTargetKind;
}

interface StatusChange {
  readonly from: ReportCaseStatus;
  readonly to: ReportCaseStatus;
}

const VALIDATION_ERROR_CODE = 'validation_error';

const STATUS_FIELD = 'status';

// 確認のダイアログは状態の欄を持たないため、他の管理者が先に同じ状態へ変えた時の拒否は、共通の文言ではなく欄の詳細の文言で示す
const failureMessageOf = (error: unknown): string => {
  if (
    error instanceof GraphQLClientError &&
    error.code === VALIDATION_ERROR_CODE
  ) {
    const detail = error.details?.find(({ field }) => field === STATUS_FIELD);
    if (detail !== undefined) {
      return detail.message;
    }
  }
  return errorMessageOf(error, ADMIN_PROFILE.contactAvailable);
};

const isReportCaseStatus = (value: string): value is ReportCaseStatus =>
  (REPORT_CASE_STATUSES as readonly string[]).includes(value);

// 完了した案件を含めて、現在と異なる3つの状態から選んで手で変更する。理由は未対応⇄対応中で任意、完了への変更と完了からの再開で必須とし、通知しない旨を確認に示す
export function ReportCaseStatusControl({
  caseId,
  status,
  targetKind,
}: ReportCaseStatusControlProps) {
  const headingId = useId();
  const selectId = useId();
  const options = REPORT_CASE_STATUSES.filter((value) => value !== status);
  // 選ぶまでと、取り直しで現在の状態が選んだ状態になった後は、最初の選択肢を示す
  const [selected, setSelected] = useState<ReportCaseStatus>();
  const nextStatus =
    selected !== undefined && selected !== status
      ? selected
      : (options[0] ?? status);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 確定の後に取り直した状態で題名や理由の要否が替わらないよう、開いた時の変更を持つ
  const [opened, setOpened] = useState<StatusChange>({
    from: status,
    to: nextStatus,
  });
  // 変更の後も残り、続けて選び直せる選択欄へ閉じた後のフォーカスを戻す
  const selectRef = useRef<HTMLButtonElement>(null);
  const { run, refreshAfter } = useReportCaseMutation('change-status', {
    targetKind,
    deferRefresh: true,
  });
  const deferred = useDeferredReportCaseRefresh(refreshAfter);
  const kind = manualStatusChangeKind(opened.from, opened.to);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="font-bold">
        {REPORT_STATUS_CHANGE_COPY.heading}
      </h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-44 flex-col gap-2">
          <Label htmlFor={selectId}>
            {REPORT_STATUS_CHANGE_COPY.nextStatus}
          </Label>
          <Select
            value={nextStatus}
            onValueChange={(value) => {
              if (isReportCaseStatus(value)) {
                setSelected(value);
              }
            }}
          >
            <SelectTrigger ref={selectRef} id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((value) => (
                <SelectItem key={value} value={value}>
                  {REPORT_CASE_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOpened({ from: status, to: nextStatus });
            setConfirmOpen(true);
          }}
        >
          {REPORT_STATUS_CHANGE_COPY.submit}
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next) {
            deferred.flush();
          }
          setConfirmOpen(next);
        }}
        title={reportStatusChangeTitle(REPORT_CASE_STATUS_LABELS[opened.to])}
        description={reportStatusChangeDescription(kind)}
        confirmLabel={REPORT_STATUS_CHANGE_COPY.confirm}
        reason={kind === 'progress' ? 'optional' : 'required'}
        audited
        onConfirm={async ({ reason }) => {
          try {
            await run({ caseId, from: opened.from, to: opened.to, reason });
          } catch (error) {
            deferred.defer(error);
            throw error;
          }
          setSelected(undefined);
        }}
        failureMessageOf={failureMessageOf}
        returnFocusRef={selectRef}
      />
    </section>
  );
}

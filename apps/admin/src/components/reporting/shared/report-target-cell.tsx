import { Link } from '@tanstack/react-router';

import { REPORT_TARGET_KIND_LABELS } from '../../../../common-lib/reporting/report-labels.ts';
import type { ReportTargetView } from '../../../graphql/admin-reporting-cases.ts';
import { reportTargetLabelOf } from './report-messages.ts';

export interface ReportTargetCellProps {
  readonly target: ReportTargetView;
  // 一覧の行では、対象の表示を案件の詳細への導線にする
  readonly detailCaseId?: string;
}

// 対象の種類と表示を示す。コメントの抜粋は利用者の入力のため、マークダウンやHTMLとして解釈せず改行を保った文字列で示す
export function ReportTargetCell({
  target,
  detailCaseId,
}: ReportTargetCellProps) {
  const excerpt =
    target.kind === 'comment' && target.available ? target.excerpt : null;
  const label = reportTargetLabelOf(target);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {REPORT_TARGET_KIND_LABELS[target.kind]}
      </span>
      {detailCaseId === undefined ? (
        <span className="font-medium break-words">{label}</span>
      ) : (
        <Link
          to="/reports/$caseId"
          params={{ caseId: detailCaseId }}
          className="self-start font-medium break-words text-foreground underline underline-offset-4"
        >
          {label}
        </Link>
      )}
      {excerpt === null || excerpt === '' ? null : (
        <p className="text-sm break-words whitespace-pre-wrap">{excerpt}</p>
      )}
    </div>
  );
}

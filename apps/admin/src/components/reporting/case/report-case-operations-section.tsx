import type { Ref } from 'react';

import type { ReportCaseView } from '../../../graphql/admin-reporting-cases.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { ReportCaseActions } from '../shared/report-case-actions.tsx';
import { REPORT_CASE_DETAIL_COPY } from './report-case-messages.ts';
import { ReportCaseSection } from './report-case-section.tsx';
import { ReportCaseStatusControl } from './report-case-status-control.tsx';

export interface ReportCaseOperationsSectionProps {
  readonly reportCase: Pick<ReportCaseView, 'id' | 'status' | 'target'>;
  // 確定の後と取り直す失敗の後に、消える操作の代わりのフォーカスの移り先にする見出し
  readonly headingRef: Ref<HTMLHeadingElement>;
}

// モデレーター以上の管理者にだけ、未完了の案件の措置・措置なしの対応済・却下と、対応ステータスの変更を置く
export function ReportCaseOperationsSection({
  reportCase,
  headingRef,
}: ReportCaseOperationsSectionProps) {
  return (
    <RoleGate minimum="moderator">
      <ReportCaseSection
        title={REPORT_CASE_DETAIL_COPY.sections.operations}
        headingRef={headingRef}
      >
        <ReportCaseActions reportCase={reportCase} />
        <ReportCaseStatusControl
          caseId={reportCase.id}
          status={reportCase.status}
          targetKind={reportCase.target.kind}
        />
      </ReportCaseSection>
    </RoleGate>
  );
}

import { isClosedStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type {
  ReportCaseClosingOperation,
  ReportCaseView,
} from '../../../graphql/admin-reporting-cases.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { useOpenReportCaseDialog } from './report-case-dialog-context.ts';
import {
  reportCaseActionLabel,
  reportCaseActionName,
} from './report-messages.ts';

export interface ReportCaseActionsProps {
  readonly reportCase: Pick<ReportCaseView, 'id' | 'status' | 'target'>;
}

const ALL_OPERATIONS: readonly ReportCaseClosingOperation[] = Object.freeze([
  'resolve-with-measure',
  'resolve-without-measure',
  'reject',
]);

// 読めない対象と対象への参照を消した案件はAPIが措置を拒否するため、措置なしの対応済と却下だけを示す
const WITHOUT_MEASURE_OPERATIONS: readonly ReportCaseClosingOperation[] =
  Object.freeze(['resolve-without-measure', 'reject']);

// 未対応・対応中の案件に、措置・措置なしの対応済・却下をモデレーター以上にだけ示す。確認は一覧の単位のダイアログで開く
export function ReportCaseActions({ reportCase }: ReportCaseActionsProps) {
  const openDialog = useOpenReportCaseDialog();
  const { id, status, target } = reportCase;
  if (isClosedStatus(status)) {
    return null;
  }
  const operations = target.available
    ? ALL_OPERATIONS
    : WITHOUT_MEASURE_OPERATIONS;

  return (
    <RoleGate minimum="moderator">
      <div className="flex flex-wrap gap-2">
        {operations.map((operation) => (
          <Button
            key={operation}
            type="button"
            variant="outline"
            size="sm"
            aria-label={reportCaseActionName(operation, target)}
            onClick={(event) => {
              openDialog({
                operation,
                caseId: id,
                target,
                opener: event.currentTarget,
              });
            }}
          >
            {reportCaseActionLabel(operation, target.kind)}
          </Button>
        ))}
      </div>
    </RoleGate>
  );
}

import { createContext, use } from 'react';

import type {
  ReportCaseClosingOperation,
  ReportTargetView,
} from '../../../graphql/admin-reporting-cases.ts';

export interface ReportCaseDialogRequest {
  readonly operation: ReportCaseClosingOperation;
  readonly caseId: string;
  // 確認の文言と措置の影響する照会を対象から決める
  readonly target: ReportTargetView;
  // 確認のダイアログを開いた起点のボタン。失敗の後に残っていればフォーカスを戻す
  readonly opener: HTMLElement | null;
}

export type OpenReportCaseDialog = (request: ReportCaseDialogRequest) => void;

export const ReportCaseDialogContext =
  createContext<OpenReportCaseDialog | null>(null);

export function useOpenReportCaseDialog(): OpenReportCaseDialog {
  const open = use(ReportCaseDialogContext);
  if (open === null) {
    throw new Error(
      '案件の操作は一覧の単位の確認のダイアログ(ReportCaseDialogHost)の内側に置いてください。',
    );
  }
  return open;
}

import { type ReactNode, type RefObject, useRef, useState } from 'react';

import type { ReportCaseClosingOperation } from '../../../graphql/admin-reporting-cases.ts';
import { ReportCaseActionDialog } from './report-case-action-dialog.tsx';
import {
  ReportCaseDialogContext,
  type ReportCaseDialogRequest,
} from './report-case-dialog-context.ts';
import {
  type ReportCaseDialogCopy,
  reportCaseDialogCopyOf,
} from './report-messages.ts';

export interface ReportCaseDialogHostProps {
  // 確定した後と、起点のボタンが取り直しで消えた後の、閉じた後のフォーカスの移り先(一覧の見出しなど)
  readonly fallbackFocusRef: RefObject<HTMLElement | null>;
  // 詳細のページのように、取り直しで確認の前提や画面ごとが替わる場所では、失敗の後の取り直しを閉じるまで遅らせる
  readonly deferRefresh?: boolean;
  readonly children: ReactNode;
}

interface OpenedRequest extends ReportCaseDialogRequest {
  // 閉じる間に取り直した状態で題名や操作が替わらないよう、開いた時の文言を持つ
  readonly copy: ReportCaseDialogCopy;
}

interface HostState {
  readonly open: boolean;
  // 閉じる動きの間も題名を保つため、閉じても案件を残す
  readonly request: OpenedRequest | undefined;
  // 閉じる動きの最中や切り替えで別の操作を開くと前の入力が残るため、開くたびに数を変えて作り直す
  readonly session: number;
}

const CLOSED: HostState = Object.freeze({
  open: false,
  request: undefined,
  session: 0,
});

const openedOf = (request: ReportCaseDialogRequest): OpenedRequest => ({
  ...request,
  copy: reportCaseDialogCopyOf(request.operation, request.target),
});

// 確定や取り直す失敗で一覧を取り直すと開いた元の行が消えるため、確認のダイアログを行の外の一覧の単位に1つ置き、行の操作は文脈から開く
export function ReportCaseDialogHost({
  fallbackFocusRef,
  deferRefresh = false,
  children,
}: ReportCaseDialogHostProps) {
  const [state, setState] = useState<HostState>(CLOSED);
  const completedRef = useRef(false);
  // 閉じる時に決める閉じた後のフォーカスの移り先
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const show = (request: OpenedRequest): void => {
    completedRef.current = false;
    returnFocusRef.current = null;
    setState((current) => ({
      open: true,
      request,
      session: current.session + 1,
    }));
  };

  const open = (request: ReportCaseDialogRequest): void => {
    show(openedOf(request));
  };

  const switchOperation = (operation: ReportCaseClosingOperation): void => {
    if (state.request !== undefined) {
      show(openedOf({ ...state.request, operation }));
    }
  };

  // 確定すると起点の操作は替わる・消えるため一覧の見出しへ移し、失敗と取り消しでは起点が残っていればそこへ戻す
  const close = (): void => {
    const opener = state.request?.opener ?? null;
    const openerRemains = opener?.isConnected ?? false;
    returnFocusRef.current =
      completedRef.current || !openerRemains
        ? fallbackFocusRef.current
        : opener;
    setState((current) => ({ ...current, open: false }));
  };

  const { request } = state;
  return (
    <ReportCaseDialogContext value={open}>
      {children}
      {request === undefined ? null : (
        <ReportCaseActionDialog
          key={state.session}
          open={state.open}
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          operation={request.operation}
          caseId={request.caseId}
          targetKind={request.target.kind}
          copy={request.copy}
          onCompleted={() => {
            completedRef.current = true;
          }}
          onSwitchOperation={switchOperation}
          deferRefresh={deferRefresh}
          returnFocusRef={returnFocusRef}
        />
      )}
    </ReportCaseDialogContext>
  );
}

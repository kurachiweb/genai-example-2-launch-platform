import { type ReactNode, type RefObject, useRef, useState } from 'react';

import {
  ModerationDialogContext,
  type ModerationDialogRequest,
} from './moderation-dialog-context.ts';
import { ModerationActionDialog } from './moderation-action-dialog.tsx';

export interface ModerationDialogHostProps {
  // 措置を確定した後と、開いた元の操作が取り直しで消えた後の、閉じた後のフォーカスの移り先(一覧の見出しなど)
  readonly fallbackFocusRef: RefObject<HTMLElement | null>;
  // 詳細のページの区画のように、取り直しで対象が消えると画面ごと替わる場所では、不在の失敗の取り直しを閉じるまで遅らせる
  readonly deferTargetMissingRefresh?: boolean;
  readonly children: ReactNode;
}

interface HostState {
  readonly open: boolean;
  // 閉じる動きの間も題名を保つため、閉じても対象を残す
  readonly request: ModerationDialogRequest | undefined;
  // 閉じる動きの最中に別の対象で開き直すと前の入力が残るため、開くたびに数を変えて作り直す
  readonly session: number;
}

const CLOSED: HostState = Object.freeze({
  open: false,
  request: undefined,
  session: 0,
});

// 確定や対象の不在の失敗で一覧を取り直すと開いた元の行が消えるため、確認のダイアログを行の外の一覧の単位に1つ置き、行の操作は文脈から開く
export function ModerationDialogHost({
  fallbackFocusRef,
  deferTargetMissingRefresh = false,
  children,
}: ModerationDialogHostProps) {
  const [state, setState] = useState<HostState>(CLOSED);
  const openerRef = useRef<HTMLElement | null>(null);
  const completedRef = useRef(false);
  const targetMissingRef = useRef(false);
  // nullなら確認のダイアログが開いた元の要素へ戻す
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const open = (request: ModerationDialogRequest): void => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    completedRef.current = false;
    targetMissingRef.current = false;
    returnFocusRef.current = null;
    setState((current) => ({
      open: true,
      request,
      session: current.session + 1,
    }));
  };

  const close = (): void => {
    const openerRemains = openerRef.current?.isConnected ?? false;
    returnFocusRef.current =
      completedRef.current || targetMissingRef.current || !openerRemains
        ? fallbackFocusRef.current
        : null;
    setState((current) => ({ ...current, open: false }));
  };

  const { request } = state;
  return (
    <ModerationDialogContext value={open}>
      {children}
      {request === undefined ? null : (
        <ModerationActionDialog
          key={state.session}
          open={state.open}
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          operation={request.operation}
          targetId={request.targetId}
          title={request.copy.title}
          description={request.copy.description}
          confirmLabel={request.copy.confirmLabel}
          onCompleted={() => {
            completedRef.current = true;
          }}
          onTargetMissing={() => {
            targetMissingRef.current = true;
          }}
          deferTargetMissingRefresh={deferTargetMissingRefresh}
          returnFocusRef={returnFocusRef}
        />
      )}
    </ModerationDialogContext>
  );
}

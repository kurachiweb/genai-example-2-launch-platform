import { type RefObject, useEffect, useEffectEvent, useRef } from 'react';

import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { MarkdownEditorFocusTarget } from '../../../lib/components/markdown-editor/markdown-editor.tsx';

// 破棄・公開・読み込み直しの後に、続けて操作する場所へフォーカスを移す要求。要求ごとに新しいオブジェクトを作る
export interface LegalFormFocusRequest {
  // 操作の前に表示していた状態の版。結果の反映はTanStack Queryの通知で後から描かれるため、表示がこの版から変わるまで待つ
  readonly fromStateVersion: number;
}

interface FocusAfterChangeOptions {
  // 呼び出す側の要求と、部品の中の操作(破棄)の要求
  readonly request: LegalFormFocusRequest | undefined;
  readonly ownRequest: LegalFormFocusRequest | undefined;
  readonly stateVersion: number;
  readonly initialBody: string;
  readonly isValid: boolean;
  readonly saveButtonRef: RefObject<HTMLButtonElement | null>;
  readonly editorRef: RefObject<MarkdownEditorFocusTarget | null>;
  // 閉じた後に戻す先を確認のダイアログへ伝える
  readonly onTarget: (target: HTMLElement | null) => void;
}

// 初期値の本文が空なら保存のボタンは押せないため本文の欄へ移す。本文があれば、初期値を入れ替えた後の検証で保存のボタンが押せるようになってから移す
export function useFocusAfterChange({
  request,
  ownRequest,
  stateVersion,
  initialBody,
  isValid,
  saveButtonRef,
  editorRef,
  onTarget,
}: FocusAfterChangeOptions): void {
  const handledRef = useRef(new WeakSet<LegalFormFocusRequest>());
  const onTargetEvent = useEffectEvent(onTarget);
  const blank = trimWhiteSpace(initialBody) === '';

  useEffect(() => {
    const pending = [request, ownRequest].find(
      (candidate) =>
        candidate !== undefined &&
        !handledRef.current.has(candidate) &&
        candidate.fromStateVersion !== stateVersion,
    );
    if (pending === undefined || (!blank && !isValid)) {
      return;
    }
    handledRef.current.add(pending);
    if (blank) {
      onTargetEvent(null);
      editorRef.current?.focus();
      return;
    }
    onTargetEvent(saveButtonRef.current);
    saveButtonRef.current?.focus();
  }, [
    request,
    ownRequest,
    stateVersion,
    blank,
    isValid,
    saveButtonRef,
    editorRef,
  ]);
}

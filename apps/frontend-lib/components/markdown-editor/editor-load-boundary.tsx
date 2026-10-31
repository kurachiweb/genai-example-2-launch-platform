import { CatchBoundary } from '@tanstack/react-router';
import { type ReactNode, Suspense, useState } from 'react';

import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import { EditorLoadError } from './editor-load-error.ts';
import {
  type EditorSurfaceComponent,
  loadCrepeEditor,
} from './load-crepe-editor.ts';

export interface EditorLoadBoundaryProps {
  readonly loading: ReactNode;
  // 読み込みか描画に失敗した時に呼ぶ。読み込んだ編集領域から受け取った値を手放させる
  readonly onFailure: () => void;
  readonly renderFailed: (retry: () => void) => ReactNode;
  readonly children: (Surface: EditorSurfaceComponent) => ReactNode;
}

interface LoadAttempt {
  readonly key: number;
  readonly Surface: EditorSurfaceComponent;
  readonly failed: boolean;
}

// 失敗した読み込みは同じ結果を返し続けるため、再試行のたびに新しい遅延読み込みの部品を作る
const startAttempt = (key: number): LoadAttempt => ({
  key,
  Surface: loadCrepeEditor(),
  failed: false,
});

function CaughtFailure() {
  return null;
}

export function EditorLoadBoundary({
  loading,
  onFailure,
  renderFailed,
  children,
}: EditorLoadBoundaryProps) {
  const [attempt, setAttempt] = useState(() => startAttempt(0));

  if (attempt.failed) {
    return renderFailed(() => {
      setAttempt((current) => startAttempt(current.key + 1));
    });
  }

  return (
    <CatchBoundary
      key={attempt.key}
      getResetKey={() => attempt.key}
      errorComponent={CaughtFailure}
      onCatch={(error) => {
        // 編集中の描画の失敗は編集領域の外へ伝えず、想定外の失敗として報告する。チャンクの読み込みの失敗は再試行で回復するため報告しない
        if (!(error instanceof EditorLoadError)) {
          reportUnexpectedErrorInBrowser(error, 'render');
        }
        onFailure();
        setAttempt((current) =>
          current.key === attempt.key ? { ...current, failed: true } : current,
        );
      }}
    >
      <Suspense fallback={loading}>{children(attempt.Surface)}</Suspense>
    </CatchBoundary>
  );
}

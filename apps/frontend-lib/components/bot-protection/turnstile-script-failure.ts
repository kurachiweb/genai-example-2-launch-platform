// ライブラリは失敗したスクリプトの要素を文書に残し、2つ目以降のウィジェットへ読み込みの失敗を知らせないため、ページの中で1つの記録としてすべてのウィジェットへ共有する。記録はページの再読み込みまで残す
const listeners = new Set<() => void>();
let failed = false;

const notifyAll = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export function recordTurnstileScriptFailure(): void {
  if (failed) {
    return;
  }
  failed = true;
  notifyAll();
}

export function hasTurnstileScriptFailed(): boolean {
  return failed;
}

export function subscribeTurnstileScriptFailure(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetTurnstileScriptFailure(): void {
  if (!failed) {
    return;
  }
  failed = false;
  notifyAll();
}

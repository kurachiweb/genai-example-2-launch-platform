import { useBlocker } from '@tanstack/react-router';

export interface UnsavedChangesGuard {
  readonly confirmOpen: boolean;
  readonly proceed: () => void;
  readonly stay: () => void;
}

// 画面内の遷移は確認のダイアログで、再読み込みやタブを閉じる操作はブラウザの確認で、保存していない変更がある間だけ止める
export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  return {
    confirmOpen: blocker.status === 'blocked',
    proceed: () => {
      blocker.proceed?.();
    },
    stay: () => {
      blocker.reset?.();
    },
  };
}

export const PRELOAD_ERROR_EVENT = 'vite:preloadError';

export const PRELOAD_RECOVERY_STORAGE_KEY = 'ls-preload-reloaded';

export interface PreloadRecoveryInput {
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  readonly reload: () => void;
}

// 印を保存できない環境で再読み込みすると、新しい版でも失敗が続いた時に再読み込みを繰り返すため、印の読み書きに成功した時だけ再読み込みする
const markReloadOnce = (
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
): boolean => {
  if (storage === undefined) {
    return false;
  }
  try {
    if (storage.getItem(PRELOAD_RECOVERY_STORAGE_KEY) !== null) {
      return false;
    }
    storage.setItem(PRELOAD_RECOVERY_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
};

export const installPreloadRecovery = ({
  target,
  storage,
  reload,
}: PreloadRecoveryInput): (() => void) => {
  // 遅延読み込みの失敗を自分で扱う読み込み(入力欄の編集領域など)は既定の動作を止め、再読み込みで同じページの未保存の値を失わせない。windowへの通知は聞き手を加えた順に呼ばれ、捕捉の段階の聞き手も先に呼ばれるとは限らないため、通知の全ての聞き手が終わってから判定する
  const onPreloadError = (event: Event): void => {
    queueMicrotask(() => {
      if (event.defaultPrevented) {
        return;
      }
      if (markReloadOnce(storage)) {
        reload();
      }
    });
  };
  target.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  return () => {
    target.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  };
};

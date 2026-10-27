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
  const onPreloadError = (): void => {
    if (markReloadOnce(storage)) {
      reload();
    }
  };
  target.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  return () => {
    target.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
  };
};

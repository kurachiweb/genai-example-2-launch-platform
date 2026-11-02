import { vi } from 'vitest';

// 画像の読み込みを止め、返した関数を呼ぶまで読み込みの途中の状態を保つ。後始末はvi.unstubAllGlobals()で行う
export function holdImageDecoding(): () => void {
  const decode = globalThis.createImageBitmap.bind(globalThis);
  const { promise, resolve } = Promise.withResolvers<undefined>();
  vi.stubGlobal(
    'createImageBitmap',
    async (...args: Parameters<typeof decode>): Promise<ImageBitmap> => {
      await promise;
      return decode(...args);
    },
  );
  return () => {
    resolve(undefined);
  };
}

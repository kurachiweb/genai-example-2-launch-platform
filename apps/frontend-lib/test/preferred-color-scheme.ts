import { cdp } from 'vitest/browser';

export type PreferredColorScheme = 'light' | 'dark';

// 空の値を送ると上書きをやめ、実行環境のOSの配色の設定に戻る
export async function emulatePreferredColorScheme(
  value: PreferredColorScheme | null,
): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: value ?? '' }],
  });
}

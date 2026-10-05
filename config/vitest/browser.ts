import {
  createTestKindPreset,
  type TestKindPreset,
} from './test-kind-preset.ts';

export interface BrowserLaunchOptions {
  readonly executablePath?: string;
}

export const browserTestPreset: TestKindPreset = createTestKindPreset(
  'browser',
  'v8',
);

// 共有Chromiumが無い環境では、Playwrightが導入済みのブラウザを使う
export function resolveBrowserLaunchOptions(
  env: Readonly<Record<string, string | undefined>>,
): BrowserLaunchOptions {
  const executablePath = env.CHROMIUM_PATH;
  return executablePath ? { executablePath } : {};
}

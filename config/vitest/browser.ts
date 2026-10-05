import {
  createTestKindPreset,
  type TestKindPreset,
} from './test-kind-preset.ts';

export interface BrowserLaunchOptions {
  readonly executablePath?: string;
}

export interface ReferenceScreenshotPathData {
  readonly arg: string;
  readonly ext: string;
  readonly browserName: string;
  readonly platform: string;
  readonly root: string;
  readonly testFileDirectory: string;
  readonly testFileName: string;
}

export interface BrowserOptionsPreset {
  readonly screenshotDirectory: string;
  readonly expect: {
    readonly toMatchScreenshot: {
      readonly resolveScreenshotPath: (
        data: ReferenceScreenshotPathData,
      ) => string;
    };
  };
}

export const browserTestPreset: TestKindPreset = createTestKindPreset(
  'browser',
  'v8',
);

const REFERENCE_SCREENSHOT_DIRECTORY = '__screenshots__';

// Vitest 4.1.11はscreenshotDirectoryを指定すると基準画像の既定の保存先も変わり、テストのディレクトリの下へ絶対パスを連結した場所になる。
// 基準画像はコミットするため、既定と同じ並びでテストファイルの隣の__screenshots__に固定する
function resolveReferenceScreenshotPath({
  arg,
  ext,
  browserName,
  platform,
  root,
  testFileDirectory,
  testFileName,
}: ReferenceScreenshotPathData): string {
  return [
    root,
    testFileDirectory,
    REFERENCE_SCREENSHOT_DIRECTORY,
    testFileName,
    `${arg}-${browserName}-${platform}${ext}`,
  ]
    .filter((segment) => segment !== '')
    .join('/');
}

// 失敗時のスクリーンショットはテスト成果物としてGit管理外の出力先へ出す
export const browserOptionsPreset: BrowserOptionsPreset = {
  screenshotDirectory: `${browserTestPreset.attachmentsDir}/screenshots`,
  expect: {
    toMatchScreenshot: {
      resolveScreenshotPath: resolveReferenceScreenshotPath,
    },
  },
};

// 共有Chromiumが無い環境では、Playwrightが導入済みのブラウザを使う
export function resolveBrowserLaunchOptions(
  env: Readonly<Record<string, string | undefined>>,
): BrowserLaunchOptions {
  const executablePath = env.CHROMIUM_PATH;
  return executablePath ? { executablePath } : {};
}

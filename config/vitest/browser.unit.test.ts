import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  COVERAGE_THRESHOLD_PERCENT,
  GENERATED_CODE_PATTERNS,
  TEST_FILE_PATTERNS,
} from '../test-patterns.ts';
import {
  type BrowserLaunchOptions,
  browserTestPreset,
  resolveBrowserLaunchOptions,
} from './browser.ts';
import type { TestKindPreset } from './test-kind-preset.ts';

describe('browserTestPreset', () => {
  test('単一定義に基づく設定値だけを持ち、余計な設定を持たない', () => {
    expect(browserTestPreset).toStrictEqual({
      include: [...TEST_FILE_PATTERNS.browser],
      passWithNoTests: true,
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage/browser',
        reporter: ['text', 'lcov'],
        thresholds: {
          lines: COVERAGE_THRESHOLD_PERCENT,
          functions: COVERAGE_THRESHOLD_PERCENT,
          perFile: true,
        },
        exclude: [
          ...Object.values(TEST_FILE_PATTERNS).flat(),
          ...GENERATED_CODE_PATTERNS,
        ],
      },
    });
  });

  test('ブラウザテストの命名パターンだけを対象にする', () => {
    expect(browserTestPreset.include).toEqual([...TEST_FILE_PATTERNS.browser]);
  });

  test('V8でカバレッジを計測する', () => {
    expect(browserTestPreset.coverage.provider).toBe('v8');
  });

  test('lcovをブラウザテスト用の出力先へ書き出す', () => {
    expect(browserTestPreset.coverage.reportsDirectory).toBe(
      'coverage/browser',
    );
    expect(browserTestPreset.coverage.reporter).toEqual(['text', 'lcov']);
  });

  test('型はテスト種別の共通設定値である', () => {
    expectTypeOf(browserTestPreset).toEqualTypeOf<TestKindPreset>();
  });
});

describe('resolveBrowserLaunchOptions', () => {
  test('共有Chromiumのパスがあれば、それをブラウザの実行ファイルにする', () => {
    expect(
      resolveBrowserLaunchOptions({ CHROMIUM_PATH: '/opt/chromium/chrome' }),
    ).toStrictEqual({ executablePath: '/opt/chromium/chrome' });
  });

  test.each([
    ['定義されていない', {}],
    ['値がundefinedである', { CHROMIUM_PATH: undefined }],
    ['空文字列である', { CHROMIUM_PATH: '' }],
  ])('共有Chromiumのパスが%s場合は実行ファイルを指定しない', (_label, env) => {
    const options = resolveBrowserLaunchOptions(env);

    expect(options).toStrictEqual({});
    expect(Object.hasOwn(options, 'executablePath')).toBe(false);
  });

  test('共有Chromiumのパスが無ければ、ほかのブラウザ関連の環境変数があっても実行ファイルを指定しない', () => {
    expect(
      resolveBrowserLaunchOptions({ PLAYWRIGHT_BROWSERS_PATH: '/x' }),
    ).toStrictEqual({});
  });

  test('共有Chromiumのパス以外の環境変数を起動オプションに含めない', () => {
    expect(
      resolveBrowserLaunchOptions({
        CHROMIUM_PATH: '/opt/chromium/chrome',
        PLAYWRIGHT_BROWSERS_PATH: '/opt/ms-playwright',
        HEADLESS: 'false',
      }),
    ).toStrictEqual({ executablePath: '/opt/chromium/chrome' });
  });

  test('型は起動オプションを返す関数である', () => {
    expectTypeOf(resolveBrowserLaunchOptions).toEqualTypeOf<
      (
        env: Readonly<Record<string, string | undefined>>,
      ) => BrowserLaunchOptions
    >();
  });
});

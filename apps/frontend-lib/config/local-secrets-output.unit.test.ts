import { describe, expect, test } from 'bun:test';

import type { Plugin, Rolldown } from 'vite';

import {
  excludeLocalSecretsFile,
  LOCAL_SECRETS_FILE_NAME,
} from './local-secrets-output.ts';

type OutputBundle = Rolldown.OutputBundle;

type GenerateBundleHandler = (
  options: unknown,
  bundle: OutputBundle,
  isWrite: boolean,
) => void;

function fakeAsset(fileName: string, source: string): OutputBundle[string] {
  return {
    type: 'asset',
    fileName,
    names: [],
    originalFileNames: [],
    source,
  } as unknown as OutputBundle[string];
}

function fakeBundle(fileNames: readonly string[]): OutputBundle {
  return Object.fromEntries(
    fileNames.map((fileName) => [
      fileName,
      fakeAsset(fileName, `fake-content-of-${fileName}`),
    ]),
  );
}

function generateBundleHandler(plugin: Plugin): GenerateBundleHandler {
  const hook = plugin.generateBundle;
  if (hook === undefined || typeof hook === 'function') {
    throw new TypeError('generateBundleは順序付きのフックである');
  }
  return hook.handler as unknown as GenerateBundleHandler;
}

describe('LOCAL_SECRETS_FILE_NAME', () => {
  test('Wranglerがローカルの開発で読むシークレットのファイルの名前である', () => {
    expect(LOCAL_SECRETS_FILE_NAME).toBe(['', 'dev', 'vars'].join('.'));
  });
});

describe('excludeLocalSecretsFile', () => {
  test('他のプラグインが出力を加えた後に動く', () => {
    const plugin = excludeLocalSecretsFile();

    expect(plugin.enforce).toBe('post');
    expect(plugin.generateBundle).toMatchObject({ order: 'post' });
  });

  test('偽のシークレットのファイルの資産だけを出力の一覧から除き、Wrangler設定とWorkerのコードを残す', () => {
    const bundle = fakeBundle([
      LOCAL_SECRETS_FILE_NAME,
      'wrangler.json',
      'index.mjs',
      'assets/worker-entry.js',
    ]);

    generateBundleHandler(excludeLocalSecretsFile())({}, bundle, true);

    expect(Object.keys(bundle).sort()).toEqual([
      'assets/worker-entry.js',
      'index.mjs',
      'wrangler.json',
    ]);
    expect(bundle['wrangler.json']).toMatchObject({
      source: 'fake-content-of-wrangler.json',
    });
  });

  test('出力の一覧にシークレットのファイルが無くても失敗せず、一覧を変えない', () => {
    const bundle = fakeBundle(['index.html', 'assets/main.js']);

    generateBundleHandler(excludeLocalSecretsFile())({}, bundle, true);

    expect(Object.keys(bundle).sort()).toEqual([
      'assets/main.js',
      'index.html',
    ]);
  });

  test('下位のディレクトリにある同じ名前のファイルは、プラグインが書き出すものではないため除かない', () => {
    const nestedFileName = `assets/${LOCAL_SECRETS_FILE_NAME}`;
    const bundle = fakeBundle([nestedFileName]);

    generateBundleHandler(excludeLocalSecretsFile())({}, bundle, true);

    expect(Object.keys(bundle)).toEqual([nestedFileName]);
  });
});

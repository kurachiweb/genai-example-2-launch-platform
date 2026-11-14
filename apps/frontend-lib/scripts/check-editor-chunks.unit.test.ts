import { describe, expect, test } from 'bun:test';

import type { InlineConfig } from 'vite';

import {
  type BundleBuilder,
  runEditorChunksCheck,
} from './check-editor-chunks.ts';
import type { BundleChunk } from './editor-chunk-isolation.ts';

type BuildResult = Awaited<ReturnType<BundleBuilder>>;

const MODULES = '/workspace/apps/frontend-lib/node_modules';

const MILKDOWN_MODULE = `${MODULES}/@milkdown/kit/lib/core/index.js`;

const EDITOR_MODULES = [
  MILKDOWN_MODULE,
  `${MODULES}/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js`,
  `${MODULES}/prosemirror-state/dist/index.js`,
];

const chunk = (
  fileName: string,
  overrides: Partial<Omit<BundleChunk, 'fileName'>> = {},
) => ({
  type: 'chunk' as const,
  fileName,
  isEntry: false,
  imports: [],
  dynamicImports: [],
  moduleIds: [],
  ...overrides,
});

const ASSET = { type: 'asset' as const, fileName: 'assets/editor.css' };

const isolatedOutput = [
  chunk('assets/editor-entry.js', {
    isEntry: true,
    dynamicImports: ['assets/crepe-editor-surface.js'],
    moduleIds: [
      '/workspace/apps/frontend-lib/components/markdown-editor/markdown-editor.tsx',
    ],
  }),
  chunk('assets/crepe-editor-surface.js', { moduleIds: EDITOR_MODULES }),
  ASSET,
];

const staticOutput = [
  chunk('assets/editor-entry.js', {
    isEntry: true,
    moduleIds: [
      '/workspace/apps/frontend-lib/components/markdown-editor/markdown-editor.tsx',
      ...EDITOR_MODULES,
    ],
  }),
];

const resultOf = (output: readonly unknown[]): BuildResult =>
  ({ output }) as unknown as BuildResult;

const isSsr = (config: InlineConfig): boolean =>
  config.build?.ssr !== undefined && config.build.ssr !== false;

interface RecordedOutput {
  readonly stdout: { write: (text: string) => void };
  readonly stderr: { write: (text: string) => void };
  readonly written: { stdout: string; stderr: string };
}

const recordOutput = (): RecordedOutput => {
  const written = { stdout: '', stderr: '' };
  return {
    stdout: {
      write: (text) => {
        written.stdout += text;
      },
    },
    stderr: {
      write: (text) => {
        written.stderr += text;
      },
    },
    written,
  };
};

describe('runEditorChunksCheck', () => {
  test('クライアントとサーバー側の描画の両方で分離されていれば成功し、結果を標準出力へ書く', async () => {
    const output = recordOutput();
    const configs: InlineConfig[] = [];
    const builder: BundleBuilder = (config) => {
      configs.push(config);
      return Promise.resolve(
        isSsr(config)
          ? resultOf(isolatedOutput)
          : ([resultOf(isolatedOutput)] as unknown as BuildResult),
      );
    };

    const code = await runEditorChunksCheck(output, builder);

    expect(code).toBe(0);
    expect(output.written.stdout).toBe(
      'クライアント: エディタの実装は動的な読み込みの先にだけあります。\n' +
        'サーバー側の描画: エディタの実装は動的な読み込みの先にだけあります。\n',
    );
    expect(output.written.stderr).toBe('');
    expect(configs.map(isSsr)).toEqual([false, true]);
    expect(configs.every((config) => config.build?.write === false)).toBe(true);
    expect(configs[1]?.ssr?.noExternal).toBe(true);
  });

  test('入口から静的に読み込まれる範囲にエディタの実装があれば失敗し、そのモジュールを標準エラーへ書く', async () => {
    const output = recordOutput();
    const builder: BundleBuilder = (config) =>
      Promise.resolve(resultOf(isSsr(config) ? staticOutput : isolatedOutput));

    const code = await runEditorChunksCheck(output, builder);

    expect(code).toBe(1);
    expect(output.written.stdout).toBe(
      'クライアント: エディタの実装は動的な読み込みの先にだけあります。\n',
    );
    expect(output.written.stderr).toContain(
      'サーバー側の描画: 入口から静的に読み込まれる範囲にエディタの実装のモジュールがあります。\n',
    );
    expect(output.written.stderr).toContain(`  ${MILKDOWN_MODULE}\n`);
  });

  test('ビルドが失敗しても残りの対象を検査し、失敗の理由を標準エラーへ書く', async () => {
    const output = recordOutput();
    const builder: BundleBuilder = (config) =>
      isSsr(config)
        ? Promise.reject(new Error('依存を解決できません'))
        : Promise.reject(new Error('出力先を書き込めません'));

    const code = await runEditorChunksCheck(output, builder);

    expect(code).toBe(1);
    expect(output.written.stdout).toBe('');
    expect(output.written.stderr).toBe(
      'クライアント: 検査用のビルドを完了できませんでした: 出力先を書き込めません\n' +
        'サーバー側の描画: 検査用のビルドを完了できませんでした: 依存を解決できません\n',
    );
  });

  test('ビルドが監視モードで起動されたら失敗として扱う', async () => {
    const output = recordOutput();
    const builder: BundleBuilder = () =>
      Promise.resolve({} as unknown as BuildResult);

    const code = await runEditorChunksCheck(output, builder);

    expect(code).toBe(1);
    expect(output.written.stderr).toContain(
      'クライアント: 検査用のビルドを完了できませんでした: ビルドが監視モードで起動されました。\n',
    );
  });
});

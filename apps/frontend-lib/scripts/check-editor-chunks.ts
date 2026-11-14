import { builtinModules } from 'node:module';
import { join } from 'node:path';

import type { build, InlineConfig } from 'vite';

import { VUE_FEATURE_FLAGS } from '../config/vue-feature-flags.ts';
import {
  type BundleChunk,
  formatEditorChunkReport,
  inspectEditorChunks,
} from './editor-chunk-isolation.ts';

interface TextSink {
  readonly write: (text: string) => unknown;
}

interface CommandOutput {
  readonly stdout: TextSink;
  readonly stderr: TextSink;
}

interface BuildTarget {
  readonly label: string;
  readonly config: InlineConfig;
}

type BuildResult = Awaited<ReturnType<typeof build>>;

export type BundleBuilder = (config: InlineConfig) => Promise<BuildResult>;

// ViteはBunの単体テストの一括実行の中で読み込むと初期化で例外を投げるため、検査の関数を単体テストで読み込めるよう、ビルドを始める時に初めて読み込む
const viteBuild: BundleBuilder = async (config) => {
  const [{ build: buildWithVite }, { default: viteReact }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
  ]);
  return buildWithVite({ ...config, plugins: [viteReact()] });
};

const LIB_DIR = join(import.meta.dirname, '..');

const ENTRY = join(LIB_DIR, 'test', 'bundle', 'editor-entry.tsx');

// 画面のアプリのビルドではTanStack Startのコンパイラが同型の関数のサーバーの分岐をブラウザ向けから消すが、検査のビルドはそのコンパイラを通さない。ブラウザ向けではサーバー専用のファイルと組み込みモジュールを外部化し、編集領域の分離だけを確かめる
const SERVER_ONLY_MODULES = [
  /\.server\.tsx?$/,
  /^node:/,
  ...builtinModules.map((name) => new RegExp(`^${name}(?:/|$)`)),
];

const sharedConfig = (): InlineConfig => ({
  root: LIB_DIR,
  configFile: false,
  logLevel: 'warn',
  define: VUE_FEATURE_FLAGS,
});

// ビルドの出力はGit管理の場所へ書かず、メモリ上のチャンクの情報だけを使う
const BUILD_TARGETS: readonly BuildTarget[] = [
  {
    label: 'クライアント',
    config: {
      ...sharedConfig(),
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: ENTRY,
          external: SERVER_ONLY_MODULES,
          preserveEntrySignatures: 'exports-only',
        },
      },
    },
  },
  {
    // Workersへ配る画面のアプリのサーバー側の描画は依存をすべて1つにまとめるため、依存を外部化しない
    label: 'サーバー側の描画',
    config: {
      ...sharedConfig(),
      ssr: { noExternal: true },
      build: { write: false, minify: false, ssr: ENTRY },
    },
  },
];

function chunksOf(result: BuildResult): BundleChunk[] {
  if (!Array.isArray(result) && !('output' in result)) {
    throw new Error('ビルドが監視モードで起動されました。');
  }
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .flatMap((item) =>
      item.type === 'chunk'
        ? [
            {
              fileName: item.fileName,
              isEntry: item.isEntry,
              imports: item.imports,
              dynamicImports: item.dynamicImports,
              moduleIds: item.moduleIds,
            },
          ]
        : [],
    );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runEditorChunksCheck(
  output: CommandOutput,
  buildBundle: BundleBuilder = viteBuild,
): Promise<number> {
  let passed = true;
  for (const target of BUILD_TARGETS) {
    try {
      const report = formatEditorChunkReport(
        target.label,
        inspectEditorChunks(chunksOf(await buildBundle(target.config))),
      );
      const sink = report.passed ? output.stdout : output.stderr;
      sink.write(report.lines.map((line) => `${line}\n`).join(''));
      passed &&= report.passed;
    } catch (error) {
      output.stderr.write(
        `${target.label}: 検査用のビルドを完了できませんでした: ${errorMessage(error)}\n`,
      );
      passed = false;
    }
  }
  return passed ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await runEditorChunksCheck(process));
}

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

import { TEST_LIKE_FILE_PATTERN } from '../../config/test-patterns.ts';

const DELIVERY_DIR = import.meta.dirname;
const REPO_ROOT = resolve(DELIVERY_DIR, '..', '..');

type Layer = 'catalog' | 'core' | 'adapters' | 'commands' | 'cli';

const DIRECTORY_LAYERS: readonly Layer[] = [
  'catalog',
  'core',
  'adapters',
  'commands',
];

// 入口は手順の層を通してだけ入出力の部品を使い、入出力の層を直接読み込まない
const ALLOWED_IMPORTS: Readonly<Record<Layer, readonly Layer[]>> = {
  catalog: ['catalog'],
  core: ['catalog', 'core'],
  adapters: ['catalog', 'core', 'adapters'],
  commands: ['catalog', 'core', 'adapters', 'commands'],
  cli: ['catalog', 'core', 'commands'],
};

const PURE_LAYERS: readonly Layer[] = ['catalog', 'core'];

const FORBIDDEN_MODULES: ReadonlySet<string> = new Set(
  [
    'child_process',
    'fs',
    'fs/promises',
    'http',
    'https',
    'net',
    'os',
    'process',
  ].flatMap((name) => [name, `node:${name}`]),
);

const FORBIDDEN_BUN_MEMBERS: ReadonlySet<string> = new Set([
  '$',
  'spawn',
  'spawnSync',
  'file',
  'write',
  'fetch',
  'connect',
  'listen',
  'serve',
  'env',
  'argv',
]);

const FORBIDDEN_PROCESS_MEMBERS: ReadonlySet<string> = new Set([
  'env',
  'exit',
  'cwd',
  'argv',
]);

const layerOf = (absolutePath: string): Layer | undefined => {
  const path = relative(DELIVERY_DIR, absolutePath);
  if (path === 'cli.ts') return 'cli';
  const [top] = path.split(sep);
  return DIRECTORY_LAYERS.find((layer) => layer === top);
};

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);

const moduleSpecifiersOf = (source: string): readonly string[] =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName);

const forbiddenUseOf = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const owner = node.expression.text;
    const member = node.name.text;
    if (owner === 'Bun' && FORBIDDEN_BUN_MEMBERS.has(member)) {
      return `Bun.${member}`;
    }
    if (owner === 'process' && FORBIDDEN_PROCESS_MEMBERS.has(member)) {
      return `process.${member}`;
    }
    if (owner === 'globalThis' && member === 'fetch') return 'globalThis.fetch';
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'fetch'
  ) {
    return 'fetch';
  }
  return undefined;
};

const collectForbiddenUses = (node: ts.Node): readonly string[] => {
  const use = forbiddenUseOf(node);
  return [
    ...(use === undefined ? [] : [use]),
    ...node.getChildren().flatMap(collectForbiddenUses),
  ];
};

const forbiddenApisOf = (source: string): readonly string[] => [
  ...moduleSpecifiersOf(source).filter(
    (specifier) => FORBIDDEN_MODULES.has(specifier) || specifier === 'bun',
  ),
  ...collectForbiddenUses(parse(source)),
];

const productionFiles = (): readonly string[] =>
  [...new Bun.Glob('**/*.ts').scanSync({ cwd: DELIVERY_DIR })]
    .filter(
      (path) =>
        !TEST_LIKE_FILE_PATTERN.test(path) &&
        layerOf(resolve(DELIVERY_DIR, path)) !== undefined,
    )
    .toSorted();

const relativeImportsOf = (path: string): readonly string[] => {
  const absolutePath = resolve(DELIVERY_DIR, path);
  return moduleSpecifiersOf(readFileSync(absolutePath, 'utf8'))
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(absolutePath), specifier));
};

const directionViolationsOf = (path: string): readonly string[] => {
  const layer = layerOf(resolve(DELIVERY_DIR, path));
  if (layer === undefined) return [];
  return relativeImportsOf(path).flatMap((target) => {
    if (!target.startsWith(`${DELIVERY_DIR}${sep}`)) return [];
    const targetLayer = layerOf(target);
    return targetLayer !== undefined &&
      ALLOWED_IMPORTS[layer].includes(targetLayer)
      ? []
      : [`${path} → ${relative(DELIVERY_DIR, target)}`];
  });
};

const appImportsOf = (path: string): readonly string[] =>
  relativeImportsOf(path)
    .filter((target) => relative(REPO_ROOT, target).startsWith(`apps${sep}`))
    .map((target) => `${path} → ${relative(REPO_ROOT, target)}`);

describe('検査の部品', () => {
  test('型だけの読み込みと動的な読み込みも、読み込むモジュールとして数える', () => {
    const source = [
      "import type { CommandRunner } from '../adapters/command-runner.ts';",
      "import { readFileSync } from 'node:fs';",
      "export { x } from './x.ts';",
      "const loaded = await import('./lazy.ts');",
    ].join('\n');

    expect(moduleSpecifiersOf(source)).toEqual([
      '../adapters/command-runner.ts',
      'node:fs',
      './x.ts',
      './lazy.ts',
    ]);
  });

  test.each([
    ["import { spawn } from 'node:child_process';", 'node:child_process'],
    ["import { readFile } from 'fs/promises';", 'fs/promises'],
    ["import { $ } from 'bun';", 'bun'],
    ["const res = await fetch('https://example.example');", 'fetch'],
    ["await globalThis.fetch('https://example.example');", 'globalThis.fetch'],
    ["Bun.spawn(['ls']);", 'Bun.spawn'],
    ["Bun.spawnSync(['ls']);", 'Bun.spawnSync'],
    ["await Bun.file('a').text();", 'Bun.file'],
    ["await Bun.write('a', 'b');", 'Bun.write'],
    ['const token = process.env.TOKEN;', 'process.env'],
    ['const token = Bun.env.TOKEN;', 'Bun.env'],
    ['const args = Bun.argv;', 'Bun.argv'],
    ["import { homedir } from 'node:os';", 'node:os'],
    ["import { tmpdir } from 'os';", 'os'],
    ["import { env } from 'node:process';", 'node:process'],
    ["import process from 'process';", 'process'],
    ['process.exit(1);', 'process.exit'],
    ['const root = process.cwd();', 'process.cwd'],
    ['const args = process.argv;', 'process.argv'],
  ])('判定の層で禁じたAPIの使用%sを検出する', (source, expected) => {
    expect(forbiddenApisOf(source)).toEqual([expected]);
  });

  test.each([
    "const text = 'fetch(url) と process.env と Bun.spawn は文字列なら使用でない';",
    '// fetch(url) や process.env はコメントなら使用でない',
    'const width = Bun.stringWidth("あ");',
    'const request = { fetch: 1 }.fetch;',
  ])('使用でない記述%sを違反にしない', (source) => {
    expect(forbiddenApisOf(source)).toEqual([]);
  });
});

describe('scripts/deliveryの層構成', () => {
  test('各層の本体のファイルを検査の対象にする', () => {
    const files = productionFiles();
    const expected = [
      'cli.ts',
      'catalog/resource-catalog.ts',
      'catalog/check-secrets.ts',
      'core/violation.ts',
      'adapters/command-runner.ts',
      'adapters/repo-files.ts',
      'adapters/github-actions.ts',
      'commands/shared/delivery-command.ts',
    ];

    expect(expected.filter((path) => !files.includes(path))).toEqual([]);
    expect(files.some((path) => path.startsWith('test-fixtures/'))).toBe(false);
  });

  test('判定・入出力・手順・入口の各層は、許された層だけを読み込む', () => {
    expect(productionFiles().flatMap(directionViolationsOf)).toEqual([]);
  });

  test('判定の層は子プロセス・ファイル・ネットワーク・環境変数・プロセスの状態・OSのAPIを使わない', () => {
    const violations = productionFiles()
      .filter((path) => {
        const layer = layerOf(resolve(DELIVERY_DIR, path));
        return layer !== undefined && PURE_LAYERS.includes(layer);
      })
      .flatMap((path) =>
        forbiddenApisOf(readFileSync(resolve(DELIVERY_DIR, path), 'utf8')).map(
          (use) => `${path}: ${use}`,
        ),
      );

    expect(violations).toEqual([]);
  });

  test('アプリのコードを読み込まない', () => {
    expect(productionFiles().flatMap(appImportsOf)).toEqual([]);
  });
});

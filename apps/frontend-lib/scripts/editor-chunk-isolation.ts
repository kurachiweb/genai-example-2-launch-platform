export type EditorPackageFamily = 'milkdown' | 'vue' | 'prosemirror';

export const EDITOR_PACKAGE_FAMILIES: readonly EditorPackageFamily[] = [
  'milkdown',
  'vue',
  'prosemirror',
];

const FAMILY_LABELS: Readonly<Record<EditorPackageFamily, string>> = {
  milkdown: 'Milkdown(@milkdown/*)',
  vue: 'Vue(vue・@vue/*)',
  prosemirror: 'ProseMirror(prosemirror-*)',
};

// ビルドの出力のチャンク。imports・dynamicImportsはマニフェストと同じく他のチャンクのファイル名を指し、外部化したパッケージは指定のまま入る
export interface BundleChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly moduleIds: readonly string[];
}

export interface EditorChunkFinding {
  readonly staticEditorModules: readonly string[];
  readonly missingDynamicFamilies: readonly EditorPackageFamily[];
}

export interface EditorChunkReport {
  readonly passed: boolean;
  readonly lines: readonly string[];
}

const NODE_MODULES_SEGMENT = '/node_modules/';

// 仮想モジュールの接頭辞\0と、プラグインが付ける?以降の問い合わせを除いたパッケージ名。パッケージ外のソースと組み込みモジュールはundefined
function packageNameOf(moduleId: string): string | undefined {
  const path = moduleId.replace(/^\0/, '').replace(/\?.*$/, '');
  const index = path.lastIndexOf(NODE_MODULES_SEGMENT);
  const specifier =
    index === -1 ? path : path.slice(index + NODE_MODULES_SEGMENT.length);
  if (/^[./]/.test(specifier) || specifier.includes(':')) {
    return undefined;
  }
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

export function editorPackageFamilyOf(
  moduleId: string,
): EditorPackageFamily | undefined {
  const name = packageNameOf(moduleId);
  if (name === undefined) {
    return undefined;
  }
  if (name.startsWith('@milkdown/')) {
    return 'milkdown';
  }
  if (name === 'vue' || name.startsWith('@vue/')) {
    return 'vue';
  }
  return name.startsWith('prosemirror-') ? 'prosemirror' : undefined;
}

function collectChunks(
  starts: readonly string[],
  chunksByName: ReadonlyMap<string, BundleChunk>,
  next: (chunk: BundleChunk) => readonly string[],
  excluded: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [...starts];
  while (pending.length > 0) {
    const name = pending.pop();
    const current = name === undefined ? undefined : chunksByName.get(name);
    if (
      current === undefined ||
      visited.has(current.fileName) ||
      excluded.has(current.fileName)
    ) {
      continue;
    }
    visited.add(current.fileName);
    pending.push(...next(current));
  }
  return visited;
}

export function inspectEditorChunks(
  chunks: readonly BundleChunk[],
): EditorChunkFinding {
  const chunksByName = new Map(chunks.map((entry) => [entry.fileName, entry]));
  const isExternal = (specifier: string): boolean =>
    !chunksByName.has(specifier);
  const staticChunks = collectChunks(
    chunks.filter((entry) => entry.isEntry).map((entry) => entry.fileName),
    chunksByName,
    (entry) => entry.imports,
  );
  const dynamicChunks = collectChunks(
    chunks
      .filter((entry) => staticChunks.has(entry.fileName))
      .flatMap((entry) => entry.dynamicImports),
    chunksByName,
    (entry) => [...entry.imports, ...entry.dynamicImports],
    staticChunks,
  );
  const staticModules = chunks
    .filter((entry) => staticChunks.has(entry.fileName))
    .flatMap((entry) => [
      ...entry.moduleIds,
      ...entry.imports.filter(isExternal),
    ]);
  const dynamicModules = chunks.flatMap((entry) => {
    if (staticChunks.has(entry.fileName)) {
      return entry.dynamicImports.filter(isExternal);
    }
    return dynamicChunks.has(entry.fileName)
      ? [
          ...entry.moduleIds,
          ...entry.imports.filter(isExternal),
          ...entry.dynamicImports.filter(isExternal),
        ]
      : [];
  });
  const dynamicFamilies = new Set(dynamicModules.map(editorPackageFamilyOf));
  return {
    staticEditorModules: [
      ...new Set(
        staticModules.filter(
          (moduleId) => editorPackageFamilyOf(moduleId) !== undefined,
        ),
      ),
    ],
    missingDynamicFamilies: EDITOR_PACKAGE_FAMILIES.filter(
      (family) => !dynamicFamilies.has(family),
    ),
  };
}

const indent = (line: string): string => `  ${line}`;

export function formatEditorChunkReport(
  target: string,
  finding: EditorChunkFinding,
): EditorChunkReport {
  const { staticEditorModules, missingDynamicFamilies } = finding;
  if (staticEditorModules.length === 0 && missingDynamicFamilies.length === 0) {
    return {
      passed: true,
      lines: [`${target}: エディタの実装は動的な読み込みの先にだけあります。`],
    };
  }
  const staticLines =
    staticEditorModules.length === 0
      ? []
      : [
          `${target}: 入口から静的に読み込まれる範囲にエディタの実装のモジュールがあります。`,
          ...staticEditorModules.map(indent),
        ];
  const dynamicLines =
    missingDynamicFamilies.length === 0
      ? []
      : [
          `${target}: 動的な読み込みの先に次のパッケージのモジュールがありません。`,
          ...missingDynamicFamilies.map((family) =>
            indent(FAMILY_LABELS[family]),
          ),
        ];
  return { passed: false, lines: [...staticLines, ...dynamicLines] };
}

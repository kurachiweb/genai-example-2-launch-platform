import { describe, expect, test } from 'bun:test';

import {
  type BundleChunk,
  type EditorPackageFamily,
  editorPackageFamilyOf,
  formatEditorChunkReport,
  inspectEditorChunks,
} from './editor-chunk-isolation.ts';

const MODULES = '/workspace/apps/frontend-lib/node_modules';

const chunk = (
  fileName: string,
  overrides: Partial<Omit<BundleChunk, 'fileName'>> = {},
): BundleChunk => ({
  fileName,
  isEntry: false,
  imports: [],
  dynamicImports: [],
  moduleIds: [],
  ...overrides,
});

const EDITOR_MODULES = [
  `${MODULES}/@milkdown/kit/lib/core/index.js`,
  `${MODULES}/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js`,
  `${MODULES}/prosemirror-state/dist/index.js`,
];

const isolatedBundle: readonly BundleChunk[] = [
  chunk('assets/editor-entry.js', {
    isEntry: true,
    imports: ['assets/react.js'],
    dynamicImports: ['assets/crepe-editor-surface.js'],
    moduleIds: [
      '/workspace/apps/frontend-lib/components/markdown-editor/markdown-editor.tsx',
    ],
  }),
  chunk('assets/react.js', {
    moduleIds: [`${MODULES}/react/index.js`],
  }),
  chunk('assets/crepe-editor-surface.js', {
    imports: ['assets/react.js', 'assets/vue.js'],
    moduleIds: [
      '/workspace/apps/frontend-lib/components/markdown-editor/crepe/crepe-editor-surface.tsx',
      `${MODULES}/@milkdown/kit/lib/core/index.js`,
      `${MODULES}/prosemirror-state/dist/index.js`,
    ],
  }),
  chunk('assets/vue.js', {
    moduleIds: [`${MODULES}/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js`],
  }),
];

describe('editorPackageFamilyOf', () => {
  test.each<[string, EditorPackageFamily]>([
    [`${MODULES}/@milkdown/crepe/lib/esm/builder.js`, 'milkdown'],
    [
      `${MODULES}/.bun/@milkdown+kit@7.22.3/node_modules/@milkdown/kit/lib/esm/core.js`,
      'milkdown',
    ],
    [`${MODULES}/vue/dist/vue.runtime.esm-bundler.js`, 'vue'],
    [`${MODULES}/@vue/shared/dist/shared.esm-bundler.js`, 'vue'],
    [
      `${MODULES}/prosemirror-view/dist/index.js?commonjs-es-import`,
      'prosemirror',
    ],
    [`\0${MODULES}/prosemirror-model/dist/index.js`, 'prosemirror'],
    ['@milkdown/kit/core', 'milkdown'],
    ['vue', 'vue'],
    ['prosemirror-state', 'prosemirror'],
  ])('%sは%sのモジュールである', (moduleId, family) => {
    expect(editorPackageFamilyOf(moduleId)).toBe(family);
  });

  test.each([
    `${MODULES}/react/index.js`,
    `${MODULES}/vue-router/dist/vue-router.mjs`,
    `${MODULES}/@vueuse/core/index.mjs`,
    `${MODULES}/@tanstack/react-router/dist/esm/index.js`,
    '/workspace/apps/frontend-lib/components/markdown-editor/crepe/vue.ts',
    '/workspace/apps/frontend-lib/components/prosemirror-like.tsx',
    'node:async_hooks',
    'react',
  ])('%sはエディタの実装のモジュールではない', (moduleId) => {
    expect(editorPackageFamilyOf(moduleId)).toBeUndefined();
  });
});

describe('inspectEditorChunks', () => {
  test('入口から静的にたどれる範囲に無く、動的な読み込みの先に3種のモジュールがあれば違反は無い', () => {
    expect(inspectEditorChunks(isolatedBundle)).toEqual({
      staticEditorModules: [],
      missingDynamicFamilies: [],
    });
  });

  test('入口のチャンクにエディタのモジュールが含まれると、その全てを違反として返す', () => {
    const bundle = [
      chunk('assets/editor-entry.js', {
        isEntry: true,
        moduleIds: [
          '/workspace/apps/frontend-lib/components/markdown-editor/markdown-editor.tsx',
          ...EDITOR_MODULES,
        ],
      }),
    ];

    expect(inspectEditorChunks(bundle)).toEqual({
      staticEditorModules: EDITOR_MODULES,
      missingDynamicFamilies: ['milkdown', 'vue', 'prosemirror'],
    });
  });

  test('静的な読み込みを何段たどった先のチャンクでも違反にする', () => {
    const bundle = [
      chunk('assets/editor-entry.js', {
        isEntry: true,
        imports: ['assets/shared.js'],
        dynamicImports: ['assets/crepe-editor-surface.js'],
      }),
      chunk('assets/shared.js', { imports: ['assets/vue.js'] }),
      chunk('assets/vue.js', {
        moduleIds: [
          `${MODULES}/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js`,
        ],
      }),
      chunk('assets/crepe-editor-surface.js', {
        imports: ['assets/vue.js'],
        moduleIds: [
          `${MODULES}/@milkdown/kit/lib/core/index.js`,
          `${MODULES}/prosemirror-state/dist/index.js`,
        ],
      }),
    ];

    expect(inspectEditorChunks(bundle)).toEqual({
      staticEditorModules: [
        `${MODULES}/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js`,
      ],
      missingDynamicFamilies: ['vue'],
    });
  });

  test('外部化されたパッケージは、静的な読み込みなら違反にし、動的な読み込みなら動的な読み込みの先に数える', () => {
    const bundle = [
      chunk('server/editor-entry.js', {
        isEntry: true,
        imports: ['react', '@milkdown/kit/core'],
        dynamicImports: ['server/crepe-editor-surface.js'],
      }),
      chunk('server/crepe-editor-surface.js', {
        imports: ['vue'],
        dynamicImports: ['prosemirror-state'],
      }),
    ];

    expect(inspectEditorChunks(bundle)).toEqual({
      staticEditorModules: ['@milkdown/kit/core'],
      missingDynamicFamilies: ['milkdown'],
    });
  });

  test('入口の外部化された動的な読み込みも動的な読み込みの先に数える', () => {
    const bundle = [
      chunk('server/editor-entry.js', {
        isEntry: true,
        dynamicImports: ['@milkdown/crepe', 'vue', 'prosemirror-view'],
      }),
    ];

    expect(inspectEditorChunks(bundle).missingDynamicFamilies).toEqual([]);
  });

  test('動的な読み込みの先の静的な読み込みと、さらに先の動的な読み込みもたどる', () => {
    const bundle = [
      chunk('assets/editor-entry.js', {
        isEntry: true,
        dynamicImports: ['assets/surface.js'],
      }),
      chunk('assets/surface.js', {
        imports: ['assets/milkdown.js'],
        dynamicImports: ['assets/later.js'],
      }),
      chunk('assets/milkdown.js', {
        moduleIds: [`${MODULES}/@milkdown/kit/lib/core/index.js`],
      }),
      chunk('assets/later.js', {
        moduleIds: [
          `${MODULES}/vue/dist/vue.runtime.esm-bundler.js`,
          `${MODULES}/prosemirror-view/dist/index.js`,
        ],
      }),
    ];

    expect(inspectEditorChunks(bundle).missingDynamicFamilies).toEqual([]);
  });

  test('入口のチャンクが無ければ、動的な読み込みの先にも何も無いとみなす', () => {
    const bundle = isolatedBundle.map((entry) => ({
      ...entry,
      isEntry: false,
    }));

    expect(inspectEditorChunks(bundle)).toEqual({
      staticEditorModules: [],
      missingDynamicFamilies: ['milkdown', 'vue', 'prosemirror'],
    });
  });

  test('静的にも動的にも読み込まれるチャンクは静的な範囲に数える', () => {
    const bundle = [
      chunk('assets/editor-entry.js', {
        isEntry: true,
        imports: ['assets/editor.js'],
        dynamicImports: ['assets/editor.js'],
      }),
      chunk('assets/editor.js', { moduleIds: EDITOR_MODULES }),
    ];

    expect(inspectEditorChunks(bundle)).toEqual({
      staticEditorModules: EDITOR_MODULES,
      missingDynamicFamilies: ['milkdown', 'vue', 'prosemirror'],
    });
  });

  test('同じ外部のパッケージを複数のチャンクが静的に読み込んでも、違反は1件にまとめる', () => {
    const bundle = [
      chunk('server/editor-entry.js', {
        isEntry: true,
        imports: ['server/a.js', 'server/b.js'],
      }),
      chunk('server/a.js', { imports: ['vue'] }),
      chunk('server/b.js', { imports: ['vue'] }),
    ];

    expect(inspectEditorChunks(bundle).staticEditorModules).toEqual(['vue']);
  });
});

describe('formatEditorChunkReport', () => {
  test('違反が無ければ成功の1行を返す', () => {
    expect(
      formatEditorChunkReport('クライアント', {
        staticEditorModules: [],
        missingDynamicFamilies: [],
      }),
    ).toEqual({
      passed: true,
      lines: [
        'クライアント: エディタの実装は動的な読み込みの先にだけあります。',
      ],
    });
  });

  test('静的な範囲のモジュールと、動的な読み込みの先に無い種類を挙げて失敗を返す', () => {
    expect(
      formatEditorChunkReport('サーバー側の描画', {
        staticEditorModules: [
          `${MODULES}/@milkdown/kit/lib/core/index.js`,
          'vue',
        ],
        missingDynamicFamilies: ['milkdown', 'vue'],
      }),
    ).toEqual({
      passed: false,
      lines: [
        'サーバー側の描画: 入口から静的に読み込まれる範囲にエディタの実装のモジュールがあります。',
        `  ${MODULES}/@milkdown/kit/lib/core/index.js`,
        '  vue',
        'サーバー側の描画: 動的な読み込みの先に次のパッケージのモジュールがありません。',
        '  Milkdown(@milkdown/*)',
        '  Vue(vue・@vue/*)',
      ],
    });
  });

  test('動的な読み込みの先の欠けだけでも失敗を返す', () => {
    expect(
      formatEditorChunkReport('クライアント', {
        staticEditorModules: [],
        missingDynamicFamilies: ['prosemirror'],
      }),
    ).toEqual({
      passed: false,
      lines: [
        'クライアント: 動的な読み込みの先に次のパッケージのモジュールがありません。',
        '  ProseMirror(prosemirror-*)',
      ],
    });
  });
});

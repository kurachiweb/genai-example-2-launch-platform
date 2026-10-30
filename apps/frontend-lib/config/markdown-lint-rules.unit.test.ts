import { describe, expect, test } from 'bun:test';

import {
  allowed,
  expectedStatementsOf,
  forbidden,
  IMPORT_RULE_IDS,
  LINT_TIMEOUT_MS,
  type PositionCase,
  reportedStatementsOf,
  type StatementCase,
} from '../test/lint-statements';

const SYNTAX_RULE_IDS: ReadonlySet<string | null> = new Set([
  'no-restricted-syntax',
]);

const EDITOR_PACKAGE_STATEMENTS: readonly StatementCase[] = [
  forbidden("import { Crepe } from '@milkdown/crepe';"),
  forbidden("import { CrepeBuilder } from '@milkdown/crepe/builder';"),
  forbidden("import { Editor } from '@milkdown/kit/core';"),
  forbidden("import type { Ctx } from '@milkdown/kit/ctx';"),
  forbidden("import { Milkdown } from '@milkdown/react';"),
  forbidden("import { ref } from 'vue';"),
  forbidden("import { h } from '@vue/runtime-dom';"),
  forbidden("export { Crepe } from '@milkdown/crepe';"),
  forbidden("export * from '@milkdown/kit/core';"),
  allowed("import { createStore } from 'vuex-like';"),
  allowed("import { a } from './milkdown';"),
];

const allowedEverywhere = (
  statements: readonly StatementCase[],
): readonly StatementCase[] =>
  statements.map(({ statement }) => allowed(statement));

const EDITOR_MODULE_STATEMENTS: readonly StatementCase[] = [
  forbidden("import CrepeEditorSurface from './crepe/crepe-editor-surface';"),
  forbidden("import type { a } from './crepe/editor-commands';"),
  forbidden("import { b } from './crepe';"),
  forbidden("import './crepe/crepe-theme.css';"),
  forbidden("export { default } from './crepe/crepe-editor-surface';"),
  forbidden("export * from './crepe/editor-commands';"),
  allowed("import { c } from './editor-controller';"),
  allowed("import { d } from './crepe-editor-placeholder';"),
  allowed("import { loadCrepeEditor } from './load-crepe-editor';"),
];

const EDITOR_POSITION_CASES: readonly PositionCase[] = [
  {
    file: 'components/markdown-editor/markdown-editor.tsx',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      ...EDITOR_MODULE_STATEMENTS,
      forbidden("import { e } from '../../../src/composition/relay-routes';"),
      forbidden("import { f } from '../../start/request-context.server';"),
      forbidden("import { init } from '@sentry/tanstackstart-react';"),
      forbidden("import { z } from 'zod';"),
      allowed("import { g } from '../../utilities/class-names';"),
    ],
  },
  {
    file: 'components/markdown-editor/load-crepe-editor.ts',
    statements: EDITOR_MODULE_STATEMENTS,
  },
  {
    file: 'components/markdown-editor/toolbar/violation.tsx',
    statements: [
      forbidden("import { a } from '../crepe/editor-commands';"),
      allowed("import { b } from '../editor-actions';"),
    ],
  },
  {
    file: 'components/markdown/violation.tsx',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden(
        "import CrepeEditorSurface from '../markdown-editor/crepe/crepe-editor-surface';",
      ),
      allowed(
        "import { MarkdownEditor } from '../markdown-editor/markdown-editor';",
      ),
    ],
  },
  {
    file: 'components/markdown-editor/markdown-editor.browser.test.tsx',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden(
        "import CrepeEditorSurface from './crepe/crepe-editor-surface';",
      ),
    ],
  },
  {
    file: 'components/markdown-editor/crepe/crepe-editor-surface.tsx',
    statements: [
      ...allowedEverywhere(EDITOR_PACKAGE_STATEMENTS),
      allowed("import { a } from './editor-features';"),
      allowed("import './crepe-theme.css';"),
      allowed("import type { b } from '../editor-controller';"),
      allowed("import { c } from '../../../utilities/class-names';"),
      forbidden(
        "import { d } from '../../../../src/composition/relay-routes';",
      ),
      forbidden("import { e } from '../../../start/request-context.server';"),
      forbidden(
        "import { f } from '../../../../common-lib/validation/markdown-text-schema';",
      ),
      forbidden("import { init } from '@sentry/tanstackstart-react';"),
      forbidden("import { z } from 'zod';"),
    ],
  },
  {
    file: 'components/markdown-editor/crepe/crepe-editor-surface.browser.test.tsx',
    statements: allowedEverywhere(EDITOR_PACKAGE_STATEMENTS),
  },
  {
    file: 'utilities/sample/violation.ts',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden("import { a } from '../../server/http/csrf';"),
    ],
  },
  {
    file: 'server/http/violation.ts',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden("import { a } from '../../start/query-client';"),
    ],
  },
  {
    file: 'start/sample/violation.ts',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden("import { a } from '../../components/ui/button/button';"),
    ],
  },
  {
    file: 'test/bundle/editor-entry.tsx',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden(
        "import CrepeEditorSurface from '../../components/markdown-editor/crepe/crepe-editor-surface';",
      ),
      allowed(
        "import { MarkdownEditor } from '../../components/markdown-editor/markdown-editor';",
      ),
    ],
  },
  {
    file: 'src/routes/violation.tsx',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden(
        "import CrepeEditorSurface from '../../lib/components/markdown-editor/crepe/crepe-editor-surface';",
      ),
      forbidden(
        "export * from '../../lib/components/markdown-editor/crepe/editor-commands';",
      ),
      allowed(
        "import { MarkdownEditor } from '../../lib/components/markdown-editor/markdown-editor';",
      ),
      forbidden("import { ErrorBoundary } from '@sentry/tanstackstart-react';"),
    ],
  },
  {
    file: 'src/composition/violation.ts',
    statements: [
      ...EDITOR_PACKAGE_STATEMENTS,
      forbidden(
        "import { a } from '../../lib/components/markdown-editor/crepe/editor-commands';",
      ),
      forbidden("import { Route } from '../routes/index';"),
    ],
  },
];

const EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS: readonly StatementCase[] = [
  forbidden("export const loadCrepe = () => import('@milkdown/crepe');"),
  forbidden("export const loadCore = () => import('@milkdown/kit/core');"),
  forbidden("export const loadVue = () => import('vue');"),
  forbidden("export const loadVueDom = () => import('@vue/runtime-dom');"),
  forbidden(
    'export const loadKit = (name: string) => import(`@milkdown/kit/${name}`);',
  ),
  forbidden('export const loadTemplateVue = () => import(`vue`);'),
  allowed("export const loadOther = () => import('vuex-like');"),
];

const LAZY_IMPORT_POSITION_CASES: readonly PositionCase[] = [
  {
    file: 'components/markdown-editor/load-crepe-editor.ts',
    statements: [
      allowed(
        "export const loadSurface = () => import('./crepe/crepe-editor-surface');",
      ),
      allowed(
        'export const loadTemplateSurface = () => import(`./crepe/crepe-editor-surface`);',
      ),
      ...EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS,
      forbidden("document.body.innerHTML = '<p></p>';"),
    ],
  },
  {
    file: 'components/markdown-editor/markdown-editor.tsx',
    statements: [
      forbidden(
        "export const loadSurface = () => import('./crepe/crepe-editor-surface');",
      ),
      forbidden("export const loadCommands = () => import('./crepe');"),
      forbidden(
        'export const loadTemplateSurface = () => import(`./crepe/crepe-editor-surface`);',
      ),
      forbidden(
        'export const loadNamed = (name: string) => import(`./crepe/${name}`);',
      ),
      allowed("export const loadLoader = () => import('./load-crepe-editor');"),
      allowed(
        'export const loadTemplateLoader = () => import(`./load-crepe-editor`);',
      ),
      ...EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS,
      forbidden("document.body.innerHTML = '<p></p>';"),
    ],
  },
  {
    file: 'components/markdown-editor/crepe/crepe-editor-surface.tsx',
    statements: [
      ...allowedEverywhere(EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS),
      allowed("export const loadFeatures = () => import('./editor-features');"),
      forbidden("document.body.innerHTML = '<p></p>';"),
    ],
  },
  {
    file: 'components/markdown/violation.tsx',
    statements: [
      forbidden(
        "export const loadSurface = () => import('../markdown-editor/crepe/crepe-editor-surface');",
      ),
      allowed(
        "export const loadEditor = () => import('../markdown-editor/markdown-editor');",
      ),
      ...EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS,
    ],
  },
  {
    file: 'server/http/violation.ts',
    statements: EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS,
  },
  {
    file: 'src/routes/violation.tsx',
    statements: [
      forbidden(
        "export const loadSurface = () => import('../../lib/components/markdown-editor/crepe/crepe-editor-surface');",
      ),
      forbidden(
        'export const loadNamed = (name: string) => import(`../../lib/components/markdown-editor/crepe/${name}`);',
      ),
      allowed(
        "export const loadLoader = () => import('../../lib/components/markdown-editor/load-crepe-editor');",
      ),
      ...EDITOR_PACKAGE_LAZY_IMPORT_STATEMENTS,
    ],
  },
];

const COMMON_LIB_VALIDATION_IMPORT =
  "import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema';";

const COMMON_LIB_GRAPHEMES_IMPORT =
  "import { countGraphemes } from '../../../common-lib/text/graphemes';";

const COMMON_LIB_POSITION_CASES: readonly PositionCase[] = [
  {
    file: 'components/markdown/violation.tsx',
    statements: [
      forbidden(COMMON_LIB_VALIDATION_IMPORT),
      forbidden(
        "import type { MarkdownTextRule } from '../../../common-lib/validation/markdown-text-schema';",
      ),
      forbidden(
        "export { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema';",
      ),
      allowed(
        "import { renderMarkdown } from '../../../common-lib/markdown/render-markdown';",
      ),
      allowed(COMMON_LIB_GRAPHEMES_IMPORT),
      allowed(
        "import { findHighlightRanges } from '../../../common-lib/search/highlight-ranges';",
      ),
      forbidden("import { a } from '../../../src/composition/relay-routes';"),
    ],
  },
  {
    file: 'components/markdown/violation.browser.test.tsx',
    statements: [
      forbidden(COMMON_LIB_VALIDATION_IMPORT),
      allowed(COMMON_LIB_GRAPHEMES_IMPORT),
    ],
  },
  {
    file: 'server/media/violation.ts',
    statements: [
      forbidden(COMMON_LIB_VALIDATION_IMPORT),
      allowed("import { a } from '../../../common-lib/media/media-types';"),
      allowed(COMMON_LIB_GRAPHEMES_IMPORT),
      forbidden("import { b } from '../../start/query-client';"),
    ],
  },
  {
    file: 'server/media/violation.unit.test.ts',
    statements: [
      forbidden(COMMON_LIB_VALIDATION_IMPORT),
      allowed(COMMON_LIB_GRAPHEMES_IMPORT),
    ],
  },
  {
    file: 'utilities/text/violation.ts',
    statements: [
      allowed(COMMON_LIB_VALIDATION_IMPORT),
      allowed(COMMON_LIB_GRAPHEMES_IMPORT),
      forbidden("import { a } from '../../server/http/csrf';"),
    ],
  },
  {
    file: 'src/routes/violation.tsx',
    statements: [
      allowed(
        "import { markdownTextSchema } from '../../common-lib/validation/markdown-text-schema';",
      ),
      allowed(
        "import { renderMarkdown } from '../../common-lib/markdown/render-markdown';",
      ),
    ],
  },
];

describe('マークダウンの入力欄と共用部品の静的解析の規則', () => {
  describe('エディタの実装の読み込みを遅延読み込みのモジュールに限る', () => {
    test.each(
      EDITOR_POSITION_CASES.map((position) => [position.file, position]),
    )(
      '%sで遅延読み込みのモジュールの外からのエディタのパッケージと静的な読み込みをエラーとして報告する',
      async (_file, position) => {
        expect(await reportedStatementsOf(position, IMPORT_RULE_IDS)).toEqual(
          expectedStatementsOf(position),
        );
      },
      LINT_TIMEOUT_MS,
    );
  });

  describe('遅延読み込みのモジュールの動的importを読み込み関数に限る', () => {
    test.each(
      LAZY_IMPORT_POSITION_CASES.map((position) => [position.file, position]),
    )(
      '%sで遅延読み込みのモジュールの外からのエディタのパッケージと読み込み関数以外からのモジュールの動的import、生のHTMLの挿入をエラーとして報告する',
      async (_file, position) => {
        expect(await reportedStatementsOf(position, SYNTAX_RULE_IDS)).toEqual(
          expectedStatementsOf(position),
        );
      },
      LINT_TIMEOUT_MS,
    );
  });

  describe('共通部品から共用部品の検証規則の読み込みを禁止する', () => {
    test.each(
      COMMON_LIB_POSITION_CASES.map((position) => [position.file, position]),
    )(
      '%sで部品とサーバーの部品からの検証規則の読み込みだけをエラーとして報告する',
      async (_file, position) => {
        expect(await reportedStatementsOf(position, IMPORT_RULE_IDS)).toEqual(
          expectedStatementsOf(position),
        );
      },
      LINT_TIMEOUT_MS,
    );
  });
});

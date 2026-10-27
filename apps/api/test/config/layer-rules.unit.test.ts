import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

type AppName = 'api' | 'event';

interface ImportCase {
  readonly statement: string;
  readonly reported: boolean;
}

interface PositionCase {
  readonly file: string;
  readonly imports: readonly ImportCase[];
}

const APPS_DIR = join(import.meta.dirname, '..', '..', '..');

const LINT_TIMEOUT_MS = 60_000;

const RULE_IDS: ReadonlySet<string | null> = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
]);

const linters = new Map<AppName, ESLint>(
  (['api', 'event'] as const).map((app) => [
    app,
    new ESLint({
      cwd: join(APPS_DIR, app),
      overrideConfigFile: join(APPS_DIR, app, 'eslint.config.ts'),
      // 型情報付きの解析はディスク上に無いファイルを扱えず、importの規則は型情報を使わないため、型情報無しで違反例を検査する
      overrideConfig: tseslint.configs.disableTypeChecked,
    }),
  ]),
);

const forbidden = (statement: string): ImportCase => ({
  statement,
  reported: true,
});

const allowed = (statement: string): ImportCase => ({
  statement,
  reported: false,
});

const REACT_FORBIDDEN_IMPORTS: readonly ImportCase[] = [
  forbidden("import { useState } from 'react';"),
  forbidden("import type { ReactNode } from 'react';"),
  forbidden("import { jsx } from 'react/jsx-runtime';"),
  forbidden("import { renderToString } from 'react-dom/server';"),
  forbidden("import { Html } from '@react-email/components';"),
  forbidden("import { render } from '@react-email/render';"),
  allowed("import { a } from './react-email-renderer-port';"),
];

const SOURCE_LAYER_CASES: readonly PositionCase[] = [
  {
    file: 'src/domain/sample/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { a } from '../../application/sample/use-case';"),
      forbidden("import { b } from '../../infrastructure/sample/repository';"),
      forbidden("import { c } from '../../presentation/sample/route';"),
      forbidden("import { d } from '../../composition/modules';"),
      forbidden("import { Hono } from 'hono';"),
      forbidden("import { e } from 'hono/factory';"),
      forbidden("import { eq } from 'drizzle-orm';"),
      forbidden("import { integer } from 'drizzle-orm/sqlite-core';"),
      forbidden("import { env } from 'cloudflare:workers';"),
      forbidden("import { f } from '../../../lib/workers/http/hono-env';"),
      forbidden("import { g } from '../../../db/schema';"),
      forbidden("import { h } from '../../../db/client';"),
      allowed("import { AppError } from '../../../lib/core/errors/app-error';"),
      allowed("import { Entity } from './entity';"),
      allowed("import { z } from 'zod';"),
    ],
  },
  {
    file: 'src/application/sample/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { a } from '../../infrastructure/sample/repository';"),
      forbidden("import { b } from '../../presentation/sample/route';"),
      forbidden("import { c } from '../../composition/modules';"),
      forbidden("import { Hono } from 'hono';"),
      forbidden("import { env } from 'cloudflare:workers';"),
      forbidden("import { d } from '../../../lib/workers/http/hono-env';"),
      forbidden("import { createDatabase } from '../../../db/client';"),
      allowed("import { Entity } from '../../domain/sample/entity';"),
      allowed("import { AppError } from '../../../lib/core/errors/app-error';"),
      allowed("import { users } from '../../../db/schema';"),
      allowed("import { eq } from 'drizzle-orm';"),
    ],
  },
  {
    file: 'src/infrastructure/sample/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { a } from '../../composition/modules';"),
      allowed("import { Entity } from '../../domain/sample/entity';"),
      allowed("import { UseCase } from '../../application/sample/use-case';"),
      allowed("import { createDatabase } from '../../../db/client';"),
      allowed("import { b } from '../../../lib/workers/http/hono-env';"),
      allowed("import { eq } from 'drizzle-orm';"),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed("import { Hono } from 'hono';"),
    ],
  },
  {
    file: 'src/presentation/sample/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { a } from '../../composition/modules';"),
      allowed("import { UseCase } from '../../application/sample/use-case';"),
      allowed("import { b } from '../../../lib/workers/http/hono-env';"),
      allowed("import { Hono } from 'hono';"),
    ],
  },
  {
    file: 'src/composition/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      allowed(
        "import { Repository } from '../infrastructure/sample/repository';",
      ),
      allowed("import { route } from '../presentation/sample/route';"),
      allowed("import { a } from '../../lib/workers/di/invocation-container';"),
      allowed("import { Hono } from 'hono';"),
    ],
  },
];

const SHARED_CODE_CASES: readonly PositionCase[] = [
  {
    file: 'lib/core/sample/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { a } from '../../workers/http/hono-env';"),
      forbidden("import { Hono } from 'hono';"),
      forbidden("import { env } from 'cloudflare:workers';"),
      forbidden("import { createDatabase } from '../../../db/client';"),
      forbidden("import { users } from '../../../db/schema';"),
      forbidden("import type { c } from '../../workers/http/hono-env';"),
      forbidden("import type { Env } from 'cloudflare:workers';"),
      forbidden("import type { Database } from '../../../db/client';"),
      forbidden("import { MODULES } from '../../../src/composition/modules';"),
      forbidden("import { e } from '../../../src/domain/sample/entity';"),
      allowed("import type { Hono } from 'hono';"),
      allowed("import { b } from '../errors/app-error';"),
      allowed("import { z } from 'zod';"),
      allowed("import { ulid } from 'ulid';"),
    ],
  },
  {
    file: 'lib/workers/sample/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { MODULES } from '../../../src/composition/modules';"),
      forbidden("import { e } from '../../../src/domain/sample/entity';"),
      forbidden(
        "import type { ApiEnv } from '../../../src/composition/env-schema';",
      ),
      allowed("import { a } from '../../core/errors/app-error';"),
      allowed("import { createDatabase } from '../../../db/client';"),
      allowed("import { Hono } from 'hono';"),
      allowed("import { env } from 'cloudflare:workers';"),
    ],
  },
  {
    file: 'db/schema/violation.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      forbidden("import { a } from '../../lib/core/time/clock';"),
      forbidden("import { e } from '../../src/domain/sample/entity';"),
      forbidden("import { Hono } from 'hono';"),
      forbidden("import { env } from 'cloudflare:workers';"),
      forbidden("import { sqliteTable } from 'drizzle-orm/sqlite-core';"),
      forbidden(
        "import { sqliteTableCreator } from 'drizzle-orm/sqlite-core';",
      ),
      allowed("import { integer, snakeCase } from 'drizzle-orm/sqlite-core';"),
      allowed("import { sql } from 'drizzle-orm';"),
      allowed("import { ulid } from 'ulid';"),
      allowed("import { b } from './_shared/columns';"),
    ],
  },
  {
    file: 'db/client.ts',
    imports: [
      forbidden("import { env } from 'cloudflare:workers';"),
      forbidden("import type { Env } from 'cloudflare:workers';"),
      allowed("import { drizzle } from 'drizzle-orm/d1';"),
    ],
  },
  {
    file: 'db/schema/_shared/violation.worker.test.ts',
    imports: [
      forbidden("import { a } from '../../../lib/core/time/clock';"),
      forbidden("import { Hono } from 'hono';"),
      forbidden("import { sqliteTable } from 'drizzle-orm/sqlite-core';"),
      forbidden(
        "import { sqliteTableCreator } from 'drizzle-orm/sqlite-core';",
      ),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed("import { applyD1Migrations } from 'cloudflare:test';"),
      allowed("import { snakeCase } from 'drizzle-orm/sqlite-core';"),
      allowed("import { b } from './columns';"),
    ],
  },
  {
    file: 'db/violation.worker.test.ts',
    imports: [
      forbidden("import { a } from '../lib/core/time/clock';"),
      forbidden("import { Hono } from 'hono';"),
      forbidden("import { sqliteTable } from 'drizzle-orm/sqlite-core';"),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed("import { createDatabase } from './client';"),
    ],
  },
];

const BUN_LOADED_FORBIDDEN_IMPORTS: readonly ImportCase[] = [
  forbidden("import { env } from 'cloudflare:workers';"),
  forbidden("import type { Env } from 'cloudflare:workers';"),
  forbidden("import * as Sentry from '@sentry/cloudflare';"),
  forbidden("import { sentry } from '@sentry/hono';"),
];

const bunLoadedPresentationCase = (
  file: string,
  depth: number,
): PositionCase => {
  const toSrc = '../'.repeat(depth);
  return {
    file,
    imports: [
      ...BUN_LOADED_FORBIDDEN_IMPORTS,
      forbidden(
        `import { Repository } from '${toSrc}infrastructure/sample/repository';`,
      ),
      forbidden(`import { MODULES } from '${toSrc}composition/modules';`),
      allowed("import { buildSchema } from 'graphql';"),
      allowed("import { z } from 'zod';"),
      allowed(`import { UseCase } from '${toSrc}application/sample/use-case';`),
      allowed(
        `import { GATEWAY_HEADERS } from '${toSrc}presentation/gateway/gateway-headers';`,
      ),
      allowed(`import { a } from '${toSrc}../lib/core/errors/app-error';`),
    ],
  };
};

const BUN_LOADED_CASES: readonly PositionCase[] = [
  bunLoadedPresentationCase(
    'src/presentation/graphql/modules/sample/type-defs.ts',
    4,
  ),
  ...[
    'schema-module.ts',
    'schema-composer.ts',
    'platform-type-defs.ts',
    'date-time-scalar.ts',
    'query-limits.ts',
    'error-codes.ts',
  ].map((name) =>
    bunLoadedPresentationCase(`src/presentation/graphql/${name}`, 2),
  ),
  {
    file: 'src/composition/graphql-modules.ts',
    imports: [
      ...BUN_LOADED_FORBIDDEN_IMPORTS,
      forbidden(
        "import { Repository } from '../infrastructure/sample/repository';",
      ),
      allowed(
        "import { systemSchemaModule } from '../presentation/graphql/modules/system/index';",
      ),
      allowed(
        "import { defineSchemaModule } from '../presentation/graphql/schema-module';",
      ),
    ],
  },
  {
    file: 'src/presentation/graphql/modules/sample/index.worker.test.ts',
    imports: [
      forbidden("import { MODULES } from '../../../../composition/modules';"),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed("import { createExecutionContext } from 'cloudflare:test';"),
      allowed(
        "import { Repository } from '../../../../infrastructure/sample/repository';",
      ),
      allowed(
        "import { UseCase } from '../../../../application/sample/use-case';",
      ),
    ],
  },
  {
    file: 'src/presentation/graphql/gateway-server.ts',
    imports: [
      forbidden("import { MODULES } from '../../composition/modules';"),
      allowed("import * as Sentry from '@sentry/cloudflare';"),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed(
        "import { Repository } from '../../infrastructure/sample/repository';",
      ),
    ],
  },
];

const graphqlScriptCase = (
  file: string,
  ...extraImports: readonly ImportCase[]
): PositionCase => ({
  file,
  imports: [
    ...REACT_FORBIDDEN_IMPORTS,
    ...extraImports,
    ...BUN_LOADED_FORBIDDEN_IMPORTS,
    forbidden(
      "import { Repository } from '../../src/infrastructure/sample/repository.ts';",
    ),
    forbidden("import { MODULES } from '../../src/composition/modules.ts';"),
    forbidden(
      "import { UseCase } from '../../src/application/sample/use-case.ts';",
    ),
    forbidden(
      "import { getGatewayServer } from '../../src/presentation/graphql/gateway-server.ts';",
    ),
    forbidden(
      "import { readInternalCaller } from '../../src/presentation/gateway/internal-request.ts';",
    ),
    forbidden(
      "import { createOperationAllowlistPlugin } from '../../src/presentation/graphql/operation-allowlist.ts';",
    ),
    allowed(
      "import type { AllowlistData } from '../../src/presentation/graphql/operation-allowlist.ts';",
    ),
    allowed(
      "import { GRAPHQL_SCHEMA_MODULES } from '../../src/composition/graphql-modules.ts';",
    ),
    allowed(
      "import { systemSchemaModule } from '../../src/presentation/graphql/modules/system/index.ts';",
    ),
    ...[
      'schema-module',
      'schema-composer',
      'platform-type-defs',
      'date-time-scalar',
      'query-limits',
      'error-codes',
    ].map((name) =>
      allowed(`import { a } from '../../src/presentation/graphql/${name}.ts';`),
    ),
    allowed(
      "import { CALLER_KINDS } from '../../src/presentation/gateway/gateway-headers.ts';",
    ),
    allowed("import { buildAllowlist } from './allowlist-builder.ts';"),
    allowed("import { createYoga } from 'graphql-yoga';"),
    allowed("import { readFile } from 'node:fs/promises';"),
  ],
});

const GRAPHQL_SCRIPT_CASES: readonly PositionCase[] = [
  graphqlScriptCase('scripts/graphql/sample.ts'),
  graphqlScriptCase(
    'scripts/graphql/sample.unit.test.ts',
    allowed("import { describe } from 'bun:test';"),
    allowed(
      "import { createLimitTestSchema } from '../../test/support/query-limit-harness.ts';",
    ),
  ),
];

const scriptImportsFrom = (toApi: string): readonly ImportCase[] => [
  forbidden(
    `import { buildAllowlist } from '${toApi}scripts/graphql/allowlist-builder.ts';`,
  ),
  forbidden(
    `import type { PersistedDocuments } from '${toApi}scripts/graphql/allowlist-builder.ts';`,
  ),
  forbidden(`import { a } from '${toApi}scripts/check-migrations';`),
];

const SOURCE_TO_SCRIPT_CASES: readonly PositionCase[] = [
  { file: 'src/index.ts', imports: scriptImportsFrom('../') },
  {
    file: 'src/domain/sample/violation.ts',
    imports: scriptImportsFrom('../../../'),
  },
  {
    file: 'src/composition/violation.ts',
    imports: scriptImportsFrom('../../'),
  },
  {
    file: 'src/presentation/graphql/query-limits.ts',
    imports: scriptImportsFrom('../../../'),
  },
  {
    file: 'src/presentation/graphql/modules/sample/index.worker.test.ts',
    imports: scriptImportsFrom('../../../../../'),
  },
];

const REACT_ALLOWED_IMPORTS: readonly ImportCase[] = [
  allowed("import { useState } from 'react';"),
  allowed("import type { ReactNode } from 'react';"),
  allowed("import { renderToString } from 'react-dom/server';"),
  allowed("import { Html } from '@react-email/components';"),
  allowed("import { render } from '@react-email/render';"),
];

const EVENT_EMAIL_RENDERING_CASES: readonly PositionCase[] = [
  {
    file: 'src/infrastructure/email/rendering/sample-layout.tsx',
    imports: [
      ...REACT_ALLOWED_IMPORTS,
      forbidden("import { MODULES } from '../../../composition/modules';"),
    ],
  },
  {
    file: 'src/infrastructure/email/templates/sample/sample-body.tsx',
    imports: [
      ...REACT_ALLOWED_IMPORTS,
      forbidden("import { MODULES } from '../../../../composition/modules';"),
    ],
  },
  {
    file: 'src/infrastructure/email/providers/sample-provider.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      allowed(
        "import { ReactEmailRenderer } from '../rendering/react-email-renderer';",
      ),
    ],
  },
  {
    file: 'src/application/email/sample-handler.ts',
    imports: REACT_FORBIDDEN_IMPORTS,
  },
  {
    file: 'src/composition/email-module.ts',
    imports: [
      ...REACT_FORBIDDEN_IMPORTS,
      allowed(
        "import { ReactEmailRenderer } from '../infrastructure/email/rendering/react-email-renderer';",
      ),
      allowed(
        "import { EMAIL_TEMPLATES } from '../infrastructure/email/templates/index';",
      ),
    ],
  },
  {
    file: 'src/index.ts',
    imports: REACT_FORBIDDEN_IMPORTS,
  },
];

const API_REACT_CASES: readonly PositionCase[] = [
  'src/infrastructure/email/rendering/sample-layout.tsx',
  'src/infrastructure/email/templates/sample/sample-body.tsx',
  'src/index.ts',
  'test/support/sample-harness.ts',
  'scripts/sample.ts',
  'db/schema/_shared/violation.worker.test.ts',
  'db/client.ts',
  'lib/core/email/sample.unit.test.ts',
  'lib/workers/email/sample.worker.test.ts',
].map((file) => ({ file, imports: REACT_FORBIDDEN_IMPORTS }));

const reportedStatementsOf = async (
  app: AppName,
  { file, imports }: PositionCase,
): Promise<readonly string[]> => {
  const statements = imports.map(({ statement }) => statement);
  const linter = linters.get(app);
  if (linter === undefined) {
    throw new Error(`${app}の静的解析を用意していません。`);
  }
  const [result] = await linter.lintText(`${statements.join('\n')}\n`, {
    filePath: join(APPS_DIR, app, file),
  });
  if (result === undefined) {
    throw new Error(`${file}の静的解析の結果がありません。`);
  }
  expect(result.fatalErrorCount).toBe(0);
  // 1つのimportが複数のパターンに当たると同じ行が複数回報告されるため、報告された行の集合で比べる
  return [
    ...new Set(
      result.messages
        .filter(({ ruleId }) => RULE_IDS.has(ruleId))
        .map(({ line }) => statements[line - 1] ?? ''),
    ),
  ];
};

const expectedStatementsOf = ({ imports }: PositionCase): readonly string[] =>
  imports.filter(({ reported }) => reported).map(({ statement }) => statement);

describe.each(['api', 'event'] as const)('%sの層の依存方向', (app) => {
  test.each(SOURCE_LAYER_CASES.map((position) => [position.file, position]))(
    '%sで外側の層と実行環境への依存だけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf(app, position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

describe('eventのReactとReact Emailの読み込み位置', () => {
  test.each(
    EVENT_EMAIL_RENDERING_CASES.map((position) => [position.file, position]),
  )(
    '%sでメールの描画とテンプレートの位置以外からのReactとReact Emailへの依存だけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('event', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

describe('apiのReactとReact Emailの読み込みの禁止', () => {
  test.each(API_REACT_CASES.map((position) => [position.file, position]))(
    '%sでReactとReact Emailへの依存を型だけの読み込みも含めて報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

describe('apiのBunで読み込むGraphQLのファイルの依存方向', () => {
  test.each(BUN_LOADED_CASES.map((position) => [position.file, position]))(
    '%sで実行環境・Sentry・インフラ層・合成ルートへの許されない依存だけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

describe('apiのGraphQLの生成・検査のスクリプトとsrcの間の依存方向', () => {
  test.each(GRAPHQL_SCRIPT_CASES.map((position) => [position.file, position]))(
    '%sで指定のファイル以外のsrc・実行環境・Sentry・インフラ層への依存と、許可リストのモジュールからの型以外の読み込みだけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );

  test.each(
    SOURCE_TO_SCRIPT_CASES.map((position) => [position.file, position]),
  )(
    '%sからscriptsへの依存を型だけの読み込みも含めて報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

describe('apiの共有コードとDBスキーマの依存方向', () => {
  test.each(SHARED_CODE_CASES.map((position) => [position.file, position]))(
    '%sで許されない依存だけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

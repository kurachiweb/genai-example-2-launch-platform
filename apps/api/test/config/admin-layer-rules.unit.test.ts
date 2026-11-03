import { describe, expect, test } from 'bun:test';

import {
  allowed,
  expectedStatementsOf,
  forbidden,
  identityImportsFromAuth,
  type ImportCase,
  LINT_TIMEOUT_MS,
  type PositionCase,
  reportedStatementsOf,
} from '../support/layer-lint.ts';

const identityImportsFromAdmin = (toSrc: string): readonly ImportCase[] => [
  ...identityImportsFromAuth(toSrc),
  forbidden(
    `import type { IdentitySettings } from '${toSrc}application/identity/ports';`,
  ),
  allowed(`import { a } from '${toSrc}../lib/core/admin/identifiers';`),
];

const ADMIN_LAYER_CASES: readonly PositionCase[] = [
  {
    file: 'src/domain/admin/violation.ts',
    imports: [
      ...identityImportsFromAdmin('../../'),
      forbidden("import { f } from '../identity/handle';"),
      forbidden("import { f } from '../identity';"),
      forbidden("import { f } from './identity/handle';"),
      forbidden("import { g } from '../../application/admin/ports';"),
      forbidden("import { eq } from 'drizzle-orm';"),
      allowed("import { h } from '../auth/session-policy';"),
      allowed("import { i } from './admin-account';"),
    ],
  },
  {
    file: 'src/application/admin/violation.ts',
    imports: [
      ...identityImportsFromAdmin('../../'),
      forbidden("import { IDENTITY_TYPES } from '../identity/identity-types';"),
      forbidden("import { f } from '../../../lib/workers/http/hono-env';"),
      forbidden(
        "import { D1AdminDirectory } from '../../../lib/workers/admin/d1-admin-directory';",
      ),
      forbidden("import { g } from '../../infrastructure/admin/d1-store';"),
      forbidden("import { MODULES } from '../../composition/modules';"),
      allowed("import { h } from '../auth/auth-errors';"),
      allowed("import { AUTH_TYPES } from '../auth/auth-types';"),
      allowed("import { i } from '../../domain/admin/admin-account';"),
      allowed("import { k } from '../../../common-lib/admin/admin-roles';"),
    ],
  },
  {
    file: 'src/application/admin/testing/violation.ts',
    imports: [
      ...identityImportsFromAdmin('../../../'),
      forbidden(
        "import { IDENTITY_TYPES } from '../../identity/identity-types';",
      ),
      allowed("import { ADMIN_TYPES } from '../admin-types';"),
    ],
  },
  {
    file: 'src/application/admin/testing/nested/violation.ts',
    imports: [
      ...identityImportsFromAdmin('../../../../'),
      forbidden(
        "import { IDENTITY_TYPES } from '../../../identity/identity-types';",
      ),
      forbidden("import { f } from '../../../identity';"),
      allowed("import { ADMIN_TYPES } from '../../admin-types';"),
    ],
  },
  {
    file: 'src/infrastructure/admin/violation.ts',
    imports: [
      ...identityImportsFromAdmin('../../'),
      forbidden("import { f } from '../identity/d1-user-account-store';"),
      forbidden("import { MODULES } from '../../composition/modules';"),
      allowed("import { g } from '../auth/mail-send-counters';"),
      allowed("import { h } from '../../application/admin/ports';"),
      allowed("import { i } from '../../../lib/workers/http/hono-env';"),
      allowed("import { createDatabase } from '../../../db/client';"),
      allowed("import { users } from '../../../db/schema/identity/users';"),
      allowed(
        "import { j } from '../../../lib/workers/identity/d1-user-contact-directory';",
      ),
    ],
  },
  {
    file: 'src/infrastructure/admin/testing/violation.ts',
    imports: [
      ...identityImportsFromAdmin('../../../'),
      forbidden("import { f } from '../../identity/d1-user-account-store';"),
      allowed("import { g } from '../d1-admin-account-store';"),
    ],
  },
  {
    file: 'src/presentation/graphql/admin-guard.ts',
    imports: [
      ...identityImportsFromAdmin('../../'),
      forbidden("import { MODULES } from '../../composition/modules';"),
      forbidden("import { f } from './modules/identity/index';"),
      forbidden("import { g } from './modules/identity';"),
      allowed("import { a } from './graphql-context';"),
      allowed("import { c } from './modules/admin/index';"),
      allowed("import { b } from '../../application/admin/admin-authorizer';"),
    ],
  },
  {
    file: 'src/presentation/graphql/modules/admin/index.ts',
    imports: [
      ...identityImportsFromAdmin('../../../../'),
      forbidden("import { f } from '../identity/index';"),
      forbidden("import { f } from '../identity';"),
      forbidden("import { MODULES } from '../../../../composition/modules';"),
      forbidden(
        "import { g } from '../../../../infrastructure/admin/d1-store';",
      ),
      forbidden("import { env } from 'cloudflare:workers';"),
      allowed("import { h } from '../../admin-guard';"),
      allowed("import { i } from '../../../../application/admin/admin-types';"),
    ],
  },
  {
    file: 'src/presentation/graphql/modules/admin/index.worker.test.ts',
    imports: [
      ...identityImportsFromAdmin('../../../../'),
      forbidden("import { f } from '../identity/index';"),
      forbidden("import { MODULES } from '../../../../composition/modules';"),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed("import { g } from '../../../../infrastructure/admin/d1-store';"),
    ],
  },
  {
    file: 'src/composition/admin-module.ts',
    imports: [
      ...identityImportsFromAdmin('../'),
      forbidden("import { IDENTITY_MODULE } from './identity-module';"),
      forbidden("import { a } from './identity-registrations';"),
      allowed("import { b } from '../infrastructure/admin/d1-store';"),
      allowed("import { c } from './env-schema';"),
    ],
  },
];

// 管理者の禁止は管理者の各層だけに当て、利用者の各層と合成ルートの読み込みを変えない
const UNRESTRICTED_CASES: readonly PositionCase[] = [
  {
    file: 'src/application/identity/violation.ts',
    imports: [
      allowed("import { a } from '../identity/identity-types';"),
      allowed("import { b } from '../auth/auth-errors';"),
    ],
  },
  {
    file: 'src/composition/violation.ts',
    imports: [
      allowed("import { a } from '../application/identity/identity-types';"),
      allowed("import { b } from '../application/admin/admin-types';"),
    ],
  },
];

describe('apiの管理者のモジュールから利用者のモジュールへの依存方向', () => {
  test.each(ADMIN_LAYER_CASES.map((position) => [position.file, position]))(
    '%sで利用者のモジュールへの依存と、その層の層の規則の違反だけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );

  test.each(UNRESTRICTED_CASES.map((position) => [position.file, position]))(
    '%sでは利用者のモジュールと管理者のモジュールの読み込みを報告しない',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

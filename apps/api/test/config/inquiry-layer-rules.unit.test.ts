import { describe, expect, test } from 'bun:test';

import {
  allowed,
  expectedStatementsOf,
  forbidden,
  type ImportCase,
  LINT_TIMEOUT_MS,
  type PositionCase,
  reportedStatementsOf,
} from '../support/layer-lint.ts';

const foreignImportsFromInquiry = (toSrc: string): readonly ImportCase[] => [
  forbidden(`import { a } from '${toSrc}domain/identity/handle';`),
  forbidden(`import { b } from '${toSrc}domain/admin/admin-account';`),
  forbidden(`import type { c } from '${toSrc}application/identity/ports';`),
  forbidden(`import type { d } from '${toSrc}application/admin/ports.ts';`),
  forbidden(
    `import { e } from '${toSrc}infrastructure/identity/d1-user-account-store';`,
  ),
  forbidden(
    `import { f } from '${toSrc}infrastructure/admin/d1-audit-log-store.ts';`,
  ),
  forbidden(
    `import { g } from '${toSrc}presentation/graphql/modules/identity/index';`,
  ),
  forbidden(
    `import { h } from '${toSrc}presentation/graphql/modules/admin/index.ts';`,
  ),
  allowed(
    `import { checkNickname } from '${toSrc}../common-lib/identity/account-input-rules';`,
  ),
  allowed(
    `import { i } from '${toSrc}../common-lib/admin/audit-actions/inquiry-chat.ts';`,
  ),
  allowed(
    `import type { AccountGuard } from '${toSrc}../lib/core/identity/account-guard.ts';`,
  ),
  allowed(
    `import { ADMIN_PLATFORM_TYPES } from '${toSrc}../lib/core/admin/identifiers.ts';`,
  ),
];

const INQUIRY_LAYER_CASES: readonly PositionCase[] = [
  {
    file: 'src/domain/inquiry/violation.ts',
    imports: [
      ...foreignImportsFromInquiry('../../'),
      forbidden("import { a } from '../identity/handle';"),
      forbidden("import { b } from '../admin/admin-account.ts';"),
      forbidden("import { c } from '../identity';"),
      forbidden("import { d } from '../admin';"),
      forbidden("import { e } from './admin/rules';"),
      forbidden("import { f } from '../../application/inquiry/ports';"),
      forbidden("import { eq } from 'drizzle-orm';"),
      allowed("import { g } from './inquiry-status-rules.ts';"),
      allowed("import { h } from '../auth/session-policy';"),
    ],
  },
  {
    file: 'src/application/inquiry/violation.ts',
    imports: [
      ...foreignImportsFromInquiry('../../'),
      forbidden("import { IDENTITY_TYPES } from '../identity/identity-types';"),
      forbidden("import { ADMIN_TYPES } from '../admin/admin-types.ts';"),
      forbidden(
        "import { StoreAuditLogRecorder } from '../admin/audit-log-recorder.ts';",
      ),
      forbidden(
        "import { f } from '../admin/audit-log-statements-like-name.ts';",
      ),
      forbidden(
        "import { g } from '../../../lib/workers/identity/d1-user-contact-directory.ts';",
      ),
      forbidden(
        "import { h } from '../../infrastructure/inquiry/d1-member-inquiry-store.ts';",
      ),
      forbidden("import { MODULES } from '../../composition/modules.ts';"),
      allowed("import { i } from '../../domain/inquiry/inquiry-status-rules';"),
      allowed(
        "import type { FileReadPolicy } from '../media/file-access-policies.ts';",
      ),
      allowed(
        "import { j } from '../../../common-lib/inquiry/inquiry-input-rules.ts';",
      ),
      allowed(
        "import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';",
      ),
    ],
  },
  {
    file: 'src/application/inquiry/jobs/violation.ts',
    imports: [
      ...foreignImportsFromInquiry('../../../'),
      forbidden(
        "import { IDENTITY_TYPES } from '../../identity/identity-types';",
      ),
      forbidden("import { ADMIN_TYPES } from '../../admin/admin-types.ts';"),
      allowed("import { INQUIRY_TYPES } from '../inquiry-types.ts';"),
      allowed(
        "import type { ScheduledJobHandler } from '../../../../lib/core/scheduling/cron-registry.ts';",
      ),
    ],
  },
  {
    file: 'src/infrastructure/inquiry/violation.ts',
    imports: [
      ...foreignImportsFromInquiry('../../'),
      allowed(
        "import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';",
      ),
      allowed(
        "import { isAuditGuardRejection } from '../admin/audit-log-statements';",
      ),
      allowed(
        "import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';",
      ),
      allowed(
        "import { k } from '../../infrastructure/admin/audit-log-statements.ts';",
      ),
      forbidden("import { a } from '../admin/d1-audit-log-store.ts';"),
      forbidden(
        "import { b } from '../identity/d1-user-lifecycle-committer.ts';",
      ),
      forbidden(
        "import { c } from '../admin/testing/admin-store-fixtures.ts';",
      ),
      forbidden(
        "import { d } from '../identity/user-lifecycle-sync-handler-extra.ts';",
      ),
      forbidden(
        "import { e } from '../../application/admin/audit-log-statements.ts';",
      ),
      forbidden("import { f } from '../admin';"),
      forbidden("import { MODULES } from '../../composition/modules.ts';"),
      allowed("import { users } from '../../../db/schema/identity/users.ts';"),
      allowed(
        "import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';",
      ),
      allowed(
        "import { insertUser } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';",
      ),
      allowed(
        "import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';",
      ),
      allowed("import { g } from '../../application/inquiry/ports.ts';"),
      allowed("import { h } from '../media/owner-only-file-read-policy.ts';"),
      allowed("import { env } from 'cloudflare:workers';"),
    ],
  },
  {
    file: 'src/infrastructure/inquiry/testing/violation.ts',
    imports: [
      ...foreignImportsFromInquiry('../../../'),
      allowed(
        "import { buildAuditLogStatements } from '../../admin/audit-log-statements.ts';",
      ),
      forbidden(
        "import { insertAdmin } from '../../admin/testing/admin-store-fixtures.ts';",
      ),
      forbidden("import { a } from '../../identity/d1-user-account-store.ts';"),
      allowed(
        "import { userIdOf } from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';",
      ),
      allowed(
        "import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';",
      ),
      allowed(
        "import type { AuditTargetKind } from '../../../../common-lib/admin/audit-action.ts';",
      ),
    ],
  },
  {
    file: 'src/infrastructure/inquiry/violation.worker.test.ts',
    imports: [
      ...foreignImportsFromInquiry('../../'),
      allowed(
        "import { isAuditGuardRejection } from '../admin/audit-log-statements.ts';",
      ),
      forbidden(
        "import { a } from '../identity/d1-user-lifecycle-committer.ts';",
      ),
      allowed("import { env } from 'cloudflare:workers';"),
    ],
  },
  {
    file: 'src/presentation/graphql/modules/inquiry/index.ts',
    imports: [
      ...foreignImportsFromInquiry('../../../../'),
      allowed("import { requireAdmin } from '../../admin-guard.ts';"),
      allowed("import { a } from '../../graphql-context.ts';"),
      allowed(
        "import { INQUIRY_TYPES } from '../../../../application/inquiry/inquiry-types.ts';",
      ),
      forbidden("import { b } from '../identity/index';"),
      forbidden("import { c } from '../admin/index.ts';"),
      forbidden("import { d } from '../admin';"),
      forbidden(
        "import { e } from '../../../../application/admin/admin-authorizer.ts';",
      ),
      forbidden(
        "import { f } from '../../../../infrastructure/inquiry/d1-member-inquiry-store.ts';",
      ),
      forbidden("import { env } from 'cloudflare:workers';"),
      forbidden(
        "import { MODULES } from '../../../../composition/modules.ts';",
      ),
    ],
  },
  {
    file: 'src/presentation/graphql/modules/inquiry/index.worker.test.ts',
    imports: [
      ...foreignImportsFromInquiry('../../../../'),
      forbidden("import { a } from '../identity/index';"),
      forbidden("import { b } from '../admin/index.ts';"),
      forbidden(
        "import { MODULES } from '../../../../composition/modules.ts';",
      ),
      allowed("import { requireAdmin } from '../../admin-guard.ts';"),
      allowed("import { env } from 'cloudflare:workers';"),
      allowed(
        "import { c } from '../../../../infrastructure/inquiry/testing/inquiry-store-fixtures.ts';",
      ),
    ],
  },
];

// 問い合わせの禁止は問い合わせの各層だけに当て、利用者・管理者の各層と合成ルートの読み込みを変えない
const UNRESTRICTED_CASES: readonly PositionCase[] = [
  {
    file: 'src/infrastructure/identity/violation.ts',
    imports: [
      allowed("import { a } from './d1-user-lifecycle-committer.ts';"),
      allowed("import { b } from '../admin/d1-audit-log-store.ts';"),
    ],
  },
  {
    file: 'src/composition/violation.ts',
    imports: [
      allowed("import { a } from '../application/identity/identity-types';"),
      allowed("import { b } from '../application/admin/admin-types';"),
      allowed("import { c } from '../application/inquiry/inquiry-types';"),
    ],
  },
];

describe('apiの問い合わせのモジュールから利用者・管理者のモジュールへの依存方向', () => {
  test.each(INQUIRY_LAYER_CASES.map((position) => [position.file, position]))(
    '%sで利用者・管理者のモジュールへの依存と、その層の層の規則の違反だけを報告する',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );

  test.each(UNRESTRICTED_CASES.map((position) => [position.file, position]))(
    '%sでは利用者・管理者・問い合わせのモジュールの読み込みを報告しない',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});

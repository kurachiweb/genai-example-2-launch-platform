import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  REPORT_CATEGORY_CREATE_ACTION,
  REPORT_CATEGORY_DELETE_ACTION,
  REPORT_CATEGORY_RENAME_ACTION,
} from '../../../../../common-lib/admin/audit-actions/content-reporting.ts';
import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../../../common-lib/reporting/report-rules.ts';
import { adminAuditLogTargets } from '../../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../../db/schema/admin/admin-audit-logs.ts';
import { reportCases } from '../../../../../db/schema/reporting/report-cases.ts';
import { reportCategories } from '../../../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../../../db/schema/reporting/reports.ts';
import { issueAdminSession } from '../../../../../test/support/admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayCallOptions,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  detailsOf,
} from '../../../../../test/support/payments-graphql-operations.ts';
import {
  adminIdOf,
  clearAdminTables,
  db,
  insertAdmin,
} from '../../../../infrastructure/admin/testing/admin-store-fixtures.ts';
import { reportingSchemaModule } from './index.ts';

interface AdminReportCategoryFields {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly infringement: boolean;
  readonly reportCount: number;
}

const CATEGORY_FIELDS = /* GraphQL */ `
  fragment AdminReportCategoryFields on AdminReportCategory {
    id
    name
    systemDefault
    infringement
    reportCount
  }
`;

const ADMIN_REPORT_CATEGORIES = /* GraphQL */ `
  query AdminReportCategories {
    adminReportCategories {
      ...AdminReportCategoryFields
    }
  }
  ${CATEGORY_FIELDS}
`;

const CREATE_REPORT_CATEGORY = /* GraphQL */ `
  mutation CreateReportCategory($name: String!, $reason: String) {
    createReportCategory(name: $name, reason: $reason) {
      ...AdminReportCategoryFields
    }
  }
  ${CATEGORY_FIELDS}
`;

const RENAME_REPORT_CATEGORY = /* GraphQL */ `
  mutation RenameReportCategory($id: ID!, $name: String!, $reason: String) {
    renameReportCategory(id: $id, name: $name, reason: $reason) {
      ...AdminReportCategoryFields
    }
  }
  ${CATEGORY_FIELDS}
`;

const DELETE_REPORT_CATEGORY = /* GraphQL */ `
  mutation DeleteReportCategory($id: ID!, $reason: String) {
    deleteReportCategory(id: $id, reason: $reason) {
      reassignedCount
    }
  }
`;

const gateway = createGraphQLGateway({
  documents: [
    ADMIN_REPORT_CATEGORIES,
    CREATE_REPORT_CATEGORY,
    RENAME_REPORT_CATEGORY,
    DELETE_REPORT_CATEGORY,
  ],
  schemaModules: [reportingSchemaModule],
});

const ADMIN_ROLES: readonly (readonly [number, AdminRole])[] = [
  [1, 'super_admin'],
  [2, 'moderator'],
  [3, 'viewer'],
];

const sessionTokens = new Map<AdminRole, string>();

const asRole = (role: AdminRole): GatewayCallOptions => ({
  caller: 'admin',
  sessionToken: sessionTokens.get(role),
});

const asClient = (role: AdminRole): GatewayCallOptions => ({
  caller: 'client',
  sessionToken: sessionTokens.get(role),
});

const T0 = new Date('2026-11-22T00:00:00.000Z');

const after = (milliseconds: number): Date =>
  new Date(T0.getTime() + milliseconds);

const idOf = (prefix: string, index: number): string =>
  `${prefix}${String(index).padStart(17, '0')}`;

const categoryIdOf = (index: number): string => idOf('01JE5CTGY', index);

const caseIdOf = (index: number): string => idOf('01JE5CASE', index);

const reportIdOf = (index: number): string => idOf('01JE5RPRT', index);

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const TOO_LONG_NAME = 'あ'.repeat(31);

const TOO_LONG_REASON = 'あ'.repeat(501);

const INFRINGEMENT_CATEGORY: AdminReportCategoryFields = {
  id: REPORT_CATEGORY_INFRINGEMENT_ID,
  name: REPORT_CATEGORY_INFRINGEMENT_NAME,
  systemDefault: true,
  infringement: true,
  reportCount: 0,
};

const OTHER_CATEGORY: AdminReportCategoryFields = {
  id: REPORT_CATEGORY_OTHER_ID,
  name: REPORT_CATEGORY_OTHER_NAME,
  systemDefault: true,
  infringement: false,
  reportCount: 0,
};

async function insertCategory(
  index: number,
  name: string,
  createdAt: Date = T0,
): Promise<void> {
  await db.insert(reportCategories).values({
    id: categoryIdOf(index),
    name,
    createdAt,
    updatedAt: createdAt,
  });
}

async function insertCase(): Promise<void> {
  await db.insert(reportCases).values({
    id: caseIdOf(1),
    targetKind: 'product',
    targetId: idOf('01JE5PRDT', 1),
    productId: idOf('01JE5PRDT', 1),
    statusChangedAt: T0,
    lastReportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function insertReport(
  index: number,
  category: { readonly id: string; readonly name: string },
  columns: { readonly deletedAt?: Date } = {},
): Promise<void> {
  await db.insert(reports).values({
    id: reportIdOf(index),
    caseId: caseIdOf(1),
    categoryId: category.id,
    categoryName: category.name,
    reason: `通報の理由${String(index)}`,
    reportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

async function readCategoryNames(): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: reportCategories.id, name: reportCategories.name })
    .from(reportCategories);
  return Object.fromEntries(rows.map(({ id, name }) => [id, name]));
}

async function readReportCategoryIds(): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: reports.id, categoryId: reports.categoryId })
    .from(reports)
    .orderBy(asc(reports.id));
  return Object.fromEntries(rows.map(({ id, categoryId }) => [id, categoryId]));
}

async function readAudits() {
  const logs = await db
    .select()
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
  const targets = await db.select().from(adminAuditLogTargets);
  return logs.map((log) => ({
    operatorAdminId: log.operatorAdminId,
    action: log.action,
    reason: log.reason,
    detail: log.detail,
    targetIds: targets
      .filter(({ logId }) => logId === log.id)
      .map(({ targetId }) => targetId),
  }));
}

function fetchCategories(options: GatewayCallOptions) {
  return gateway.call<{
    adminReportCategories: AdminReportCategoryFields[] | null;
  }>(ADMIN_REPORT_CATEGORIES, {}, options);
}

function createCategory(
  variables: { readonly name: string; readonly reason?: string },
  options: GatewayCallOptions,
) {
  return gateway.call<{
    createReportCategory: AdminReportCategoryFields | null;
  }>(CREATE_REPORT_CATEGORY, variables, options);
}

function renameCategory(
  variables: {
    readonly id: string;
    readonly name: string;
    readonly reason?: string;
  },
  options: GatewayCallOptions,
) {
  return gateway.call<{
    renameReportCategory: AdminReportCategoryFields | null;
  }>(RENAME_REPORT_CATEGORY, variables, options);
}

function deleteCategory(
  variables: { readonly id: string; readonly reason?: string },
  options: GatewayCallOptions,
) {
  return gateway.call<{
    deleteReportCategory: { readonly reassignedCount: number } | null;
  }>(DELETE_REPORT_CATEGORY, variables, options);
}

// 標準カテゴリはマイグレーションの初期データで常に入るため残し、それ以外の行と監査ログ・管理者を消す
beforeEach(async () => {
  await db.batch([
    db.delete(reports),
    db.delete(reportCases),
    db
      .delete(reportCategories)
      .where(eq(reportCategories.systemDefault, false)),
  ]);
  await clearAdminTables();
  sessionTokens.clear();
  for (const [index, role] of ADMIN_ROLES) {
    await insertAdmin(index, { role });
    const issued = await issueAdminSession(adminIdOf(index));
    sessionTokens.set(role, issued.token);
  }
});

describe('adminReportCategories', () => {
  test.each(['viewer', 'moderator', 'super_admin'] as const)(
    '%sの管理者に、追加したカテゴリを作成日時の順に並べ「権利侵害」「その他」をこの順で末尾に置いて、論理削除した通報を含む件数とともに返す',
    async (role) => {
      await insertCategory(2, 'スパム', after(2_000));
      await insertCategory(1, '不適切な表現', after(1_000));
      await insertCase();
      await insertReport(1, { id: categoryIdOf(1), name: '不適切な表現' });
      await insertReport(
        2,
        { id: categoryIdOf(1), name: '不適切な表現' },
        { deletedAt: after(3_000) },
      );
      await insertReport(3, {
        id: REPORT_CATEGORY_OTHER_ID,
        name: REPORT_CATEGORY_OTHER_NAME,
      });

      const response = await fetchCategories(asRole(role));

      expect(response.errors).toBeUndefined();
      expect(response.data?.adminReportCategories).toStrictEqual([
        {
          id: categoryIdOf(1),
          name: '不適切な表現',
          systemDefault: false,
          infringement: false,
          reportCount: 2,
        },
        {
          id: categoryIdOf(2),
          name: 'スパム',
          systemDefault: false,
          infringement: false,
          reportCount: 0,
        },
        INFRINGEMENT_CATEGORY,
        { ...OTHER_CATEGORY, reportCount: 1 },
      ]);
    },
  );

  test('利用者側の呼び出し元からはforbiddenで拒否する', async () => {
    const response = await fetchCategories(asClient('super_admin'));

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(response.data?.adminReportCategories ?? null).toBeNull();
  });

  test('管理者のセッションが無ければunauthenticatedで拒否する', async () => {
    const response = await fetchCategories({ caller: 'admin' });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('createReportCategory', () => {
  test('モデレーターが追加したカテゴリを前後の空白を除いた名前と件数0で返し、理由とともに監査ログに残す', async () => {
    const response = await createCategory(
      { name: '  スパム  ', reason: '問い合わせの多い分類のため' },
      asRole('moderator'),
    );

    expect(response.errors).toBeUndefined();
    const created = response.data?.createReportCategory;
    expect(created).toStrictEqual({
      id: expect.stringMatching(ULID_PATTERN) as string,
      name: 'スパム',
      systemDefault: false,
      infringement: false,
      reportCount: 0,
    });
    const createdId = created?.id ?? '';
    expect(await readCategoryNames()).toEqual(
      expect.objectContaining({ [createdId]: 'スパム' }),
    );
    expect(await readAudits()).toEqual([
      {
        operatorAdminId: adminIdOf(2),
        action: REPORT_CATEGORY_CREATE_ACTION.name,
        reason: '問い合わせの多い分類のため',
        detail: {},
        targetIds: [createdId],
      },
    ]);
  });

  test('理由を送らない追加は理由の無い監査ログを残す', async () => {
    const response = await createCategory(
      { name: 'スパム' },
      asRole('super_admin'),
    );

    expect(response.errors).toBeUndefined();
    expect(await readAudits()).toEqual([
      expect.objectContaining({
        operatorAdminId: adminIdOf(1),
        action: REPORT_CATEGORY_CREATE_ACTION.name,
        reason: null,
      }),
    ]);
  });

  test('閲覧のみの管理者をforbiddenで拒否し、追加しない', async () => {
    const response = await createCategory({ name: 'スパム' }, asRole('viewer'));

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(Object.values(await readCategoryNames())).not.toContain('スパム');
    expect(await readAudits()).toEqual([]);
  });

  test('利用者側の呼び出し元を名前の検証より前にforbiddenで拒否する', async () => {
    const response = await createCategory(
      { name: TOO_LONG_NAME },
      asClient('super_admin'),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(detailsOf(response)).toEqual([]);
  });

  test('大文字小文字だけが違う同じ名前をreport_category_name_takenで拒否し、名前の欄の詳細を付ける', async () => {
    await insertCategory(1, 'Spam');

    const response = await createCategory(
      { name: 'SPAM' },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['report_category_name_taken']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'name',
        code: 'name-taken',
        message: '同じ名前のカテゴリがあります。',
      },
    ]);
    expect(await readAudits()).toEqual([]);
  });

  test('標準カテゴリと同じ名前をreport_category_name_takenで拒否する', async () => {
    const response = await createCategory(
      { name: REPORT_CATEGORY_OTHER_NAME },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['report_category_name_taken']);
  });

  test('空白だけの名前を名前の欄のvalidation_errorで拒否する', async () => {
    const response = await createCategory(
      { name: ' \n ' },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'name',
        code: 'empty',
        message: 'カテゴリ名を入力してください。',
      },
    ]);
    expect(await readAudits()).toEqual([]);
  });

  test('31文字の名前を名前の欄のvalidation_errorで拒否する', async () => {
    const response = await createCategory(
      { name: TOO_LONG_NAME },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'name',
        message: 'カテゴリ名は30文字以内で入力してください。',
      }),
    ]);
  });

  test('501文字の理由を理由の欄のvalidation_errorで拒否し、追加しない', async () => {
    const response = await createCategory(
      { name: 'スパム', reason: TOO_LONG_REASON },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'reason',
        message: '理由は500文字以内で入力してください。',
      }),
    ]);
    expect(Object.values(await readCategoryNames())).not.toContain('スパム');
  });
});

describe('renameReportCategory', () => {
  test('モデレーターが変えた名前を紐付く通報の件数とともに返し、監査ログに残す', async () => {
    await insertCategory(1, 'スパム');
    await insertCase();
    await insertReport(1, { id: categoryIdOf(1), name: 'スパム' });

    const response = await renameCategory(
      {
        id: categoryIdOf(1),
        name: ' 迷惑な宣伝 ',
        reason: '名前を分かりやすくする',
      },
      asRole('moderator'),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.renameReportCategory).toStrictEqual({
      id: categoryIdOf(1),
      name: '迷惑な宣伝',
      systemDefault: false,
      infringement: false,
      reportCount: 1,
    });
    expect(await readCategoryNames()).toEqual(
      expect.objectContaining({ [categoryIdOf(1)]: '迷惑な宣伝' }),
    );
    expect(await readAudits()).toEqual([
      {
        operatorAdminId: adminIdOf(2),
        action: REPORT_CATEGORY_RENAME_ACTION.name,
        reason: '名前を分かりやすくする',
        detail: {},
        targetIds: [categoryIdOf(1)],
      },
    ]);
  });

  test('閲覧のみの管理者をforbiddenで拒否し、名前を変えない', async () => {
    await insertCategory(1, 'スパム');

    const response = await renameCategory(
      { id: categoryIdOf(1), name: '迷惑な宣伝' },
      asRole('viewer'),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readCategoryNames()).toEqual(
      expect.objectContaining({ [categoryIdOf(1)]: 'スパム' }),
    );
  });

  test('利用者側の呼び出し元をIDの検証より前にforbiddenで拒否する', async () => {
    const response = await renameCategory(
      { id: 'not-a-ulid', name: '迷惑な宣伝' },
      asClient('super_admin'),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });

  test.each([
    ['権利侵害', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['その他', REPORT_CATEGORY_OTHER_ID],
  ])(
    '標準カテゴリ(%s)の名前の変更をreport_category_protectedで拒否する',
    async (_label, id) => {
      const response = await renameCategory(
        { id, name: '迷惑な宣伝' },
        asRole('moderator'),
      );

      expect(codesOf(response)).toEqual(['report_category_protected']);
      expect(await readAudits()).toEqual([]);
    },
  );

  test('存在しないカテゴリをreport_category_not_foundで拒否する', async () => {
    const response = await renameCategory(
      { id: categoryIdOf(99), name: '迷惑な宣伝' },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['report_category_not_found']);
  });

  test('形式の違うIDをカテゴリが見つからない文言のvalidation_errorで拒否する', async () => {
    const response = await renameCategory(
      { id: 'not-a-ulid', name: '迷惑な宣伝' },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({
        field: 'id',
        message: 'カテゴリが見つかりません。',
      }),
    ]);
  });

  test('他のカテゴリと同じ名前をreport_category_name_takenで拒否する', async () => {
    await insertCategory(1, 'スパム');
    await insertCategory(2, '迷惑な宣伝');

    const response = await renameCategory(
      { id: categoryIdOf(1), name: '迷惑な宣伝' },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['report_category_name_taken']);
    expect(await readCategoryNames()).toEqual(
      expect.objectContaining({ [categoryIdOf(1)]: 'スパム' }),
    );
  });

  test('空の名前を名前の欄のvalidation_errorで拒否する', async () => {
    await insertCategory(1, 'スパム');

    const response = await renameCategory(
      { id: categoryIdOf(1), name: '' },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      expect.objectContaining({ field: 'name', code: 'empty' }),
    ]);
  });
});

describe('deleteReportCategory', () => {
  test('モデレーターが削除したカテゴリの通報を論理削除したものも含めて「その他」へ付け替え、件数を返して監査ログに残す', async () => {
    await insertCategory(1, 'スパム');
    await insertCase();
    await insertReport(1, { id: categoryIdOf(1), name: 'スパム' });
    await insertReport(
      2,
      { id: categoryIdOf(1), name: 'スパム' },
      { deletedAt: after(1_000) },
    );

    const response = await deleteCategory(
      { id: categoryIdOf(1), reason: '分類を統合するため' },
      asRole('moderator'),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteReportCategory).toStrictEqual({
      reassignedCount: 2,
    });
    expect(await readCategoryNames()).not.toHaveProperty(categoryIdOf(1));
    expect(await readReportCategoryIds()).toEqual({
      [reportIdOf(1)]: REPORT_CATEGORY_OTHER_ID,
      [reportIdOf(2)]: REPORT_CATEGORY_OTHER_ID,
    });
    expect(await readAudits()).toEqual([
      {
        operatorAdminId: adminIdOf(2),
        action: REPORT_CATEGORY_DELETE_ACTION.name,
        reason: '分類を統合するため',
        detail: { reassignedCount: '2' },
        targetIds: [categoryIdOf(1)],
      },
    ]);
  });

  test('閲覧のみの管理者をforbiddenで拒否し、削除しない', async () => {
    await insertCategory(1, 'スパム');

    const response = await deleteCategory(
      { id: categoryIdOf(1) },
      asRole('viewer'),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readCategoryNames()).toHaveProperty(categoryIdOf(1));
  });

  test('利用者側の呼び出し元をforbiddenで拒否する', async () => {
    await insertCategory(1, 'スパム');

    const response = await deleteCategory(
      { id: categoryIdOf(1) },
      asClient('super_admin'),
    );

    expect(codesOf(response)).toEqual(['forbidden']);
    expect(await readCategoryNames()).toHaveProperty(categoryIdOf(1));
  });

  test.each([
    ['権利侵害', REPORT_CATEGORY_INFRINGEMENT_ID],
    ['その他', REPORT_CATEGORY_OTHER_ID],
  ])(
    '標準カテゴリ(%s)の削除をreport_category_protectedで拒否する',
    async (_label, id) => {
      const response = await deleteCategory({ id }, asRole('moderator'));

      expect(codesOf(response)).toEqual(['report_category_protected']);
      expect(await readCategoryNames()).toHaveProperty(id);
      expect(await readAudits()).toEqual([]);
    },
  );

  test('存在しないカテゴリをreport_category_not_foundで拒否する', async () => {
    const response = await deleteCategory(
      { id: categoryIdOf(99) },
      asRole('moderator'),
    );

    expect(codesOf(response)).toEqual(['report_category_not_found']);
  });
});

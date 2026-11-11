import { resetSync } from '@logtape/logtape';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../common-lib/help/help-category-constants.ts';
import { helpArticles } from '../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../db/schema/help/help-categories.ts';
import {
  clearHelpTables,
  db,
  T0,
} from '../../lib/workers/help/testing/help-fixtures.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { helpSchemaModule } from '../../src/presentation/graphql/modules/help/index.ts';
import {
  createAdminGateway,
  issueAdminSession,
} from './admin-graphql-harness.ts';
import type { GatewayCallOptions, GatewayResponse } from './graphql-gateway.ts';
import { configureRecordingLogs } from './observability-recording.ts';

export interface HelpCategoryFields {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly sortOrder: number;
  readonly articleCount: number;
}

const HELP_CATEGORY_FIELDS = /* GraphQL */ `
  id
  name
  systemDefault
  sortOrder
  articleCount
`;

export const ADMIN_HELP_CATEGORIES = /* GraphQL */ `
  query AdminHelpCategories {
    adminHelpCategories {
      ${HELP_CATEGORY_FIELDS}
    }
  }
`;

export const CREATE_HELP_CATEGORY = /* GraphQL */ `
  mutation AdminCreateHelpCategory($name: String!) {
    createHelpCategory(name: $name) {
      ${HELP_CATEGORY_FIELDS}
    }
  }
`;

export const RENAME_HELP_CATEGORY = /* GraphQL */ `
  mutation AdminRenameHelpCategory($id: ID!, $name: String!) {
    renameHelpCategory(id: $id, name: $name) {
      ${HELP_CATEGORY_FIELDS}
    }
  }
`;

export const DELETE_HELP_CATEGORY = /* GraphQL */ `
  mutation AdminDeleteHelpCategory($id: ID!) {
    deleteHelpCategory(id: $id) {
      id
      reassignedCount
    }
  }
`;

export const REORDER_HELP_CATEGORIES = /* GraphQL */ `
  mutation AdminReorderHelpCategories($orderedIds: [ID!]!) {
    reorderHelpCategories(orderedIds: $orderedIds) {
      ${HELP_CATEGORY_FIELDS}
    }
  }
`;

export const helpAdminGateway = createAdminGateway({
  documents: [
    ADMIN_HELP_CATEGORIES,
    CREATE_HELP_CATEGORY,
    RENAME_HELP_CATEGORY,
    DELETE_HELP_CATEGORY,
    REORDER_HELP_CATEGORIES,
  ],
  schemaModules: [helpSchemaModule],
});

export const HELP_ADMINS = Object.freeze({
  superAdmin: 31,
  moderator: 32,
  viewer: 33,
});

const ROLES_OF_HELP_ADMINS: readonly (readonly [number, AdminRole])[] = [
  [HELP_ADMINS.superAdmin, 'super_admin'],
  [HELP_ADMINS.moderator, 'moderator'],
  [HELP_ADMINS.viewer, 'viewer'],
];

const sessionTokens = new Map<number, string>();

export function helpAdminIdOf(adminIndex: number): string {
  return adminIdOf(adminIndex);
}

// 管理者側の呼び出し元から、指定した管理者のセッションで要求する
export function asHelpAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = sessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

// 各テストの前に、ヘルプのテーブルを初期データの状態に戻し、監査ログを空にして、3つのロールの管理者とそのセッションを用意する
export function installHelpAdminGraphQLTest(): void {
  beforeAll(() => {
    configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearHelpTables();
    await db
      .update(helpCategories)
      .set({ name: HELP_CATEGORY_OTHER_NAME, sortOrder: 1, updatedAt: T0 })
      .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
    await clearAdminTables();
    sessionTokens.clear();
    for (const [index, role] of ROLES_OF_HELP_ADMINS) {
      await insertAdmin(index, { role });
      sessionTokens.set(
        index,
        (await issueAdminSession(adminIdOf(index))).token,
      );
    }
  });

  afterAll(() => {
    resetSync();
  });
}

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function readHelpCategoryRows() {
  return db
    .select({
      id: helpCategories.id,
      name: helpCategories.name,
      sortOrder: helpCategories.sortOrder,
    })
    .from(helpCategories)
    .orderBy(asc(helpCategories.sortOrder));
}

export function readHelpArticleCategories() {
  return db
    .select({
      id: helpArticles.id,
      categoryId: helpArticles.categoryId,
      sortOrder: helpArticles.sortOrder,
    })
    .from(helpArticles)
    .orderBy(asc(helpArticles.id));
}

export function fetchAdminHelpCategories(options?: GatewayCallOptions) {
  return helpAdminGateway.call<{
    adminHelpCategories: HelpCategoryFields[] | null;
  }>(ADMIN_HELP_CATEGORIES, {}, options);
}

export function createHelpCategory(
  variables: { readonly name: string },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    createHelpCategory: HelpCategoryFields | null;
  }>(CREATE_HELP_CATEGORY, variables, options);
}

export function renameHelpCategory(
  variables: { readonly id: string; readonly name: string },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    renameHelpCategory: HelpCategoryFields | null;
  }>(RENAME_HELP_CATEGORY, variables, options);
}

export function deleteHelpCategory(
  variables: { readonly id: string },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    deleteHelpCategory: { id: string; reassignedCount: number } | null;
  }>(DELETE_HELP_CATEGORY, variables, options);
}

export function reorderHelpCategories(
  variables: { readonly orderedIds: readonly string[] },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    reorderHelpCategories: HelpCategoryFields[] | null;
  }>(REORDER_HELP_CATEGORIES, variables, options);
}

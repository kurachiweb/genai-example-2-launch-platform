import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { beforeEach } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { users } from '../../db/schema/identity/users.ts';
import { userProfiles } from '../../db/schema/profile/user-profiles.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { clearEngagementTables } from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { clearModerationWrites } from '../../src/infrastructure/moderation/testing/moderation-write-fixtures.ts';
import {
  type AdministrativeWithdrawal,
  StoreAdministrativeWithdrawal,
} from '../../src/application/identity/administrative-withdrawal.ts';
import { identityError } from '../../src/application/identity/identity-errors.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import {
  StoreUserSuspension,
  type UserSuspension,
} from '../../src/application/identity/user-suspension.ts';
import { moderationSchemaModule } from '../../src/presentation/graphql/modules/moderation/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';

export { codesOf, detailsOf } from './payments-graphql-operations.ts';

export const MODERATION_TEST_NOW = new Date('2026-11-20T03:00:00.000Z');

export interface ModerationNoteFields {
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface AdminMediaFileFields {
  readonly id: string;
  readonly path: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly string[];
}

export interface AdminUserFields {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly avatar: AdminMediaFileFields | null;
  readonly registeredAt: string;
  readonly disposableEmail: string;
  readonly status: string;
  readonly suspendedAt: string | null;
  readonly latestSuspension: ModerationNoteFields | null;
}

export interface AdminUserConnectionFields {
  readonly nodes: readonly AdminUserFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface AdminUserFilterInput {
  readonly handle?: string | null;
  readonly nickname?: string | null;
  readonly email?: string | null;
  readonly status?: 'ACTIVE' | 'SUSPENDED' | null;
}

export const ADMIN_USERS = /* GraphQL */ `
  query AdminModerationUsers(
    $filter: AdminUserFilter
    $first: Int!
    $after: String
  ) {
    adminUsers(filter: $filter, first: $first, after: $after) {
      nodes {
        id
        handle
        nickname
        avatar {
          id
          path
          quarantined
          quarantineReasons
        }
        registeredAt
        disposableEmail
        status
        suspendedAt
        latestSuspension {
          reason
          occurredAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const SUSPEND_USER = /* GraphQL */ `
  mutation AdminModerationSuspendUser($id: ID!, $reason: String!) {
    suspendUser(id: $id, reason: $reason) {
      changed
    }
  }
`;

export const UNSUSPEND_USER = /* GraphQL */ `
  mutation AdminModerationUnsuspendUser($id: ID!, $reason: String!) {
    unsuspendUser(id: $id, reason: $reason) {
      changed
    }
  }
`;

export const WITHDRAW_USER_BY_ADMINISTRATOR = /* GraphQL */ `
  mutation AdminModerationWithdrawUser($input: AdministrativeWithdrawalInput!) {
    withdrawUserByAdministrator(input: $input) {
      changed
    }
  }
`;

const testClock: Clock = { now: () => MODERATION_TEST_NOW };

let conflictingTransitions = false;

// 同じ利用者の状態の同時の変更は要求の順では起こせないため、指定したときだけ上流の確定が競合を投げる
const throwIfConflicting = (): void => {
  if (conflictingTransitions) {
    throw identityError('account_state_conflict');
  }
};

const conflictableSuspension = (inner: UserSuspension): UserSuspension => ({
  suspend: (userId, at) => {
    throwIfConflicting();
    return inner.suspend(userId, at);
  },
  unsuspend: (userId, at) => {
    throwIfConflicting();
    return inner.unsuspend(userId, at);
  },
});

const conflictableWithdrawal = (
  inner: AdministrativeWithdrawal,
): AdministrativeWithdrawal => ({
  withdraw: (command) => {
    throwIfConflicting();
    return inner.withdraw(command);
  },
});

export function conflictAccountTransitions(): void {
  conflictingTransitions = true;
}

const overridesModule: AppModule<GatewayApp> = {
  name: 'moderation-user-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<UserSuspension>(IDENTITY_TYPES.UserSuspension).toDynamicValue(
      (context) =>
        conflictableSuspension(
          context.get(StoreUserSuspension, { autobind: true }),
        ),
    );
    rebind<AdministrativeWithdrawal>(
      IDENTITY_TYPES.AdministrativeWithdrawal,
    ).toDynamicValue((context) =>
      conflictableWithdrawal(
        context.get(StoreAdministrativeWithdrawal, { autobind: true }),
      ),
    );
  }),
};

const gateway = createGraphQLGateway({
  documents: [
    ADMIN_USERS,
    SUSPEND_USER,
    UNSUSPEND_USER,
    WITHDRAW_USER_BY_ADMINISTRATOR,
  ],
  // 統計の型が金額の型(Money)を使うため、それを宣言する決済のスキーマモジュールも読み込む
  schemaModules: [paymentsSchemaModule, moderationSchemaModule],
  overrides: [overridesModule],
});

export const MODERATION_ADMINS = Object.freeze({
  superAdmin: 1,
  moderator: 2,
  viewer: 3,
});

const ADMIN_ROLES: readonly (readonly [number, AdminRole])[] = [
  [MODERATION_ADMINS.superAdmin, 'super_admin'],
  [MODERATION_ADMINS.moderator, 'moderator'],
  [MODERATION_ADMINS.viewer, 'viewer'],
];

const adminSessionTokens = new Map<number, string>();

export function asModerationAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = adminSessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

// 各テストの前に利用者・プロフィール・画像・措置の記録と監査ログを含む管理者の表を空にし、3人の管理者とそのセッションを用意する
export function installModerationUserGraphQLTest(): void {
  beforeEach(async () => {
    conflictingTransitions = false;
    await clearModerationWrites();
    await clearMediaTables();
    await db.delete(userProfiles);
    await clearEngagementTables();
    await clearAdminTables();
    adminSessionTokens.clear();
    for (const [index, role] of ADMIN_ROLES) {
      await insertAdmin(index, { role });
      // セッションの検証は差し替えた時計で行われるため、発行も同じ時刻で行う
      const issued = await issueAdminSession(adminIdOf(index), {
        now: MODERATION_TEST_NOW,
      });
      adminSessionTokens.set(index, issued.token);
    }
  });
}

export async function insertAvatar(
  userIndex: number,
  fileId: string,
): Promise<void> {
  await db.insert(userProfiles).values({
    id: `01JC0PR0F${String(userIndex).padStart(17, '0')}`,
    userId: userIdOf(userIndex),
    avatarFileId: fileId,
    createdAt: MODERATION_TEST_NOW,
    updatedAt: MODERATION_TEST_NOW,
  });
}

export async function readUserState(index: number) {
  const [row] = await db
    .select({
      status: users.status,
      suspendedAt: users.suspendedAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userIdOf(index)));
  return row;
}

export function fetchAdminUsers(
  variables: {
    readonly filter?: AdminUserFilterInput | null;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return gateway.call<{ adminUsers: AdminUserConnectionFields | null }>(
    ADMIN_USERS,
    variables,
    options,
  );
}

export function suspendUser(
  variables: { readonly id: string; readonly reason: string },
  options?: GatewayCallOptions,
) {
  return gateway.call<{ suspendUser: { changed: boolean } | null }>(
    SUSPEND_USER,
    variables,
    options,
  );
}

export function unsuspendUser(
  variables: { readonly id: string; readonly reason: string },
  options?: GatewayCallOptions,
) {
  return gateway.call<{ unsuspendUser: { changed: boolean } | null }>(
    UNSUSPEND_USER,
    variables,
    options,
  );
}

export function withdrawUserByAdministrator(
  input: { readonly userId: string; readonly reason: string },
  options?: GatewayCallOptions,
) {
  return gateway.call<{
    withdrawUserByAdministrator: { changed: boolean } | null;
  }>(WITHDRAW_USER_BY_ADMINISTRATOR, { input }, options);
}

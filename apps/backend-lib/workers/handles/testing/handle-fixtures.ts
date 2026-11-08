import { asc, isNull } from 'drizzle-orm';

import { userPreviousHandles } from '../../../../db/schema/profile/user-previous-handles.ts';
import { users } from '../../../../db/schema/identity/users.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';
import {
  defineHandleNamespace,
  type HandleNamespace,
} from '../handle-namespace.ts';

export { after, db, insertUser, T0, userIdOf };

export const TEST_HANDLE_RULE = { maxLength: 30, reservedWords: [] } as const;

export const USER_NAMESPACE: HandleNamespace = defineHandleNamespace({
  name: 'user',
  rule: TEST_HANDLE_RULE,
  current: {
    table: users,
    ownerId: users.id,
    handle: users.handle,
    activeCondition: isNull(users.deletedAt),
  },
  previous: {
    table: userPreviousHandles,
    ownerId: userPreviousHandles.ownerId,
    handle: userPreviousHandles.handle,
    deletedAt: userPreviousHandles.deletedAt,
  },
});

export const CURRENT_ONLY_NAMESPACE: HandleNamespace = defineHandleNamespace({
  name: 'current-only',
  rule: TEST_HANDLE_RULE,
  current: {
    table: users,
    ownerId: users.id,
    handle: users.handle,
    activeCondition: isNull(users.deletedAt),
  },
});

export function previousHandleIdOf(index: number): string {
  return `01JC0PRVHDL${String(index).padStart(15, '0')}`;
}

export async function insertPreviousHandle(
  index: number,
  ownerIndex: number,
  handle: string,
  columns: { readonly deletedAt?: Date | null } = {},
): Promise<void> {
  await db.insert(userPreviousHandles).values({
    id: previousHandleIdOf(index),
    ownerId: userIdOf(ownerIndex),
    handle,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: columns.deletedAt ?? null,
  });
}

export async function readPreviousHandles() {
  return db
    .select()
    .from(userPreviousHandles)
    .orderBy(asc(userPreviousHandles.id));
}

export async function readUserHandles(): Promise<
  readonly { readonly id: string; readonly handle: string }[]
> {
  return db
    .select({ id: users.id, handle: users.handle })
    .from(users)
    .orderBy(asc(users.id));
}

export async function clearHandleTables(): Promise<void> {
  await db.delete(userPreviousHandles);
  await clearIdentityTables();
}

import { asc, eq } from 'drizzle-orm';

import { userSessions } from '../../db/schema/identity/user-sessions.ts';
import {
  after,
  db,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';

const DAY = 86_400_000;

export function sessionIdOf(userIndex: number, index: number): string {
  return `01JC0SESS${String(userIndex).padStart(8, '0')}${String(index).padStart(9, '0')}`;
}

export async function insertSessions(
  userIndex: number,
  count: number,
): Promise<void> {
  await db.insert(userSessions).values(
    Array.from({ length: count }, (_, offset) => ({
      id: sessionIdOf(userIndex, offset + 1),
      userId: userIdOf(userIndex),
      tokenHash: ['session', 'hash', String(userIndex), String(offset)].join(
        '-',
      ),
      userAgent: null,
      createdAt: T0,
      lastUsedAt: T0,
      absoluteExpiresAt: after(90 * DAY),
      updatedAt: T0,
    })),
  );
}

export async function readSessionIdsOf(userIndex: number): Promise<string[]> {
  const rows = await db
    .select({ id: userSessions.id })
    .from(userSessions)
    .where(eq(userSessions.userId, userIdOf(userIndex)))
    .orderBy(asc(userSessions.id));
  return rows.map((row) => row.id);
}

export function sessionIdsOf(userIndex: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) =>
    sessionIdOf(userIndex, offset + 1),
  );
}

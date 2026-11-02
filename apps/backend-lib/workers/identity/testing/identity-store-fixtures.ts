import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { createDatabase, type Database } from '../../../../db/client.ts';
import { userAuthTokens } from '../../../../db/schema/identity/user-auth-tokens.ts';
import { userLifecycleEvents } from '../../../../db/schema/identity/user-lifecycle-events.ts';
import { userLifecycleHandlerRuns } from '../../../../db/schema/identity/user-lifecycle-handler-runs.ts';
import { userLoginChallenges } from '../../../../db/schema/identity/user-login-challenges.ts';
import { userSessions } from '../../../../db/schema/identity/user-sessions.ts';
import { userTotpCredentials } from '../../../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../../../db/schema/identity/users.ts';
import type { IdGenerator } from '../../../core/ids/id-generator.ts';

const MAX_BOUND_PARAMETERS = 100;

// 1行が10個前後のバインド変数を使うため、上限に収まる行数ずつ追加する
const ROWS_PER_INSERT = 5;

export const T0 = new Date('2026-11-01T00:00:00.000Z');

export const db = createDatabase(env.DB);

type UserRow = typeof users.$inferInsert;
type EventRow = typeof userLifecycleEvents.$inferInsert;
type TotpCredentialRow = typeof userTotpCredentials.$inferInsert;

export function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

export function userIdOf(index: number): string {
  return `01JC0USER${String(index).padStart(17, '0')}`;
}

export function eventIdOf(index: number): string {
  return `01JC0EVT${String(index).padStart(18, '0')}`;
}

export function emailOf(index: number): string {
  return `user${String(index)}@mail.example`;
}

// 検証で作った行の識別子を予測できるよう、指定した番号から順に識別子を作る
export function createSequentialIds(start = 1000): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = eventIdOf(next);
      next += 1;
      return id;
    },
  };
}

function userRowOf(index: number, columns: Partial<UserRow>): UserRow {
  return {
    id: userIdOf(index),
    pseudonymousId: `pseudonymous-${String(index)}`,
    email: emailOf(index),
    passwordHash: 'pbkdf2-sha256$test',
    nickname: `利用者${String(index)}`,
    handle: `user${String(index)}`,
    termsAgreedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export async function insertUser(
  index: number,
  columns: Partial<UserRow> = {},
): Promise<void> {
  await db.insert(users).values(userRowOf(index, columns));
}

export async function insertUsers(
  indexes: readonly number[],
  columns: Partial<UserRow> = {},
): Promise<void> {
  const rows = indexes.map((index) => userRowOf(index, columns));
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db.insert(users).values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function insertTotpCredential(
  userIndex: number,
  columns: Partial<TotpCredentialRow> = {},
): Promise<void> {
  await db.insert(userTotpCredentials).values({
    userId: userIdOf(userIndex),
    sealedSecret: `sealed-secret-${String(userIndex)}`,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

function eventRowOf(index: number, columns: Partial<EventRow>): EventRow {
  return {
    id: eventIdOf(index),
    userId: userIdOf(1),
    type: 'withdrawn',
    occurredAt: T0,
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

export async function insertEvent(
  index: number,
  columns: Partial<EventRow> = {},
): Promise<void> {
  await db.insert(userLifecycleEvents).values(eventRowOf(index, columns));
}

export async function insertEvents(
  indexes: readonly number[],
  columns: Partial<EventRow> = {},
): Promise<void> {
  const rows = indexes.map((index) => eventRowOf(index, columns));
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db
      .insert(userLifecycleEvents)
      .values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function readEvent(index: number) {
  const [row] = await db
    .select()
    .from(userLifecycleEvents)
    .where(eq(userLifecycleEvents.id, eventIdOf(index)));
  return row;
}

export async function readEventsOf(userIndex: number) {
  return db
    .select()
    .from(userLifecycleEvents)
    .where(eq(userLifecycleEvents.userId, userIdOf(userIndex)))
    .orderBy(asc(userLifecycleEvents.id));
}

export async function readHandlerRuns() {
  return db
    .select({
      id: userLifecycleHandlerRuns.id,
      eventId: userLifecycleHandlerRuns.eventId,
      handlerName: userLifecycleHandlerRuns.handlerName,
      completedAt: userLifecycleHandlerRuns.completedAt,
    })
    .from(userLifecycleHandlerRuns)
    .orderBy(
      asc(userLifecycleHandlerRuns.eventId),
      asc(userLifecycleHandlerRuns.handlerName),
    );
}

export async function clearIdentityTables(): Promise<void> {
  await db.delete(userLifecycleHandlerRuns);
  await db.delete(userLifecycleEvents);
  await db.delete(userTotpCredentials);
  await db.delete(userSessions);
  await db.delete(userAuthTokens);
  await db.delete(userLoginChallenges);
  await db.delete(users);
}

// prepareだけを差し替え、他の操作はテスト用のD1へそのまま渡す
function withPrepare(
  prepare: (query: string) => D1PreparedStatement,
): D1Database {
  const d1 = env.DB;
  return {
    prepare,
    batch: d1.batch.bind(d1),
    exec: d1.exec.bind(d1),
    withSession: d1.withSession.bind(d1),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: d1.dump.bind(d1),
  };
}

// 問い合わせの有無と分割の仕方を確かめるため、D1へ渡した各文のプレースホルダーの数を記録する
export function createRecordingDatabase(): {
  readonly database: Database;
  readonly placeholderCounts: readonly number[];
} {
  const placeholderCounts: number[] = [];
  const database = createDatabase(
    withPrepare((query) => {
      placeholderCounts.push(query.match(/\?/g)?.length ?? 0);
      return env.DB.prepare(query);
    }),
  );
  return { database, placeholderCounts };
}

// D1の障害を再現するため、すべての文を存在しないテーブルへの問い合わせに差し替える
export function createFailingDatabase(): Database {
  return createDatabase(
    withPrepare(() =>
      env.DB.prepare('SELECT * FROM table_that_does_not_exist'),
    ),
  );
}

export function expectWithinBindLimit(
  placeholderCounts: readonly number[],
): void {
  expect(placeholderCounts.length).toBeGreaterThan(0);
  for (const count of placeholderCounts) {
    expect(count).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
  }
}

export function expectSplitWithinBindLimit(
  placeholderCounts: readonly number[],
): void {
  expect(placeholderCounts.length).toBeGreaterThan(1);
  expectWithinBindLimit(placeholderCounts);
}

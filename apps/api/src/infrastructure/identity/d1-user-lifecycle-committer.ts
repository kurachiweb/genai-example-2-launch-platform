import { eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { userLifecycleEvents } from '../../../db/schema/identity/user-lifecycle-events.ts';
import { userLoginChallenges } from '../../../db/schema/identity/user-login-challenges.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  assertLifecycleHandlerName,
  LifecycleRegistrationError,
  type SyncLifecycleEventType,
  type UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../../application/identity/ports.ts';
import type {
  UserLifecycleSyncHandler,
  UserLifecycleSyncRegistration,
} from './user-lifecycle-sync-handler.ts';

const EVENT_TYPE_BY_KIND = Object.freeze({
  withdraw: 'withdrawn',
  suspend: 'suspended',
  unsuspend: 'unsuspended',
} as const satisfies Record<
  UserStateTransition['kind'],
  SyncLifecycleEventType
>);

// 退会は停止中でも状態と停止日時を残し、論理削除だけを行う
const STATE_CHANGE_BY_KIND = Object.freeze({
  withdraw: (at: Date) => ({ deletedAt: at }),
  suspend: (at: Date) => ({ status: 'suspended' as const, suspendedAt: at }),
  unsuspend: () => ({ status: 'active' as const, suspendedAt: null }),
} satisfies Record<
  UserStateTransition['kind'],
  (at: Date) => Partial<typeof users.$inferInsert>
>);

// 版の検査に失敗したイベントの挿入だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: user_lifecycle_events.user_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const VERSION_CONFLICT_PATTERN =
  /NOT NULL constraint failed: user_lifecycle_events\.user_id(?::|$)/u;

const STATE_CONFLICT_MESSAGE =
  '処理が重なりました。時間をおいて再度お試しください。';

function isVersionConflict(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (VERSION_CONFLICT_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

function assertRegistrations(
  registrations: readonly UserLifecycleSyncRegistration[],
): void {
  const names = new Set<string>();
  for (const { name } of registrations) {
    assertLifecycleHandlerName(name);
    if (names.has(name)) {
      throw new LifecycleRegistrationError(
        `同期の波及処理の名前が重複しています: ${JSON.stringify(name)}`,
      );
    }
    names.add(name);
  }
}

export function createD1UserLifecycleCommitter(
  db: Database,
  ids: IdGenerator,
  registrations: readonly UserLifecycleSyncRegistration[],
  resolve: <T>(identifier: ServiceIdentifier<T>) => T,
): UserLifecycleCommitter {
  assertRegistrations(registrations);

  // 版が読み取った値と異なる(利用者が無い場合を含む)と利用者IDがNULLになり、NOT NULL制約の違反で一括の書き込み全体が取り消される
  function versionGuardedEventInsert(
    event: UserLifecycleEvent,
    expectedVersion: number,
  ) {
    return db.insert(userLifecycleEvents).values({
      id: event.id,
      userId: sql`CASE WHEN (SELECT ${users.lifecycleVersion} FROM ${users} WHERE ${users.id} = ${event.userId}) = ${expectedVersion} THEN ${event.userId} ELSE NULL END`,
      type: event.type,
      occurredAt: event.occurredAt,
      lastDispatchedAt: event.occurredAt,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    });
  }

  function stateUpdate(transition: UserStateTransition) {
    return db
      .update(users)
      .set({
        ...STATE_CHANGE_BY_KIND[transition.kind](transition.at),
        lifecycleVersion: sql`${users.lifecycleVersion} + 1`,
        updatedAt: transition.at,
      })
      .where(eq(users.id, transition.userId));
  }

  function credentialDeletions(transition: UserStateTransition) {
    if (transition.kind !== 'withdraw') {
      return [];
    }
    return [
      db.delete(userSessions).where(eq(userSessions.userId, transition.userId)),
      db
        .delete(userAuthTokens)
        .where(eq(userAuthTokens.userId, transition.userId)),
      db
        .delete(userLoginChallenges)
        .where(eq(userLoginChallenges.userId, transition.userId)),
    ];
  }

  async function syncStatements(
    event: UserLifecycleEvent & { readonly type: SyncLifecycleEventType },
  ): Promise<BatchItem<'sqlite'>[]> {
    const statements = await Promise.all(
      registrations
        .filter(({ events }) => events.includes(event.type))
        .map(({ handler }) =>
          resolve<UserLifecycleSyncHandler>(handler).statementsFor(event, db),
        ),
    );
    return statements.flat();
  }

  return {
    async commit(transition) {
      const event = {
        id: ids.generate(),
        userId: transition.userId,
        type: EVENT_TYPE_BY_KIND[transition.kind],
        occurredAt: transition.at,
      };
      const handlerStatements = await syncStatements(event);
      try {
        await db.batch([
          versionGuardedEventInsert(event, transition.expectedVersion),
          stateUpdate(transition),
          ...credentialDeletions(transition),
          ...handlerStatements,
        ]);
      } catch (error) {
        if (isVersionConflict(error)) {
          throw new AppError({
            kind: 'conflict',
            code: 'account_state_conflict',
            message: STATE_CONFLICT_MESSAGE,
          });
        }
        throw error;
      }
      return event;
    },
  };
}

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  StoredLifecycleEvent,
  UserLifecycleStore,
} from '../../../../lib/core/identity/ports.ts';
import type { UserLifecycleEvent } from '../../../../lib/core/identity/user-lifecycle.ts';
import type { MessageContract } from '../../../../lib/core/messaging/message-contract.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import type { SessionPolicy } from '../../../domain/auth/session-policy.ts';
import type { AuthIncident, AuthIncidentReporter } from '../../auth/ports.ts';
import type {
  AuthTokenStore,
  IdentityMessagePublisher,
  IdentityPublishOptions,
  LoginChallengeStore,
  TotpCredentialStore,
  UserAccountStore,
  UserSessionStore,
} from '../ports.ts';

export const DAILY_CLEANUP_CRON = '21 12 * * *';

export const REDISPATCH_CRON = '21 0 * * *';

export function jobContextAt(
  scheduledTime: Date,
  cron = DAILY_CLEANUP_CRON,
): ScheduledJobContext {
  return { scheduledTime, cron, business: toBusinessDateTime(scheduledTime) };
}

// 使わないメソッドを呼んだら失敗させ、ジョブが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

export function ulidOf(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(26 - prefix.length, '0')}`;
}

export interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
  readonly options: IdentityPublishOptions | undefined;
}

export interface PublisherFakeOptions {
  // trueを返した本文の送信を失敗させる
  readonly failWhen?: (body: unknown) => boolean;
}

export function createPublisherFake(options: PublisherFakeOptions = {}) {
  const published: PublishedMessage[] = [];
  const attempted: unknown[] = [];
  const publisher: IdentityMessagePublisher = {
    publish<TType extends string, TBody>(
      contract: MessageContract<TType, TBody>,
      body: TBody,
      publishOptions?: IdentityPublishOptions,
    ) {
      attempted.push(body);
      if (options.failWhen?.(body) === true) {
        return Promise.reject(new Error('送信に失敗しました'));
      }
      published.push({ type: contract.type, body, options: publishOptions });
      return Promise.resolve(`message-${String(published.length)}`);
    },
  };
  return { publisher, published, attempted };
}

export function createReporterFake() {
  const incidents: AuthIncident[] = [];
  const reporter: AuthIncidentReporter = {
    report(incident) {
      incidents.push(incident);
    },
  };
  return { reporter, incidents };
}

export interface WithdrawnUser {
  readonly userId: string;
  readonly deletedAt: Date;
  readonly purgeStarted?: boolean;
}

export interface LifecycleStoreFakeOptions {
  readonly withdrawn?: readonly WithdrawnUser[];
  readonly pending?: readonly StoredLifecycleEvent[];
  readonly listPurgeCandidatesError?: Error;
  readonly countOverduePurgesError?: Error;
}

export interface LifecycleStoreCalls {
  readonly purgeCandidateQueries: { deletedBefore: Date; limit: number }[];
  readonly purgeDueCreations: { userIds: readonly string[]; at: Date }[];
  readonly overdueQueries: Date[];
  readonly stalePendingQueries: { dispatchedBefore: Date; limit: number }[];
  readonly redispatchMarks: { eventIds: readonly string[]; at: Date }[];
}

// 実装と同じく、期限は「より前」で比べ、物理削除の開始のイベントは利用者ごとに1件だけ作る
export function createLifecycleStoreFake(
  options: LifecycleStoreFakeOptions = {},
) {
  const withdrawn = (options.withdrawn ?? []).map((user) => ({
    ...user,
    purgeStarted: user.purgeStarted ?? false,
  }));
  const pending = options.pending ?? [];
  const calls: LifecycleStoreCalls = {
    purgeCandidateQueries: [],
    purgeDueCreations: [],
    overdueQueries: [],
    stalePendingQueries: [],
    redispatchMarks: [],
  };
  let createdCount = 0;

  const store = partialFake<UserLifecycleStore>({
    listPurgeCandidates(deletedBefore, limit) {
      calls.purgeCandidateQueries.push({ deletedBefore, limit });
      if (options.listPurgeCandidatesError !== undefined) {
        return Promise.reject(options.listPurgeCandidatesError);
      }
      return Promise.resolve(
        withdrawn
          .filter(
            (user) =>
              !user.purgeStarted &&
              user.deletedAt.getTime() < deletedBefore.getTime(),
          )
          .toSorted(
            (left, right) =>
              left.deletedAt.getTime() - right.deletedAt.getTime(),
          )
          .slice(0, limit)
          .map((user) => user.userId),
      );
    },
    createPurgeDueEvents(userIds, at) {
      calls.purgeDueCreations.push({ userIds, at });
      const created: UserLifecycleEvent[] = [];
      for (const userId of userIds) {
        const user = withdrawn.find((candidate) => candidate.userId === userId);
        if (user === undefined || user.purgeStarted) {
          continue;
        }
        user.purgeStarted = true;
        createdCount += 1;
        created.push({
          id: ulidOf('01JPURGE', createdCount),
          userId,
          type: 'purge_due',
          occurredAt: at,
        });
      }
      return Promise.resolve(created);
    },
    countOverduePurges(deletedBefore) {
      calls.overdueQueries.push(deletedBefore);
      if (options.countOverduePurgesError !== undefined) {
        return Promise.reject(options.countOverduePurgesError);
      }
      return Promise.resolve(
        withdrawn.filter(
          (user) => user.deletedAt.getTime() < deletedBefore.getTime(),
        ).length,
      );
    },
    listStalePending(dispatchedBefore, limit) {
      calls.stalePendingQueries.push({ dispatchedBefore, limit });
      return Promise.resolve(
        pending
          .filter(
            (event) =>
              event.status === 'pending' &&
              event.lastDispatchedAt.getTime() < dispatchedBefore.getTime(),
          )
          .toSorted(
            (left, right) =>
              left.lastDispatchedAt.getTime() -
              right.lastDispatchedAt.getTime(),
          )
          .slice(0, limit),
      );
    },
    markRedispatched(eventIds, at) {
      calls.redispatchMarks.push({ eventIds, at });
      return Promise.resolve();
    },
  });
  return { store, calls, withdrawn };
}

export function pendingEventOf(
  index: number,
  overrides: Partial<StoredLifecycleEvent> = {},
): StoredLifecycleEvent {
  return {
    id: ulidOf('01JEVENT', index),
    userId: ulidOf('01JUSER', index),
    type: 'withdrawn',
    occurredAt: new Date('2026-11-01T00:00:00.000Z'),
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

export interface UndeterminedUser {
  readonly userId: string;
  readonly checkedAt: Date;
}

export function createUndeterminedUsersFake(
  undetermined: readonly UndeterminedUser[],
) {
  const queries: { checkedBefore: Date; limit: number }[] = [];
  const users = partialFake<UserAccountStore>({
    listUndetermined(checkedBefore, limit) {
      queries.push({ checkedBefore, limit });
      return Promise.resolve(
        undetermined
          .filter((user) => user.checkedAt.getTime() < checkedBefore.getTime())
          .toSorted(
            (left, right) =>
              left.checkedAt.getTime() - right.checkedAt.getTime(),
          )
          .slice(0, limit)
          .map((user) => user.userId),
      );
    },
  });
  return { users, queries };
}

export type CleanupTarget =
  'sessions' | 'mailLinks' | 'loginChallenges' | 'totpPendings';

export interface CredentialStoresFakeOptions {
  readonly deleted?: Partial<Record<CleanupTarget, number>>;
  readonly errors?: Partial<Record<CleanupTarget, Error>>;
}

export interface CleanupCall {
  readonly target: CleanupTarget;
  readonly now: Date;
  readonly policy?: SessionPolicy;
}

export function createCredentialStoresFake(
  options: CredentialStoresFakeOptions = {},
) {
  const calls: CleanupCall[] = [];
  const resultOf = (target: CleanupTarget): Promise<number> => {
    const error = options.errors?.[target];
    return error === undefined
      ? Promise.resolve(options.deleted?.[target] ?? 0)
      : Promise.reject(error);
  };
  const sessions = partialFake<UserSessionStore>({
    deleteExpired(now, policy) {
      calls.push({ target: 'sessions', now, policy });
      return resultOf('sessions');
    },
  });
  const authTokens = partialFake<AuthTokenStore>({
    deleteExpired(now) {
      calls.push({ target: 'mailLinks', now });
      return resultOf('mailLinks');
    },
  });
  const loginChallenges = partialFake<LoginChallengeStore>({
    deleteExpired(now) {
      calls.push({ target: 'loginChallenges', now });
      return resultOf('loginChallenges');
    },
  });
  const totpCredentials = partialFake<TotpCredentialStore>({
    deleteExpiredPending(now) {
      calls.push({ target: 'totpPendings', now });
      return resultOf('totpPendings');
    },
  });
  return { sessions, authTokens, loginChallenges, totpCredentials, calls };
}

export function createLogCapture() {
  const records: LogRecord[] = [];
  return {
    records,
    start(): void {
      records.length = 0;
      configureSync({
        sinks: { memory: (record) => records.push(record) },
        loggers: [
          { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
          { category: ['api'], lowestLevel: 'debug', sinks: ['memory'] },
        ],
      });
    },
    stop(): void {
      resetSync();
    },
    of(feature: string): LogRecord[] {
      return records.filter(
        (record) => record.category.join('.') === `api.identity.${feature}`,
      );
    },
  };
}

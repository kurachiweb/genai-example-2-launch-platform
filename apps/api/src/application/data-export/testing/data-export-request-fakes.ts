import type { DataExportStatus } from '../../../../common-lib/data-export/data-export-rules.ts';
import type {
  DataExportRecord,
  DataExportStore,
} from '../../../../lib/core/data-export/ports.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type { MessageContract } from '../../../../lib/core/messaging/message-contract.ts';
import type { SessionView } from '../../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type {
  DataExportMessagePublisher,
  DataExportRequestLimits,
} from '../data-export-request-ports.ts';

export const NOW = new Date('2026-11-22T10:00:00.000Z');

export const USER_ID = '01JE0DXUSER000000000000001';

export const OTHER_USER_ID = '01JE0DXUSER000000000000002';

export const GENERATED_ID = '01JE0DXEXPT000000000000099';

const DAY_MS = 86_400_000;

export const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: USER_ID,
      sessionId: '01JE0DXSESS000000000000001',
    }),
});

export function currentUserOf(
  overrides: Partial<CurrentUser['user']> = {},
): CurrentUser {
  return {
    principal: {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: USER_ID,
      sessionId: '01JE0DXSESS000000000000001',
    },
    user: {
      id: USER_ID,
      pseudonymousId: '01JE0DXPSEU000000000000001',
      status: 'active',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      email: 'exporter@mail.example',
      nickname: '持ち出す人',
      handle: 'exporter',
      ...overrides,
    },
  };
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

export function createAccountGuard(
  calls: string[],
  outcome: { readonly user?: CurrentUser; readonly error?: Error } = {},
): AccountGuard {
  return {
    currentUser: unexpected,
    requireWritableUser: unexpected,
    requireVerifiedUser: unexpected,
    requireUser: (session) => {
      calls.push('guard.requireUser');
      expectSession(session);
      if (outcome.error !== undefined) {
        return Promise.reject(outcome.error);
      }
      return Promise.resolve(outcome.user ?? currentUserOf());
    },
  };
}

function expectSession(session: SessionView): void {
  if (session !== SESSION) {
    throw new Error('想定外のセッションです');
  }
}

export function createLimits(
  calls: string[],
  error?: Error,
): DataExportRequestLimits {
  return {
    consume: (userId) => {
      calls.push(`limits.consume:${userId}`);
      return error === undefined ? Promise.resolve() : Promise.reject(error);
    },
  };
}

export interface Published {
  readonly type: string;
  readonly body: unknown;
  readonly options: { readonly delaySeconds?: number } | undefined;
}

export function createPublisher(
  calls: string[],
  published: Published[],
  failingTypes: readonly string[] = [],
): DataExportMessagePublisher {
  return {
    publish: <TType extends string, TBody>(
      contract: MessageContract<TType, TBody>,
      body: TBody,
      options?: { readonly delaySeconds?: number },
    ): Promise<string> => {
      calls.push(`publish:${contract.type}`);
      if (failingTypes.includes(contract.type)) {
        return Promise.reject(new Error('キューへ送れません'));
      }
      published.push({ type: contract.type, body, options });
      return Promise.resolve('message-id');
    },
  };
}

export const FIXED_CLOCK: Clock = Object.freeze({ now: () => NOW });

export const FIXED_IDS: IdGenerator = Object.freeze({
  generate: () => GENERATED_ID,
});

export function recordOf(
  overrides: Partial<DataExportRecord> = {},
): DataExportRecord {
  return {
    id: GENERATED_ID,
    userId: USER_ID,
    status: 'queued',
    requestedAt: NOW,
    runToken: null,
    leaseExpiresAt: null,
    attempts: 0,
    uploadId: null,
    objectKey: null,
    fileName: null,
    byteSize: null,
    completedAt: null,
    expiresAt: null,
    failedAt: null,
    failureKind: null,
    noticeStatus: 'none',
    updatedAt: NOW,
    ...overrides,
  };
}

export function readyRecordOf(
  id: string,
  expiresAt: Date,
  overrides: Partial<DataExportRecord> = {},
): DataExportRecord {
  return recordOf({
    id,
    status: 'ready',
    objectKey: `data-exports/${id}.zip`,
    fileName: 'launch-stadium-export-exporter-20261122.zip',
    byteSize: 2048,
    completedAt: new Date(expiresAt.getTime() - 7 * DAY_MS),
    expiresAt,
    ...overrides,
  });
}

export function recordWithStatus(
  id: string,
  status: DataExportStatus,
  overrides: Partial<DataExportRecord> = {},
): DataExportRecord {
  return recordOf({ id, status, ...overrides });
}

export interface ListCall {
  readonly userId: string;
  readonly afterId: string | undefined;
  readonly limit: number;
}

export interface OwnedReadyCall {
  readonly id: string;
  readonly userId: string;
  readonly now: Date;
}

export interface FakeStore {
  readonly store: DataExportStore;
  readonly ownedReadyCalls: OwnedReadyCall[];
  readonly created: DataExportRecord[];
  readonly removed: string[];
  readonly listCalls: ListCall[];
}

export function createStore(
  calls: string[],
  options: {
    readonly records?: readonly DataExportRecord[];
    readonly removeError?: Error;
  } = {},
): FakeStore {
  const created: DataExportRecord[] = [];
  const removed: string[] = [];
  const listCalls: ListCall[] = [];
  const ownedReadyCalls: OwnedReadyCall[] = [];
  const records = options.records ?? [];
  const store: DataExportStore = {
    create: (input) => {
      calls.push('store.create');
      const record = recordOf({
        id: input.id,
        userId: input.userId,
        requestedAt: input.requestedAt,
        updatedAt: input.requestedAt,
      });
      created.push(record);
      return Promise.resolve(record);
    },
    remove: (id) => {
      calls.push(`store.remove:${id}`);
      removed.push(id);
      return options.removeError === undefined
        ? Promise.resolve()
        : Promise.reject(options.removeError);
    },
    listByUserPage: (input) => {
      calls.push('store.listByUserPage');
      listCalls.push(input);
      const page = records
        .filter((record) => record.userId === input.userId)
        .filter(
          (record) => input.afterId === undefined || record.id < input.afterId,
        )
        .toSorted((left, right) => (left.id < right.id ? 1 : -1))
        .slice(0, input.limit + 1);
      return Promise.resolve(page);
    },
    find: unexpected,
    findOwnedReady: (input) => {
      calls.push('store.findOwnedReady');
      ownedReadyCalls.push(input);
      return Promise.resolve(
        records.find(
          (record) =>
            record.id === input.id &&
            record.userId === input.userId &&
            record.status === 'ready' &&
            record.expiresAt !== null &&
            record.expiresAt.getTime() > input.now.getTime(),
        ),
      );
    },
    claim: unexpected,
    recordUpload: unexpected,
    releaseLease: unexpected,
    markReady: unexpected,
    markFailed: unexpected,
    advanceNotice: unexpected,
    listStalled: unexpected,
    listPendingNotices: unexpected,
    listExpired: unexpected,
    markExpired: unexpected,
    listFailedWithUpload: unexpected,
    clearUpload: unexpected,
    listForUser: unexpected,
    removeMany: unexpected,
  };
  return { store, created, removed, listCalls, ownedReadyCalls };
}

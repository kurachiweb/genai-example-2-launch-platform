import { describe, expect, test } from 'bun:test';

import type {
  AuditEntryInput,
  AuditLogRecorder,
} from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AdminUserDirectory,
  AdminUserRecord,
  AdminUserSearchFilter,
} from '../../../lib/core/identity/ports.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type {
  LatestModeration,
  ModerationRecordStore,
} from '../../../lib/core/moderation/ports.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import {
  type AdminUserListInput,
  DefaultAdminUserReader,
} from './admin-user-reader.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const ADMIN_ID = '01JQ0ADM000000000000000001';
const SEARCHED_EMAIL = 'Secret.Person@mail.example';
const NEXT_CURSOR = 'next-page-cursor';

const ACTIVE_ID = '01JQ0USR000000000000000001';
const SUSPENDED_ID = '01JQ0USR000000000000000002';
const UNVERIFIED_ID = '01JQ0USR000000000000000003';
const NO_RECORD_SUSPENDED_ID = '01JQ0USR000000000000000004';

const ACTIVE_AVATAR_ID = '01JQ0FIL000000000000000001';
const SUSPENDED_AVATAR_ID = '01JQ0FIL000000000000000002';
const ERASED_AVATAR_ID = '01JQ0FIL000000000000000003';

const pseudonymousIdOf = (index: number): string =>
  `0f1e2d3c-4b5a-4968-8776-65544332211${String(index)}`;

const userOf = (
  userId: string,
  index: number,
  overrides: Partial<AdminUserRecord> = {},
): AdminUserRecord => ({
  userId,
  pseudonymousId: pseudonymousIdOf(index),
  handle: `handle_${String(index)}`,
  nickname: `ニックネーム${String(index)}`,
  status: 'active',
  suspendedAt: null,
  registeredAt: new Date(`2026-0${String(index)}-01T00:00:00.000Z`),
  emailVerified: true,
  disposableEmailStatus: 'regular',
  ...overrides,
});

const SUSPENDED_AT = new Date('2026-11-10T00:00:00.000Z');

const ACTIVE_USER = userOf(ACTIVE_ID, 1, {
  disposableEmailStatus: 'disposable',
});
const SUSPENDED_USER = userOf(SUSPENDED_ID, 2, {
  status: 'suspended',
  suspendedAt: SUSPENDED_AT,
  disposableEmailStatus: null,
});
const UNVERIFIED_USER = userOf(UNVERIFIED_ID, 3, {
  emailVerified: false,
  disposableEmailStatus: null,
});
const NO_RECORD_SUSPENDED_USER = userOf(NO_RECORD_SUSPENDED_ID, 4, {
  status: 'suspended',
  suspendedAt: SUSPENDED_AT,
});

const summaryOf = (
  user: AdminUserRecord,
  avatarFileId: string | null,
): UserSummaryRecord => ({
  userId: user.userId,
  handle: user.handle,
  nickname: user.nickname,
  avatarFileId,
  suspended: user.status === 'suspended',
});

const fileOf = (
  id: string,
  quarantineReasons: MediaFileView['quarantineReasons'],
): MediaFileView => ({
  id,
  objectKey: `images/${id}`,
  purpose: 'user-avatar',
  storage: 'images',
  location: quarantineReasons.length > 0 ? 'quarantine' : 'images',
  owner: { kind: 'user', id: ACTIVE_ID },
  originalFileName: 'avatar.png',
  contentType: 'image/png',
  byteSize: 2048,
  width: 256,
  height: 256,
  stored: true,
  attached: true,
  deletedAt: null,
  eraseRequested: false,
  moderationStatus: 'passed',
  quarantineReasons,
  quarantined: quarantineReasons.length > 0,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

const LATEST_SUSPENSION: LatestModeration = {
  action: 'user.suspend',
  reason: '規約違反の投稿を繰り返したため',
  occurredAt: new Date('2026-11-10T00:00:00.000Z'),
};

async function caughtOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

interface HarnessOptions {
  readonly users?: readonly AdminUserRecord[];
  readonly nextCursor?: string | null;
  readonly summaries?: readonly UserSummaryRecord[];
  readonly files?: readonly MediaFileView[];
  readonly latest?: ReadonlyMap<string, LatestModeration>;
  readonly searchError?: Error;
  readonly recordError?: Error;
}

const harnessOf = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const searches: {
    filter: AdminUserSearchFilter;
    page: { readonly after?: string; readonly limit: number };
  }[] = [];
  const summaryLookups: { ids: readonly string[]; scope: string }[] = [];
  const fileLookups: (readonly string[])[] = [];
  const latestLookups: Parameters<ModerationRecordStore['latestFor']>[0][] = [];
  const recorded: AuditEntryInput[] = [];
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`${name}は呼ばれない想定です`));
  const users: AdminUserDirectory = {
    search: (filter, page) => {
      calls.push('users.search');
      searches.push({ filter, page });
      return options.searchError === undefined
        ? Promise.resolve({
            users: options.users ?? [],
            nextCursor: options.nextCursor ?? null,
          })
        : Promise.reject(options.searchError);
    },
    findByIds: unexpected('findByIds'),
    findByEmail: unexpected('findByEmail'),
    countRegisteredAt: unexpected('countRegisteredAt'),
  };
  const profiles: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.push('profiles.findSummaries');
      summaryLookups.push({ ids, scope });
      return Promise.resolve(
        new Map(
          (options.summaries ?? [])
            .filter(({ userId }) => ids.includes(userId))
            .map((summary) => [summary.userId, summary]),
        ),
      );
    },
    resolveHandle: unexpected('resolveHandle'),
  };
  const media: MediaFiles = {
    claim: unexpected('claim'),
    markDeleted: unexpected('markDeleted'),
    eraseNow: unexpected('eraseNow'),
    eraseOwnedBy: unexpected('eraseOwnedBy'),
    listOwnerIds: unexpected('listOwnerIds'),
    openContent: unexpected('openContent'),
    findMany: (fileIds) => {
      calls.push('media.findMany');
      fileLookups.push(fileIds);
      return Promise.resolve(
        new Map(
          (options.files ?? [])
            .filter(({ id }) => fileIds.includes(id))
            .map((file) => [file.id, file]),
        ),
      );
    },
  };
  const records: ModerationRecordStore = {
    latestFor: (input) => {
      calls.push('records.latestFor');
      latestLookups.push(input);
      return Promise.resolve(options.latest ?? new Map());
    },
    find: unexpected('find'),
    listPendingNotices: unexpected('listPendingNotices'),
    markNotice: unexpected('markNotice'),
    eraseBySubjectUser: unexpected('eraseBySubjectUser'),
    eraseByProduct: unexpected('eraseByProduct'),
    eraseOccurredBefore: unexpected('eraseOccurredBefore'),
  };
  const auditLog: AuditLogRecorder = {
    prepare: () => {
      throw new Error('prepareは呼ばれない想定です');
    },
    record: (entry) => {
      calls.push('auditLog.record');
      recorded.push(entry);
      return options.recordError === undefined
        ? Promise.resolve()
        : Promise.reject(options.recordError);
    },
  };
  const reader = new DefaultAdminUserReader(
    users,
    profiles,
    media,
    records,
    auditLog,
  );
  const list = (input: Partial<AdminUserListInput> = {}) =>
    reader.list({
      filter: {},
      first: 50,
      operator: { adminId: ADMIN_ID },
      at: AT,
      ...input,
    });
  return {
    calls,
    searches,
    summaryLookups,
    fileLookups,
    latestLookups,
    recorded,
    list,
  };
};

const FULL_PAGE: HarnessOptions = {
  users: [
    ACTIVE_USER,
    SUSPENDED_USER,
    UNVERIFIED_USER,
    NO_RECORD_SUSPENDED_USER,
  ],
  nextCursor: NEXT_CURSOR,
  summaries: [
    summaryOf(ACTIVE_USER, ACTIVE_AVATAR_ID),
    summaryOf(SUSPENDED_USER, SUSPENDED_AVATAR_ID),
    summaryOf(UNVERIFIED_USER, null),
    summaryOf(NO_RECORD_SUSPENDED_USER, ERASED_AVATAR_ID),
  ],
  files: [
    fileOf(ACTIVE_AVATAR_ID, []),
    fileOf(SUSPENDED_AVATAR_ID, ['user_suspended', 'auto']),
  ],
  latest: new Map([[SUSPENDED_ID, LATEST_SUSPENSION]]),
};

describe('DefaultAdminUserReader', () => {
  describe('一覧の組み立て', () => {
    test('絞り込みと件数と位置を上流の検索へそのまま渡し、続きのカーソルを返す', async () => {
      const harness = harnessOf(FULL_PAGE);

      const page = await harness.list({
        filter: { handle: 'han', nickname: 'ニック', status: 'suspended' },
        first: 20,
        after: 'previous-cursor',
      });

      expect(harness.searches).toEqual([
        {
          filter: { handle: 'han', nickname: 'ニック', status: 'suspended' },
          page: { after: 'previous-cursor', limit: 20 },
        },
      ]);
      expect(page.nextCursor).toBe(NEXT_CURSOR);
    });

    test('位置の指定が無いときは位置を渡さない', async () => {
      const harness = harnessOf(FULL_PAGE);

      await harness.list();

      expect(harness.searches[0]?.page).toEqual({ limit: 50 });
    });

    test('プロフィール画像と隔離理由と停止の最新の理由を、各照会1回で組み立てる', async () => {
      const harness = harnessOf(FULL_PAGE);

      const page = await harness.list();

      expect(page.users).toEqual([
        {
          userId: ACTIVE_ID,
          handle: ACTIVE_USER.handle,
          nickname: ACTIVE_USER.nickname,
          avatar: fileOf(ACTIVE_AVATAR_ID, []),
          registeredAt: ACTIVE_USER.registeredAt,
          disposableEmail: 'disposable',
          status: 'active',
          suspendedAt: null,
          latestSuspension: null,
        },
        {
          userId: SUSPENDED_ID,
          handle: SUSPENDED_USER.handle,
          nickname: SUSPENDED_USER.nickname,
          avatar: fileOf(SUSPENDED_AVATAR_ID, ['user_suspended', 'auto']),
          registeredAt: SUSPENDED_USER.registeredAt,
          disposableEmail: 'undetermined',
          status: 'suspended',
          suspendedAt: SUSPENDED_AT,
          latestSuspension: {
            reason: LATEST_SUSPENSION.reason,
            occurredAt: LATEST_SUSPENSION.occurredAt,
          },
        },
        {
          userId: UNVERIFIED_ID,
          handle: UNVERIFIED_USER.handle,
          nickname: UNVERIFIED_USER.nickname,
          avatar: null,
          registeredAt: UNVERIFIED_USER.registeredAt,
          disposableEmail: 'unverified',
          status: 'active',
          suspendedAt: null,
          latestSuspension: null,
        },
        {
          userId: NO_RECORD_SUSPENDED_ID,
          handle: NO_RECORD_SUSPENDED_USER.handle,
          nickname: NO_RECORD_SUSPENDED_USER.nickname,
          avatar: null,
          registeredAt: NO_RECORD_SUSPENDED_USER.registeredAt,
          disposableEmail: 'regular',
          status: 'suspended',
          suspendedAt: SUSPENDED_AT,
          latestSuspension: null,
        },
      ]);
      expect(harness.summaryLookups).toEqual([
        {
          ids: [ACTIVE_ID, SUSPENDED_ID, UNVERIFIED_ID, NO_RECORD_SUSPENDED_ID],
          scope: 'not-withdrawn',
        },
      ]);
      expect(harness.fileLookups).toEqual([
        [ACTIVE_AVATAR_ID, SUSPENDED_AVATAR_ID, ERASED_AVATAR_ID],
      ]);
      expect(harness.latestLookups).toEqual([
        {
          targetIds: [SUSPENDED_ID, NO_RECORD_SUSPENDED_ID],
          actions: ['user.suspend'],
        },
      ]);
    });

    test('使い捨ての判定は確認前を未確認、判定の無い確認済みを判定できずにする', async () => {
      const harness = harnessOf({
        users: [
          userOf(ACTIVE_ID, 1, {
            emailVerified: false,
            disposableEmailStatus: 'disposable',
          }),
          userOf(SUSPENDED_ID, 2, { disposableEmailStatus: 'undetermined' }),
          userOf(UNVERIFIED_ID, 3, { disposableEmailStatus: 'regular' }),
        ],
      });

      const page = await harness.list();

      expect(page.users.map(({ disposableEmail }) => disposableEmail)).toEqual([
        'unverified',
        'undetermined',
        'regular',
      ]);
    });

    test('照会で返らない利用者のプロフィール画像は無しにする', async () => {
      const harness = harnessOf({ users: [ACTIVE_USER], summaries: [] });

      const page = await harness.list();

      expect(page.users[0]?.avatar).toBeNull();
    });

    test('プロフィール画像と停止中の利用者が無いページは、画像と記録を照会しない', async () => {
      const harness = harnessOf({
        users: [ACTIVE_USER],
        summaries: [summaryOf(ACTIVE_USER, null)],
      });

      await harness.list();

      expect(harness.calls).toEqual(['users.search', 'profiles.findSummaries']);
    });

    test('空のページは上流の検索の他に照会しない', async () => {
      const harness = harnessOf({ users: [], nextCursor: null });

      const page = await harness.list();

      expect(page).toEqual({ users: [], nextCursor: null });
      expect(harness.calls).toEqual(['users.search']);
    });

    test('上流の不正な位置の拒否はそのまま投げ、他の照会と記録をしない', async () => {
      const error = new AppError({
        kind: 'bad_request',
        code: 'invalid_cursor',
        message: 'ページの位置の指定が正しくありません。',
      });
      const harness = harnessOf({ searchError: error });

      const caught = await caughtOf(
        harness.list({ filter: { email: SEARCHED_EMAIL }, after: 'broken' }),
      );

      expect(caught).toBe(error);
      expect(harness.calls).toEqual(['users.search']);
    });

    test('結果にメールアドレスと仮名化IDを含めない', async () => {
      const harness = harnessOf(FULL_PAGE);

      const page = await harness.list({ filter: { email: SEARCHED_EMAIL } });

      const serialized = JSON.stringify(page);
      expect(serialized).not.toContain(SEARCHED_EMAIL);
      expect(serialized).not.toContain(pseudonymousIdOf(1));
      for (const user of page.users) {
        expect(Object.keys(user).sort()).toEqual([
          'avatar',
          'disposableEmail',
          'handle',
          'latestSuspension',
          'nickname',
          'registeredAt',
          'status',
          'suspendedAt',
          'userId',
        ]);
      }
    });
  });

  describe('メールアドレスの絞り込みの記録', () => {
    test('結果に表示する利用者の仮名化IDを検索文字列なしで記録してから返す', async () => {
      const harness = harnessOf(FULL_PAGE);

      const page = await harness.list({
        filter: { email: SEARCHED_EMAIL, status: 'suspended' },
      });

      expect(harness.recorded).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'user.email-search',
          targetIds: [
            pseudonymousIdOf(1),
            pseudonymousIdOf(2),
            pseudonymousIdOf(3),
            pseudonymousIdOf(4),
          ],
          occurredAt: AT,
        },
      ]);
      expect(JSON.stringify(harness.recorded)).not.toContain(SEARCHED_EMAIL);
      expect(harness.calls.at(-1)).toBe('auditLog.record');
      expect(page.users).toHaveLength(4);
    });

    test('0件の結果は対象なしで記録する', async () => {
      const harness = harnessOf({ users: [] });

      const page = await harness.list({ filter: { email: SEARCHED_EMAIL } });

      expect(page.users).toEqual([]);
      expect(harness.recorded).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action: 'user.email-search',
          targetIds: [],
          occurredAt: AT,
        },
      ]);
    });

    test('記録に失敗したら結果を返さずに失敗を投げる', async () => {
      const error = new Error('監査ログの書き込みに失敗しました');
      const harness = harnessOf({ ...FULL_PAGE, recordError: error });

      const caught = await caughtOf(
        harness.list({ filter: { email: SEARCHED_EMAIL } }),
      );

      expect(caught).toBe(error);
      expect(harness.recorded).toHaveLength(1);
    });

    test('メールアドレスの絞り込みが無ければ記録しない', async () => {
      const harness = harnessOf(FULL_PAGE);

      await harness.list({
        filter: { handle: 'han', nickname: 'ニック', status: 'active' },
      });

      expect(harness.recorded).toEqual([]);
      expect(harness.calls).not.toContain('auditLog.record');
    });
  });
});

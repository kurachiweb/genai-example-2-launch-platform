import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import { UPLOAD_FILE_NAME_HEADER } from '../../common-lib/media/upload-protocol.ts';
import {
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_PURPOSE,
} from '../../common-lib/profile/profile-input-rules.ts';
import { userFollows } from '../../db/schema/follow/user-follows.ts';
import { users } from '../../db/schema/identity/users.ts';
import { userPreviousHandles } from '../../db/schema/profile/user-previous-handles.ts';
import { userProfiles } from '../../db/schema/profile/user-profiles.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import { resolveHandle } from '../../lib/workers/handles/handle-queries.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import {
  fileIdOf,
  insertFile,
  readFileIds,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { USER_HANDLE_NAMESPACE } from '../../lib/workers/profile/user-handle-namespace.ts';
import type { UploadPurposeRegistry } from '../../lib/core/media/upload-purpose.ts';
import type { CurrentUser } from '../../lib/core/identity/account-guard.ts';
import type { SessionView } from '../../lib/core/session/session-view.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearMediaState,
  countRecords,
  pngBytes,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import {
  activatedSubscriptionRow,
  clearUltrasTables,
  insertSubscriptionRow,
} from '../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { clearProfilePlatformTables } from '../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { callInternal } from '../../test/support/gateway-test-harness.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  HandleAvailability,
  UserLifecycleCommitter,
} from '../application/identity/ports.ts';
import { planProfileEdit } from '../domain/profile/profile-edit-plan.ts';
import type { InquirerProfiles } from '../application/inquiry/ports.ts';
import type { SessionIssuer } from '../application/identity/session-issuer.ts';
import {
  type HandleAvailabilityChecker,
  StoreHandleAvailabilityChecker,
} from '../application/profile/handle-availability-checker.ts';
import {
  type MyProfileReader,
  StoreMyProfileReader,
} from '../application/profile/my-profile-reader.ts';
import type { FollowListReader } from '../application/profile/follow-list-reader.ts';
import type { FollowService } from '../application/profile/follow-service.ts';
import type {
  FollowStore,
  ProfileStore,
  PublicProfileStore,
} from '../application/profile/ports.ts';
import {
  type ProfileEditor,
  StoreProfileEditor,
} from '../application/profile/profile-editor.ts';
import { StoreFollowListReader } from '../application/profile/follow-list-reader.ts';
import { StoreFollowService } from '../application/profile/follow-service.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import {
  DefaultPublicProfileReader,
  type PublicProfileReader,
} from '../application/profile/public-profile-reader.ts';
import { OrphanedFileSweepJob } from '../application/profile/jobs/orphaned-file-sweep-job.ts';
import { UserHandleAvailability } from '../application/profile/user-handle-availability.ts';
import { D1FollowStore } from '../infrastructure/profile/d1-follow-store.ts';
import { D1ProfileStore } from '../infrastructure/profile/d1-profile-store.ts';
import { ProfileInquirerProfiles } from '../infrastructure/profile/profile-inquirer-profiles.ts';
import { D1PublicProfileStore } from '../infrastructure/profile/d1-public-profile-store.ts';
import { ProfileWithdrawalSyncHandler } from '../infrastructure/profile/profile-withdrawal-sync-handler.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { HANDLE_AVAILABILITY } from './identity-registrations.ts';
import * as mainModule from '../index.ts';
import { MODULES } from './modules.ts';

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';

const OWNER = 1;
const OTHER = 2;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

async function insertPreviousHandle(
  ownerIndex: number,
  handle: string,
): Promise<void> {
  await db.insert(userPreviousHandles).values({
    id: `01JC0PRVHDL${String(ownerIndex).padStart(15, '0')}`,
    ownerId: userIdOf(ownerIndex),
    handle,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
  });
}

async function readPreviousHandles(): Promise<readonly string[]> {
  const rows = await db
    .select({ handle: userPreviousHandles.handle })
    .from(userPreviousHandles);
  return rows.map(({ handle }) => handle);
}

async function issueUserSession(userIndex: number): Promise<string> {
  const issued = await createContainer()
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });
  return issued.token;
}

beforeEach(async () => {
  await db.delete(userPreviousHandles);
  await db.delete(userFollows);
  await db.delete(userProfiles);
  await clearUltrasTables();
  await clearProfilePlatformTables();
});

describe('APIサーバーのプロフィールのモジュールの束縛', () => {
  test('処理単位のコンテナからプロフィールのストアとユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<ProfileStore>(PROFILE_TYPES.ProfileStore),
    ).toBeInstanceOf(D1ProfileStore);
    expect(
      container.get<ProfileEditor>(PROFILE_TYPES.ProfileEditor),
    ).toBeInstanceOf(StoreProfileEditor);
    expect(
      container.get<MyProfileReader>(PROFILE_TYPES.MyProfileReader),
    ).toBeInstanceOf(StoreMyProfileReader);
    expect(
      container.get<HandleAvailabilityChecker>(
        PROFILE_TYPES.HandleAvailabilityChecker,
      ),
    ).toBeInstanceOf(StoreHandleAvailabilityChecker);
  });

  test('公開プロフィールの照会のストアとユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<PublicProfileStore>(PROFILE_TYPES.PublicProfileStore),
    ).toBeInstanceOf(D1PublicProfileStore);
    expect(
      container.get<PublicProfileReader>(PROFILE_TYPES.PublicProfileReader),
    ).toBeInstanceOf(DefaultPublicProfileReader);
  });

  test('フォローのストアとユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<FollowStore>(PROFILE_TYPES.FollowStore),
    ).toBeInstanceOf(D1FollowStore);
    expect(
      container.get<FollowService>(PROFILE_TYPES.FollowService),
    ).toBeInstanceOf(StoreFollowService);
    expect(
      container.get<FollowListReader>(PROFILE_TYPES.FollowListReader),
    ).toBeInstanceOf(StoreFollowListReader);
  });

  test('問い合わせの利用者の表示の照会は、画像付きの実装に解決する', () => {
    expect(
      createContainer().get<InquirerProfiles>(
        PROFILE_TYPES.ProfileInquirerProfiles,
      ),
    ).toBeInstanceOf(ProfileInquirerProfiles);
  });

  test('退会の同期の波及処理は、処理単位のコンテナでProfileWithdrawalSyncHandlerに解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        PROFILE_TYPES.ProfileWithdrawalSyncHandler,
      ),
    ).toBeInstanceOf(ProfileWithdrawalSyncHandler);
  });

  test('保有者の居ないファイルの削除のジョブは、処理単位のコンテナでOrphanedFileSweepJobに解決する', () => {
    expect(
      createContainer().get<ScheduledJobHandler>(
        PROFILE_TYPES.OrphanedFileSweepJob,
      ),
    ).toBeInstanceOf(OrphanedFileSweepJob);
  });

  test('初期ハンドルの判定は、プロフィールの識別子と登録箇所の識別子とidentity-authの識別子の3経路でUserHandleAvailabilityに解決する', () => {
    const container = createContainer();

    expect(HANDLE_AVAILABILITY).toBe(PROFILE_TYPES.UserHandleAvailability);
    expect(
      container.get<HandleAvailability>(PROFILE_TYPES.UserHandleAvailability),
    ).toBeInstanceOf(UserHandleAvailability);
    expect(
      container.get<HandleAvailability>(HANDLE_AVAILABILITY),
    ).toBeInstanceOf(UserHandleAvailability);
    expect(
      container.get<HandleAvailability>(IDENTITY_TYPES.HandleAvailability),
    ).toBeInstanceOf(UserHandleAvailability);
  });
});

describe('登録時の初期ハンドルの判定', () => {
  function availability(): HandleAvailability {
    return createContainer().get<HandleAvailability>(
      IDENTITY_TYPES.HandleAvailability,
    );
  }

  beforeEach(async () => {
    await insertUser(OWNER, { handle: 'Owner0Handle1' });
    await insertUser(OTHER, { handle: 'other0handle' });
    await insertPreviousHandle(OTHER, 'Other0Former');
  });

  test('誰も使っていないハンドルは使える', async () => {
    expect(await availability().isAvailable('free0handle1')).toBe(true);
  });

  test('他人の現在のハンドルは、大文字小文字を区別せずに使えない', async () => {
    const handles = availability();

    expect(await handles.isAvailable('OTHER0HANDLE')).toBe(false);
    expect(await handles.isAvailable('other0handle')).toBe(false);
  });

  test('他人の旧ハンドルは、大文字小文字を区別せずに使えず、登録では解放しない', async () => {
    const handles = availability();

    expect(await handles.isAvailable('other0former')).toBe(false);
    expect(await handles.isAvailable('OTHER0FORMER')).toBe(false);
    expect(await readPreviousHandles()).toEqual(['Other0Former']);
  });

  test.each(['admin', 'Administrator', 'LAUNCH-STADIUM', 'support'])(
    '予約語(%s)は使えない',
    async (handle) => {
      expect(await availability().isAvailable(handle)).toBe(false);
    },
  );
});

describe('プロフィール画像のアップロードの用途', () => {
  beforeEach(async () => {
    await clearMediaState();
  });

  function avatarUploadRequest(token: string, byteLength: number): Request {
    return new Request(
      `${BASE_URL}/internal/media/uploads/${USER_AVATAR_PURPOSE}`,
      {
        method: 'POST',
        headers: {
          [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
          [GATEWAY_HEADERS.sessionToken]: token,
          [UPLOAD_FILE_NAME_HEADER]: 'avatar.png',
          'Content-Type': 'image/png',
          'Content-Length': String(byteLength),
        },
        body: pngBytes(16, 16, byteLength),
      },
    );
  }

  test('画像の5形式を512,000バイトまで利用者だけが画像の保存先へアップロードできる用途として登録する', () => {
    const purpose = createContainer()
      .get<UploadPurposeRegistry>(MEDIA_TYPES.UploadPurposeRegistry)
      .find(USER_AVATAR_PURPOSE);

    expect(purpose).toEqual({
      name: 'user-avatar',
      storage: 'images',
      uploaderKinds: ['user'],
      allowedTypes: IMAGE_MEDIA_TYPES,
      maxBytes: 512_000,
    });
    expect(USER_AVATAR_MAX_BYTES).toBe(512_000);
    expect(IMAGE_MEDIA_TYPES).toHaveLength(5);
  });

  test('利用者が512,001バイトの画像をアップロードすると、413で拒否し記録を作らない', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await callInternal(
      'client',
      avatarUploadRequest(token, USER_AVATAR_MAX_BYTES + 1),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'file_too_large' },
    });
    expect(await countRecords()).toBe(0);
  });

  test('利用者が512,000バイトの画像をアップロードすると、201で受け付ける', async () => {
    await insertUser(OWNER, { emailVerifiedAt: T0 });
    const token = await issueUserSession(OWNER);

    const response = await callInternal(
      'client',
      avatarUploadRequest(token, USER_AVATAR_MAX_BYTES),
    );

    expect(response.status).toBe(201);
    expect(await countRecords()).toBe(1);
  });
});

describe('公開プロフィールの照会(実物の束縛)', () => {
  const TARGET = 3;

  beforeEach(async () => {
    await insertUser(OWNER, { handle: 'Owner0Handle1', nickname: 'オーナー' });
    await insertUser(OTHER, { handle: 'other0handle', nickname: '他人' });
    await insertUser(TARGET, { handle: 'Target', nickname: 'ターゲット' });
  });

  const guestSession: SessionView = {
    principal: () => Promise.resolve({ kind: 'anonymous' }),
  };

  const sessionOf = (userIndex: number): SessionView => ({
    principal: () =>
      Promise.resolve({
        kind: 'authenticated',
        subjectKind: 'user',
        subjectId: userIdOf(userIndex),
        sessionId: '01JC0SESSION000000000000001',
      }),
  });

  const reader = () =>
    createContainer().get<PublicProfileReader>(
      PROFILE_TYPES.PublicProfileReader,
    );

  const suspend = (userIndex: number) =>
    db
      .update(users)
      .set({ status: 'suspended', suspendedAt: T0 })
      .where(eq(users.id, userIdOf(userIndex)));

  test('現在のハンドルを大文字小文字を区別せずに解決し、閲覧者のフォローの有無とフォロワー数を返す', async () => {
    await db.insert(userFollows).values({
      id: '01JC0FLW000000000000000301',
      followerId: userIdOf(OTHER),
      followeeId: userIdOf(TARGET),
      createdAt: T0,
      updatedAt: T0,
    });

    const result = await reader().find(sessionOf(OTHER), 'TARGET');

    expect(result).toMatchObject({
      kind: 'profile',
      profile: {
        handle: 'Target',
        nickname: 'ターゲット',
        followerCount: 1,
        ultras: false,
        viewerRelation: 'following',
      },
    });
  });

  test('Ultrasの有効な加入があれば、判定サービスの結果を反映する', async () => {
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, { userId: userIdOf(TARGET) }),
    );

    const result = await reader().find(guestSession, 'target');

    expect(result).toMatchObject({
      kind: 'profile',
      profile: { ultras: true, viewerRelation: 'guest' },
    });
  });

  test('旧ハンドルは保有者の現在のハンドルへ転送し、保有者が停止中なら本人以外にはnot-foundにする', async () => {
    await insertPreviousHandle(TARGET, 'Target-Old');

    expect(await reader().find(guestSession, 'target-old')).toEqual({
      kind: 'redirect',
      handle: 'Target',
    });

    await suspend(TARGET);

    expect(await reader().find(guestSession, 'target-old')).toEqual({
      kind: 'not-found',
    });
    expect(await reader().find(sessionOf(TARGET), 'target-old')).toEqual({
      kind: 'redirect',
      handle: 'Target',
    });
  });

  test('停止中の利用者は本人にだけ停止中の印を付けて表示し、他人にはnot-foundにする', async () => {
    await suspend(TARGET);

    expect(await reader().find(sessionOf(OTHER), 'target')).toEqual({
      kind: 'not-found',
    });
    expect(await reader().find(sessionOf(TARGET), 'target')).toMatchObject({
      kind: 'profile',
      profile: { suspended: true, viewerRelation: 'owner' },
    });
  });

  test('退会済みと存在しないハンドルと形式違反はnot-foundにする', async () => {
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(eq(users.id, userIdOf(TARGET)));

    expect(await reader().find(guestSession, 'target')).toEqual({
      kind: 'not-found',
    });
    expect(await reader().find(guestSession, 'nobody')).toEqual({
      kind: 'not-found',
    });
    expect(await reader().find(guestSession, 'bad handle')).toEqual({
      kind: 'not-found',
    });
  });
});

describe('フォローと自分の一覧(実物の束縛)', () => {
  const TARGET = 3;

  beforeEach(async () => {
    await insertUser(OWNER, { handle: 'Owner0Handle1', nickname: 'オーナー' });
    await insertUser(TARGET, { handle: 'Target', nickname: 'ターゲット' });
  });

  const currentUserOfIndex = (userIndex: number): CurrentUser =>
    ({
      principal: {
        kind: 'authenticated',
        subjectKind: 'user',
        subjectId: userIdOf(userIndex),
        sessionId: '01JC0SESSION000000000000001',
      },
      user: { id: userIdOf(userIndex) },
    }) as CurrentUser;

  test('旧ハンドルでフォローして一覧に現れ、解除すると一覧から消える', async () => {
    await insertPreviousHandle(TARGET, 'target-old');
    const container = createContainer();
    const service = container.get<FollowService>(PROFILE_TYPES.FollowService);
    const reader = container.get<FollowListReader>(
      PROFILE_TYPES.FollowListReader,
    );
    const owner = currentUserOfIndex(OWNER);

    const followed = await service.follow(owner, 'TARGET-OLD');
    const listed = await reader.list(owner, {
      direction: 'following',
      first: 20,
      after: undefined,
    });
    const unfollowed = await service.unfollow(owner, 'target');
    const afterUnfollow = await reader.list(owner, {
      direction: 'following',
      first: 20,
      after: undefined,
    });

    expect(followed).toEqual({
      handle: 'Target',
      following: true,
      followerCount: 1,
    });
    expect(listed.map(({ user }) => user.handle)).toEqual(['Target']);
    expect(unfollowed).toEqual({
      handle: 'Target',
      following: false,
      followerCount: 0,
    });
    expect(afterUnfollow).toEqual([]);
  });

  test('停止中の相手はフォローできず、すでにフォロー中なら解除はできる', async () => {
    const service = createContainer().get<FollowService>(
      PROFILE_TYPES.FollowService,
    );
    const owner = currentUserOfIndex(OWNER);
    await service.follow(owner, 'target');
    await db
      .update(users)
      .set({ status: 'suspended', suspendedAt: T0 })
      .where(eq(users.id, userIdOf(TARGET)));

    await expect(service.follow(owner, 'target')).rejects.toMatchObject({
      code: 'follow_target_unavailable',
    });
    const state = await service.unfollow(owner, 'target');

    expect(state.following).toBe(false);
  });
});

describe('退会の同期の波及処理の登録', () => {
  const TARGET = 3;
  const WITHDRAWN_AT = new Date('2026-11-05T01:00:00.000Z');
  const FOLLOW_IDS = [
    '01JC0FLW000000000000000001',
    '01JC0FLW000000000000000002',
    '01JC0FLW000000000000000003',
  ] as const;

  beforeEach(async () => {
    await insertUser(OWNER, { handle: 'Owner0Handle1', nickname: 'オーナー' });
    await insertUser(OTHER, { handle: 'other0handle', nickname: '他人' });
    await insertUser(TARGET, { handle: 'Target', nickname: 'ターゲット' });
    await insertPreviousHandle(TARGET, 'target-old');
    await db.insert(userFollows).values([
      {
        id: FOLLOW_IDS[0],
        followerId: userIdOf(TARGET),
        followeeId: userIdOf(OWNER),
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: FOLLOW_IDS[1],
        followerId: userIdOf(OTHER),
        followeeId: userIdOf(TARGET),
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: FOLLOW_IDS[2],
        followerId: userIdOf(OWNER),
        followeeId: userIdOf(OTHER),
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
  });

  const withdraw = (expectedVersion: number) =>
    createContainer()
      .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
      .commit({
        kind: 'withdraw',
        userId: userIdOf(TARGET),
        expectedVersion,
        at: WITHDRAWN_AT,
      });

  const readFollowDeletion = async () => {
    const rows = await db
      .select({ id: userFollows.id, deletedAt: userFollows.deletedAt })
      .from(userFollows);
    return rows.toSorted((a, b) => a.id.localeCompare(b.id));
  };

  const readPreviousDeletion = async () =>
    db
      .select({
        handle: userPreviousHandles.handle,
        deletedAt: userPreviousHandles.deletedAt,
      })
      .from(userPreviousHandles);

  test('退会の確定で、旧ハンドルと両方向のフォローが同じ一括の書き込みで論理削除される', async () => {
    await withdraw(0);

    expect(await readPreviousDeletion()).toEqual([
      { handle: 'target-old', deletedAt: WITHDRAWN_AT },
    ]);
    expect(await readFollowDeletion()).toEqual([
      { id: FOLLOW_IDS[0], deletedAt: WITHDRAWN_AT },
      { id: FOLLOW_IDS[1], deletedAt: WITHDRAWN_AT },
      { id: FOLLOW_IDS[2], deletedAt: null },
    ]);
  });

  test('退会した利用者の旧ハンドルでの転送は止まる', async () => {
    expect(
      await resolveHandle(db, USER_HANDLE_NAMESPACE, 'target-old'),
    ).toEqual({ kind: 'previous', ownerId: userIdOf(TARGET) });

    await withdraw(0);

    expect(
      await resolveHandle(db, USER_HANDLE_NAMESPACE, 'target-old'),
    ).toEqual({ kind: 'none' });
  });

  test('退会した利用者の旧ハンドルを他の利用者が設定すると、その行は物理削除される', async () => {
    await withdraw(0);

    const result = await createContainer()
      .get<ProfileStore>(PROFILE_TYPES.ProfileStore)
      .save({
        userId: userIdOf(OWNER),
        expectedHandle: 'Owner0Handle1',
        nickname: 'オーナー',
        plan: planProfileEdit(
          { handle: 'Owner0Handle1', avatarFileId: null },
          { handle: 'target-old', avatarFileId: null },
        ),
        handle: 'target-old',
        headline: null,
        bioMarkdown: null,
        avatarFileId: null,
        websites: [],
        now: new Date('2026-11-06T00:00:00.000Z'),
      });

    expect(result).toBe('saved');
    const previous = await db
      .select({
        ownerId: userPreviousHandles.ownerId,
        handle: userPreviousHandles.handle,
      })
      .from(userPreviousHandles);
    expect(previous).toEqual([
      { ownerId: userIdOf(OWNER), handle: 'Owner0Handle1' },
    ]);
  });

  test('読み取った版が古い退会は確定せず、旧ハンドルとフォローの論理削除も取り消される', async () => {
    await expect(withdraw(1)).rejects.toMatchObject({
      code: 'account_state_conflict',
    });

    expect(await readPreviousDeletion()).toEqual([
      { handle: 'target-old', deletedAt: null },
    ]);
    expect(await readFollowDeletion()).toEqual([
      { id: FOLLOW_IDS[0], deletedAt: null },
      { id: FOLLOW_IDS[1], deletedAt: null },
      { id: FOLLOW_IDS[2], deletedAt: null },
    ]);
  });
});

describe('保有者の居ないファイルの削除の定期実行', () => {
  const DAILY_CRON = '21 12 * * *';
  const DAILY_TIME = new Date(Date.UTC(2026, 10, 3, 12, 21));
  const JOB_NAME = 'user-profile-social.orphaned-file-sweep';
  const GHOST = 99;

  interface LoggedObject {
    readonly message: string;
    readonly [property: string]: unknown;
  }

  function recordLogs(): LoggedObject[] {
    const logs: LoggedObject[] = [];
    for (const method of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args[0] as LoggedObject);
      });
    }
    return logs;
  }

  async function runDaily(): Promise<readonly LoggedObject[]> {
    const logs = recordLogs();
    const scheduled = mainModule.default.scheduled;
    if (scheduled === undefined) {
      throw new Error('定期実行のハンドラーがエクスポートされていません');
    }
    const ctx = createExecutionContext();
    await scheduled(
      createScheduledController({
        cron: DAILY_CRON,
        scheduledTime: DAILY_TIME.getTime(),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return logs;
  }

  beforeEach(async () => {
    await clearMediaState();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetSync();
    await clearMediaState();
  });

  test('4:21の起動(21 12 * * *)で、束縛から解決されたジョブが成功し、利用者の存在しない保有者のファイルだけを物理削除して件数をログに出す', async () => {
    await insertUser(OWNER, { handle: 'Owner0Handle1', nickname: 'オーナー' });
    await insertFile(1, { ownerId: userIdOf(OWNER), attachedAt: T0 });
    await insertFile(2, { ownerId: userIdOf(GHOST), attachedAt: T0 });
    await insertFile(3, { ownerId: userIdOf(GHOST), attachedAt: T0 });

    const logs = await runDaily();

    expect(await readFileIds()).toEqual([fileIdOf(1)]);
    const summary = logs.find(
      ({ message }) => message === '定期実行を終えました',
    );
    expect(summary?.['jobs']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: JOB_NAME, result: 'succeeded' }),
      ]),
    );
    expect(
      logs.find(
        ({ message }) => message === '保有者の居ないファイルを物理削除しました',
      ),
    ).toMatchObject({
      level: 'info',
      ownersScanned: 2,
      orphanOwners: 1,
      failedOwners: 0,
      filesErased: 2,
      truncated: false,
    });
  });
});

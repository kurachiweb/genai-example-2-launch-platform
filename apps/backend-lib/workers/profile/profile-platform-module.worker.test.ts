import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { PROFILE_PLATFORM_TYPES } from '../../core/profile/identifiers.ts';
import type {
  FollowerDirectory,
  FollowExport,
  ProfileExport,
  UserProfileDirectory,
} from '../../core/profile/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { T0 } from '../identity/testing/identity-store-fixtures.ts';
import { D1FollowDirectory } from './d1-follow-directory.ts';
import { D1ProfileExport } from './d1-profile-export.ts';
import { D1UserProfileDirectory } from './d1-user-profile-directory.ts';
import { PROFILE_PLATFORM_MODULE } from './profile-platform-module.ts';
import {
  ALICE_ID,
  BOB_ID,
  clearProfilePlatformTables,
  seedProfilePlatformSample,
} from './testing/profile-platform-fixtures.ts';

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [PROFILE_PLATFORM_MODULE],
  );
}

beforeEach(async () => {
  await clearProfilePlatformTables();
  await seedProfilePlatformSample();
});

describe('PROFILE_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      PROFILE_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(PROFILE_PLATFORM_MODULE.name).toBe('profile-platform');
    expect('routes' in PROFILE_PLATFORM_MODULE).toBe(false);
  });

  test('利用者の表示の照会口をD1の実装に解決し、ハンドルを大文字小文字を区別せず引ける', async () => {
    const directory = createContainer().get<UserProfileDirectory>(
      PROFILE_PLATFORM_TYPES.UserProfileDirectory,
    );

    expect(directory).toBeInstanceOf(D1UserProfileDirectory);
    await expect(directory.resolveHandle('ALICE')).resolves.toEqual({
      kind: 'current',
      user: {
        userId: ALICE_ID,
        handle: 'Alice',
        nickname: 'アリス',
        avatarFileId: null,
        suspended: false,
      },
    });
  });

  test('プロフィールのデータエクスポートの照会口をD1の実装に解決し、プロフィールを引ける', async () => {
    const profileExport = createContainer().get<ProfileExport>(
      PROFILE_PLATFORM_TYPES.ProfileExport,
    );

    expect(profileExport).toBeInstanceOf(D1ProfileExport);
    await expect(profileExport.find(ALICE_ID)).resolves.toMatchObject({
      handle: 'Alice',
      headline: '個人開発者',
      websites: [{ name: 'GitHub', url: 'https://github.example/alice' }],
    });
  });

  test('フォローのデータエクスポートの照会口をD1の実装に解決し、フォロー中の相手を引ける', async () => {
    const followExport = createContainer().get<FollowExport>(
      PROFILE_PLATFORM_TYPES.FollowExport,
    );

    expect(followExport).toBeInstanceOf(D1FollowDirectory);
    await expect(followExport.listFollowing(ALICE_ID)).resolves.toEqual([
      { handle: 'bob', nickname: 'ボブ', followedAt: T0 },
    ]);
  });

  test('フォロワーの照会口をD1の実装に解決し、フォロワーのIDを引ける', async () => {
    const followers = createContainer().get<FollowerDirectory>(
      PROFILE_PLATFORM_TYPES.FollowerDirectory,
    );

    expect(followers).toBeInstanceOf(D1FollowDirectory);
    await expect(
      followers.listVisibleFollowerIds({
        after: undefined,
        followeeId: BOB_ID,
        limit: 10,
      }),
    ).resolves.toEqual({ followerIds: [ALICE_ID], next: undefined });
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも4つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer(kind);

      for (const identifier of Object.values(PROFILE_PLATFORM_TYPES)) {
        expect(container.get(identifier)).toBeDefined();
      }
    },
  );

  test('照会口は処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const identifier of Object.values(PROFILE_PLATFORM_TYPES)) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });
});

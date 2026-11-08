import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { PROFILE_PLATFORM_TYPES } from '../../lib/core/profile/identifiers.ts';
import type {
  FollowerDirectory,
  FollowExport,
  ProfileExport,
  UserProfileDirectory,
} from '../../lib/core/profile/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1FollowDirectory } from '../../lib/workers/profile/d1-follow-directory.ts';
import { D1ProfileExport } from '../../lib/workers/profile/d1-profile-export.ts';
import { D1UserProfileDirectory } from '../../lib/workers/profile/d1-user-profile-directory.ts';
import {
  ALICE_ID,
  BOB_ID,
  clearProfilePlatformTables,
  seedProfilePlatformSample,
} from '../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { MODULES } from './modules.ts';

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

beforeEach(async () => {
  await clearProfilePlatformTables();
  await seedProfilePlatformSample();
});

describe('APIサーバーのプロフィールの共通の束縛', () => {
  test('処理単位のコンテナから利用者の表示の照会をD1の実装に解決し、ハンドルを引ける', async () => {
    const directory = createContainer().get<UserProfileDirectory>(
      PROFILE_PLATFORM_TYPES.UserProfileDirectory,
    );

    expect(directory).toBeInstanceOf(D1UserProfileDirectory);
    await expect(directory.resolveHandle('alice')).resolves.toMatchObject({
      kind: 'current',
      user: { userId: ALICE_ID, handle: 'Alice' },
    });
  });

  test('処理単位のコンテナからプロフィールのデータエクスポートの照会をD1の実装に解決し、プロフィールを引ける', async () => {
    const profileExport = createContainer().get<ProfileExport>(
      PROFILE_PLATFORM_TYPES.ProfileExport,
    );

    expect(profileExport).toBeInstanceOf(D1ProfileExport);
    await expect(profileExport.find(ALICE_ID)).resolves.toMatchObject({
      handle: 'Alice',
      headline: '個人開発者',
    });
  });

  test('処理単位のコンテナからフォローのデータエクスポートの照会とフォロワーの照会を同じD1の実装に解決する', async () => {
    const container = createContainer();
    const followExport = container.get<FollowExport>(
      PROFILE_PLATFORM_TYPES.FollowExport,
    );
    const followers = container.get<FollowerDirectory>(
      PROFILE_PLATFORM_TYPES.FollowerDirectory,
    );

    expect(followExport).toBeInstanceOf(D1FollowDirectory);
    expect(followers).toBeInstanceOf(D1FollowDirectory);
    await expect(followExport.listFollowing(ALICE_ID)).resolves.toHaveLength(1);
    await expect(
      followers.listVisibleFollowerIds({
        after: undefined,
        followeeId: BOB_ID,
        limit: 10,
      }),
    ).resolves.toEqual({ followerIds: [ALICE_ID], next: undefined });
  });
});

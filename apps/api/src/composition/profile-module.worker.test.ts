import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { IMAGE_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import { UPLOAD_FILE_NAME_HEADER } from '../../common-lib/media/upload-protocol.ts';
import {
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_PURPOSE,
} from '../../common-lib/profile/profile-input-rules.ts';
import { userPreviousHandles } from '../../db/schema/profile/user-previous-handles.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { UploadPurposeRegistry } from '../../lib/core/media/upload-purpose.ts';
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
import { clearProfilePlatformTables } from '../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { callInternal } from '../../test/support/gateway-test-harness.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { HandleAvailability } from '../application/identity/ports.ts';
import type { SessionIssuer } from '../application/identity/session-issuer.ts';
import {
  type HandleAvailabilityChecker,
  StoreHandleAvailabilityChecker,
} from '../application/profile/handle-availability-checker.ts';
import {
  type MyProfileReader,
  StoreMyProfileReader,
} from '../application/profile/my-profile-reader.ts';
import type { ProfileStore } from '../application/profile/ports.ts';
import {
  type ProfileEditor,
  StoreProfileEditor,
} from '../application/profile/profile-editor.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import { UserHandleAvailability } from '../application/profile/user-handle-availability.ts';
import { D1ProfileStore } from '../infrastructure/profile/d1-profile-store.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { HANDLE_AVAILABILITY } from './identity-registrations.ts';
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

import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { USER_AVATAR_PURPOSE } from '../../../../../common-lib/profile/profile-input-rules.ts';
import { userFollows } from '../../../../../db/schema/follow/user-follows.ts';
import { users } from '../../../../../db/schema/identity/users.ts';
import { userPreviousHandles } from '../../../../../db/schema/profile/user-previous-handles.ts';
import { userProfileWebsites } from '../../../../../db/schema/profile/user-profile-websites.ts';
import { userProfiles } from '../../../../../db/schema/profile/user-profiles.ts';
import { apiKeys } from '../../../../../db/schema/public-api/api-keys.ts';
import { ultrasSubscriptions } from '../../../../../db/schema/ultras/ultras-subscriptions.ts';
import { createKeyedHasher } from '../../../../../lib/core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../../../../lib/core/di/app-module.ts';
import { insertPreviousHandle } from '../../../../../lib/workers/handles/testing/handle-fixtures.ts';
import type { PlatformHonoEnv } from '../../../../../lib/workers/http/hono-env.ts';
import {
  after,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearMediaTables,
  fileIdOf,
  insertFile,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearProfilePlatformTables } from '../../../../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { insertApiKey } from '../../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import {
  activatedSubscriptionRow,
  insertSubscriptionRow,
} from '../../../../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import {
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  issueUserSession,
  readProfileRows,
  updateInput,
  updateMyProfile,
} from '../../../../../test/support/profile-graphql-operations.ts';
import { createPublicApiRestHarness } from '../../../../../test/support/public-api-rest-harness.ts';
import {
  EditorPublicProfileUpdater,
  type PublicProfileUpdater,
} from '../../../../application/public-api/public-profile-updater.ts';
import { PUBLIC_API_TYPES } from '../../../../application/public-api/public-api-types.ts';
import { API_KEY_HASH_PURPOSE } from '../../../../domain/public-api/api-key-token.ts';
import { OPENAPI_DOCUMENT_PATH } from '../../public-api-app.ts';
import {
  MY_PROFILE_PATCH_MESSAGES,
  PROFILE_FIELD_MESSAGES,
} from '../schemas/profiles.ts';
import { publicApiProfileRoutes } from './profile-routes.ts';

// 5.7でapiの束縛のモジュールへ加える部分更新のユースケースを、ここで束縛する
const testModule: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'public-api-profile-routes-test',
  bindings: new ContainerModule(({ bind }) => {
    bind<PublicProfileUpdater>(PUBLIC_API_TYPES.PublicProfileUpdater).to(
      EditorPublicProfileUpdater,
    );
  }),
};

const harness = createPublicApiRestHarness(
  [publicApiProfileRoutes],
  [testModule],
);

const hasher = createKeyedHasher(env.HASH_PEPPER);

const SITE_ORIGIN = env.CLIENT_SITE_ORIGIN;

const IMAGES_ORIGIN = env.IMAGES_ORIGIN;

type ProfileScope = 'none' | 'read' | 'read_write';

type UserColumns = Partial<typeof users.$inferInsert>;

// 利用者単位の回数の記録はテストの間で消せないため、テストごとに別の利用者とキーを使う
let nextHolderIndex = 800;

interface KeyHolder {
  readonly index: number;
  readonly handle: string;
  readonly authorization: string;
}

async function createKeyHolder(
  options: {
    readonly scope?: ProfileScope;
    readonly user?: UserColumns;
  } = {},
): Promise<KeyHolder> {
  const index = nextHolderIndex;
  nextHolderIndex += 1;
  const handle = `holder${String(index)}`;
  const plain = `lsk_${String(index).padStart(43, 'x')}`;
  await insertUser(index, { handle, ...options.user });
  await insertApiKey(index, index, {
    keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
    scopeProfile: options.scope ?? 'read_write',
  });
  return { index, handle, authorization: `Bearer ${plain}` };
}

function get(path: string, holder: KeyHolder) {
  return harness.request(path, {
    headers: { Authorization: holder.authorization },
  });
}

function patch(holder: KeyHolder, body: unknown) {
  return harness.request('/me/profile', {
    method: 'PATCH',
    headers: {
      Authorization: holder.authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly {
      readonly field: string;
      readonly code: string;
      readonly message: string;
    }[];
  };
}

async function errorOf(response: Response): Promise<ErrorBody['error']> {
  const body: ErrorBody = await response.json();
  return body.error;
}

async function dataOf<T>(response: Response): Promise<T> {
  const body: { readonly data: T } = await response.json();
  return body.data;
}

async function readNickname(index: number): Promise<string | undefined> {
  const [row] = await db
    .select({ nickname: users.nickname })
    .from(users)
    .where(eq(users.id, userIdOf(index)));
  return row?.nickname;
}

async function savedProfileOf(index: number) {
  const rows = await readProfileRows(index);
  return {
    nickname: await readNickname(index),
    profile: rows.profile.map(({ headline, bioMarkdown }) => ({
      headline,
      bioMarkdown,
    })),
    websites: rows.websites
      .toSorted((a, b) => a.position - b.position)
      .map(({ position, name, url }) => ({ position, name, url })),
  };
}

const profileIdOf = (index: number): string =>
  `01JC0PR0F${String(index).padStart(17, '0')}`;

async function seedProfile(
  index: number,
  input: {
    readonly headline: string | null;
    readonly bioMarkdown: string | null;
    readonly websites: readonly { name: string | null; url: string }[];
  },
): Promise<void> {
  await db.insert(userProfiles).values({
    id: profileIdOf(index),
    userId: userIdOf(index),
    headline: input.headline,
    bioMarkdown: input.bioMarkdown,
    createdAt: T0,
    updatedAt: T0,
  });
  for (const [position, website] of input.websites.entries()) {
    await db.insert(userProfileWebsites).values({
      id: `01JC0WEB${String(index * 100 + position).padStart(18, '0')}`,
      userId: userIdOf(index),
      position,
      name: website.name,
      url: website.url,
      createdAt: T0,
      updatedAt: T0,
    });
  }
}

async function attachAvatar(index: number, fileIndex: number): Promise<void> {
  await insertFile(fileIndex, {
    purpose: USER_AVATAR_PURPOSE,
    ownerId: userIdOf(index),
    attachedAt: T0,
  });
  await db
    .insert(userProfiles)
    .values({
      id: profileIdOf(index),
      userId: userIdOf(index),
      avatarFileId: fileIdOf(fileIndex),
      createdAt: T0,
      updatedAt: T0,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { avatarFileId: fileIdOf(fileIndex) },
    });
}

async function readAvatarFileId(index: number): Promise<string | null> {
  const [row] = await db
    .select({ avatarFileId: userProfiles.avatarFileId })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userIdOf(index)));
  return row?.avatarFileId ?? null;
}

const avatarUrlOf = (fileIndex: number): string =>
  `${IMAGES_ORIGIN}/${objectKeyOf(fileIndex)}/square-lg.png`;

async function clearTables(): Promise<void> {
  await db.delete(apiKeys);
  await db.delete(userPreviousHandles);
  await clearMediaTables();
  await db.delete(ultrasSubscriptions);
  await clearProfilePlatformTables();
}

beforeEach(clearTables);

afterEach(() => {
  vi.restoreAllMocks();
});

const WEBSITES = [
  { name: 'GitHub', url: 'https://github.example/holder' },
  { name: null, url: 'https://blog.example/' },
];

describe('GET /me/profile', () => {
  test('キーの持ち主のプロフィールを旧ハンドル・画像・外部Webサイト・ページのURLとともに返す', async () => {
    const holder = await createKeyHolder({
      scope: 'read',
      user: { nickname: '持ち主' },
    });
    await seedProfile(holder.index, {
      headline: '個人開発者',
      bioMarkdown: '**自己紹介**',
      websites: WEBSITES,
    });
    await attachAvatar(holder.index, 1);
    await insertPreviousHandle(1, holder.index, 'holder-old');

    const response = await get('/me/profile', holder);

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toEqual({
      handle: holder.handle,
      previous_handle: 'holder-old',
      nickname: '持ち主',
      headline: '個人開発者',
      bio_markdown: '**自己紹介**',
      avatar: { url: avatarUrlOf(1), width: 640, height: 480 },
      websites: WEBSITES,
      profile_url: `${SITE_ORIGIN}/@${holder.handle}`,
    });
  });

  test('停止中の持ち主のキーは403(account_unavailable)を返す', async () => {
    const holder = await createKeyHolder({
      scope: 'read',
      user: { status: 'suspended', suspendedAt: after(1) },
    });

    const response = await get('/me/profile', holder);

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('account_unavailable');
  });

  test('プロフィールの権限の無いキーは403(insufficient_scope)を返す', async () => {
    const holder = await createKeyHolder({ scope: 'none' });

    const response = await get('/me/profile', holder);

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('insufficient_scope');
  });
});

describe('PATCH /me/profile', () => {
  test('指定の項目だけを更新し、指定の無い項目とプロフィール画像を保ったまま更新後のプロフィールを返す', async () => {
    const holder = await createKeyHolder({ user: { nickname: '持ち主' } });
    await seedProfile(holder.index, {
      headline: '個人開発者',
      bioMarkdown: '**自己紹介**',
      websites: WEBSITES,
    });
    await attachAvatar(holder.index, 1);

    const response = await patch(holder, {
      nickname: '  新しい名前  ',
      bio_markdown: null,
    });

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toEqual({
      handle: holder.handle,
      previous_handle: null,
      nickname: '新しい名前',
      headline: '個人開発者',
      bio_markdown: null,
      avatar: { url: avatarUrlOf(1), width: 640, height: 480 },
      websites: WEBSITES,
      profile_url: `${SITE_ORIGIN}/@${holder.handle}`,
    });
    expect(await savedProfileOf(holder.index)).toEqual({
      nickname: '新しい名前',
      profile: [{ headline: '個人開発者', bioMarkdown: null }],
      websites: WEBSITES.map((website, position) => ({ position, ...website })),
    });
    expect(await readAvatarFileId(holder.index)).toBe(fileIdOf(1));
  });

  test('ハンドルを変えると旧ハンドルを返し、自分のプロフィールの読み取りにも反映される', async () => {
    const holder = await createKeyHolder();

    const response = await patch(holder, { handle: 'Renamed-Holder' });

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      handle: 'Renamed-Holder',
      previous_handle: holder.handle,
      profile_url: `${SITE_ORIGIN}/@Renamed-Holder`,
    });
    expect(await dataOf(await get('/me/profile', holder))).toMatchObject({
      handle: 'Renamed-Holder',
      previous_handle: holder.handle,
    });
  });

  test('同じ入力でGraphQLのプロフィールの保存と同じ値を保存する', async () => {
    stubExternalServices();
    const holder = await createKeyHolder();
    const GRAPHQL_USER = 1;
    await insertUser(GRAPHQL_USER, { handle: 'alice' });
    const shared = {
      nickname: '  新しい名前  ',
      headline: '  個人開発者  ',
      websites: [
        { name: '  GitHub ', url: ' https://github.example/alice ' },
        { name: '   ', url: 'http://blog.example/' },
        { name: null, url: 'https://third.example/' },
      ],
    };
    const bio = '  **自己紹介**\n\n[リンク](https://link.example/)\n';

    const graphql = await updateMyProfile(
      updateInput({
        ...shared,
        handle: 'alice',
        expectedHandle: 'alice',
        bio,
      }),
      {
        sessionToken: await issueUserSession(GRAPHQL_USER),
        botToken: botTokenFor('profile_update'),
      },
    );
    const rest = await patch(holder, { ...shared, bio_markdown: bio });

    expect(graphql.errors).toBeUndefined();
    expect(rest.status).toBe(200);
    const restSaved = await savedProfileOf(holder.index);
    expect(restSaved).toEqual(await savedProfileOf(GRAPHQL_USER));
    expect(restSaved).toEqual({
      nickname: '新しい名前',
      profile: [{ headline: '個人開発者', bioMarkdown: bio }],
      websites: [
        { position: 0, name: 'GitHub', url: 'https://github.example/alice' },
        { position: 1, name: null, url: 'http://blog.example/' },
        { position: 2, name: null, url: 'https://third.example/' },
      ],
    });
  });

  test.each([
    [
      'ニックネームの空白だけ',
      { nickname: '   ' },
      'nickname',
      PROFILE_FIELD_MESSAGES.nicknameRequired,
    ],
    [
      'ハンドルの形式違反',
      { handle: '-holder' },
      'handle',
      PROFILE_FIELD_MESSAGES.handleFormat,
    ],
    [
      'ヘッドラインの51文字',
      { headline: 'あ'.repeat(51) },
      'headline',
      PROFILE_FIELD_MESSAGES.headlineTooLong,
    ],
    [
      '自己紹介の5,001文字',
      { bio_markdown: 'あ'.repeat(5001) },
      'bio_markdown',
      '自己紹介は5,000文字以内で入力してください。',
    ],
    [
      'WebサイトのURLの形式違反',
      { websites: [{ name: 'X', url: 'ftp://x.example/' }] },
      'websites.0.url',
      PROFILE_FIELD_MESSAGES.websiteUrlFormat,
    ],
    [
      'プロフィール画像',
      { avatar: null },
      '',
      MY_PROFILE_PATCH_MESSAGES.unknownFields,
    ],
    [
      '未知の項目',
      { nickname: '名前', email: 'x@mail.example' },
      '',
      MY_PROFILE_PATCH_MESSAGES.unknownFields,
    ],
    ['空の本文', {}, '', MY_PROFILE_PATCH_MESSAGES.noFields],
  ])(
    '%sは更新せずに400(validation_error)と項目ごとの理由を返す',
    async (_name, body, field, message) => {
      const holder = await createKeyHolder({ user: { nickname: '持ち主' } });

      const response = await patch(holder, body);

      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([
        expect.objectContaining({ field, message }),
      ]);
      expect(await savedProfileOf(holder.index)).toEqual({
        nickname: '持ち主',
        profile: [],
        websites: [],
      });
    },
  );

  test.each([
    ['予約語', 'admin'],
    ['他の利用者が使用中', 'TAKEN'],
  ])(
    '%sのハンドルは409(handle_unavailable)とhandleの理由を返す',
    async (_name, handle) => {
      const holder = await createKeyHolder();
      await insertUser(1, { handle: 'taken' });

      const response = await patch(holder, { handle });

      expect(response.status).toBe(409);
      const error = await errorOf(response);
      expect(error.code).toBe('handle_unavailable');
      expect(error.details).toEqual([
        expect.objectContaining({ field: 'handle', code: 'unavailable' }),
      ]);
      expect(await dataOf(await get('/me/profile', holder))).toMatchObject({
        handle: holder.handle,
      });
    },
  );

  test('読み取りだけの権限のキーは403(insufficient_scope)を返し、更新しない', async () => {
    const holder = await createKeyHolder({
      scope: 'read',
      user: { nickname: '持ち主' },
    });

    const response = await patch(holder, { nickname: '新しい名前' });

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('insufficient_scope');
    expect(await readNickname(holder.index)).toBe('持ち主');
  });

  test('停止中の持ち主のキーは403(account_unavailable)を返し、更新しない', async () => {
    const holder = await createKeyHolder({
      user: {
        nickname: '持ち主',
        status: 'suspended',
        suspendedAt: after(1),
      },
    });

    const response = await patch(holder, { nickname: '新しい名前' });

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('account_unavailable');
    expect(await readNickname(holder.index)).toBe('持ち主');
  });

  test('本文がJSONでない要求は415(unsupported_media_type)を返す', async () => {
    const holder = await createKeyHolder();

    const response = await harness.request('/me/profile', {
      method: 'PATCH',
      headers: {
        Authorization: holder.authorization,
        'Content-Type': 'text/plain',
      },
      body: 'nickname',
    });

    expect(response.status).toBe(415);
  });
});

describe('GET /users/{handle}', () => {
  const TARGET = 1;

  test('公開プロフィールを、停止中を除いたフォロワー数とUltras加入中かどうかとともに返す', async () => {
    const holder = await createKeyHolder({ scope: 'read' });
    await insertUser(TARGET, { handle: 'Target', nickname: '対象' });
    await seedProfile(TARGET, {
      headline: '個人開発者',
      bioMarkdown: '**自己紹介**',
      websites: WEBSITES,
    });
    await attachAvatar(TARGET, 1);
    await insertUser(2, { handle: 'follower' });
    await insertUser(3, {
      handle: 'suspended-follower',
      status: 'suspended',
      suspendedAt: after(1),
    });
    await db.insert(userFollows).values(
      [holder.index, 2, 3].map((follower, offset) => ({
        id: `01JC0F1W00000000000000000${String(offset + 1)}`,
        followerId: userIdOf(follower),
        followeeId: userIdOf(TARGET),
        createdAt: T0,
        updatedAt: T0,
      })),
    );
    await insertSubscriptionRow(
      activatedSubscriptionRow(1, { userId: userIdOf(TARGET) }),
    );

    const response = await get('/users/target', holder);

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toEqual({
      handle: 'Target',
      nickname: '対象',
      headline: '個人開発者',
      bio_markdown: '**自己紹介**',
      avatar: { url: avatarUrlOf(1), width: 640, height: 480 },
      websites: WEBSITES,
      follower_count: 2,
      ultras: true,
      profile_url: `${SITE_ORIGIN}/@Target`,
    });
  });

  test('Ultrasに加入していない利用者はultrasを偽にし、キーの持ち主自身も未ログインと同じ形で返す', async () => {
    const holder = await createKeyHolder({ scope: 'read' });

    const response = await get(`/users/${holder.handle}`, holder);

    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      handle: holder.handle,
      follower_count: 0,
      ultras: false,
    });
  });

  test('保持中の旧ハンドルは現在のハンドルの同じ経路へ302で転送する', async () => {
    const holder = await createKeyHolder({ scope: 'read' });
    await insertUser(TARGET, { handle: 'target' });
    await insertPreviousHandle(1, TARGET, 'target-old');

    const response = await get('/users/TARGET-OLD?lang=ja', holder);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://api.launch.example/v1/users/target?lang=ja',
    );
  });

  test.each([
    [
      '停止中の利用者',
      'target',
      { status: 'suspended', suspendedAt: after(1) },
    ],
    ['退会済みの利用者', 'target', { deletedAt: after(1) }],
    [
      '停止中の利用者の旧ハンドル',
      'target-old',
      { status: 'suspended', suspendedAt: after(1) },
    ],
    ['存在しない利用者', 'nobody', {}],
    ['形式に合わないハンドル', '-target', {}],
  ] as const)(
    '%sは区別せずに404(user_not_found)を返す',
    async (_name, handle, columns) => {
      const holder = await createKeyHolder({ scope: 'read' });
      await insertUser(TARGET, { handle: 'target', ...columns });
      await insertPreviousHandle(1, TARGET, 'target-old');

      const response = await get(`/users/${handle}`, holder);

      expect(response.status).toBe(404);
      expect(await errorOf(response)).toMatchObject({
        code: 'user_not_found',
        message: 'ユーザーが見つかりません。',
      });
    },
  );

  test('停止中の持ち主のキーでも公開プロフィールを返す', async () => {
    const holder = await createKeyHolder({
      scope: 'read',
      user: { status: 'suspended', suspendedAt: after(1) },
    });
    await insertUser(TARGET, { handle: 'target' });

    const response = await get('/users/target', holder);

    expect(response.status).toBe(200);
  });
});

describe('OpenAPIの仕様書', () => {
  test('3つの経路と、未知の項目を許さない部分更新の本文を載せる', async () => {
    const response = await harness.request(OPENAPI_DOCUMENT_PATH);
    const document: {
      readonly paths: Readonly<
        Record<string, Readonly<Record<string, unknown>>>
      >;
      readonly components: {
        readonly schemas: Readonly<
          Record<
            string,
            {
              readonly additionalProperties?: unknown;
              readonly properties?: Readonly<Record<string, unknown>>;
            }
          >
        >;
      };
    } = await response.json();

    expect(Object.keys(document.paths['/users/{handle}'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/me/profile'] ?? {}).toSorted()).toEqual(
      ['get', 'patch'],
    );
    const patchBody = document.components.schemas.MyProfilePatch;
    expect(patchBody?.additionalProperties).toBe(false);
    expect(Object.keys(patchBody?.properties ?? {}).toSorted()).toEqual([
      'bio_markdown',
      'handle',
      'headline',
      'nickname',
      'websites',
    ]);
    expect(
      document.components.schemas.PublicProfile?.properties,
    ).toHaveProperty('follower_count');
  });
});

import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, test } from 'vitest';

import { USER_AVATAR_PURPOSE } from '../../../../../common-lib/profile/profile-input-rules.ts';
import { userProfiles } from '../../../../../db/schema/profile/user-profiles.ts';
import { createInvocationContainer } from '../../../../../lib/workers/di/invocation-container.ts';
import {
  after,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createMediaPlatformModule } from '../../../../../lib/workers/media/media-platform-module.ts';
import {
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearMediaState } from '../../../../../lib/workers/media/testing/media-operations-fixtures.ts';
import { PROFILE_PLATFORM_MODULE } from '../../../../../lib/workers/profile/profile-platform-module.ts';
import { clearProfilePlatformTables } from '../../../../../lib/workers/profile/testing/profile-platform-fixtures.ts';
import { createSessionAccess } from '../../../gateway/session-access.ts';
import {
  createGraphQLContext,
  type GraphQLContext,
} from '../../graphql-context.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { mediaSchemaModule } from '../media/index.ts';
import { profileSchemaModule } from './index.ts';
import { userSummaryLoader } from './user-summary.ts';

interface IdsArgs {
  readonly ids: readonly string[];
}

interface SummaryData {
  readonly userSummaries?: readonly (Record<string, unknown> | null)[];
}

const CORRELATION_ID = 'correlation-profile-schema';

const USERS_SELECT_PATTERN = /^select .+ from "users"/i;

const MEDIA_FILES_SELECT_PATTERN = /^select .+ from "media_files"/i;

const AVATAR_COLUMNS = { purpose: USER_AVATAR_PURPOSE } as const;

// プロフィールのモジュールはクエリを持たないため、後続specが自分の型の項目からUserSummaryを返す形を、テスト用の項目で再現する
const consumerSchemaModule = defineSchemaModule({
  name: 'profile-consumer',
  typeDefs: /* GraphQL */ `
    type Query {
      userSummaries(ids: [ID!]!): [UserSummary]!
    }
  `,
  resolvers: {
    Query: {
      userSummaries: (
        _parent: unknown,
        args: IdsArgs,
        context: GraphQLContext,
      ) =>
        Promise.all(
          args.ids.map((id) => context.loaders.get(userSummaryLoader).load(id)),
        ),
    },
  },
});

const schema = composeGatewaySchema([
  mediaSchemaModule,
  profileSchemaModule,
  consumerSchemaModule,
]);

const SUMMARIES_QUERY = /* GraphQL */ `
  query UserSummaries($ids: [ID!]!) {
    userSummaries(ids: $ids) {
      handle
      nickname
      avatar {
        id
        objectKey
        fallbackFormat
        width
        height
      }
    }
  }
`;

// D1へ渡した文を記録し、一括読み込みが1回の問い合わせにまとまったかを確かめる
function createRecordingD1(queries: string[]): D1Database {
  return {
    prepare: (query) => {
      queries.push(query);
      return env.DB.prepare(query);
    },
    batch: (statements) => env.DB.batch(statements),
    exec: (query) => env.DB.exec(query),
    withSession: (constraint) => env.DB.withSession(constraint),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも実装する
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: () => Promise.reject(new Error('テストでは使わない')),
  };
}

function createContext(db_: D1Database = env.DB): GraphQLContext {
  const container = createInvocationContainer(
    {
      env: { ...env, DB: db_ },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: undefined,
      },
    },
    [createMediaPlatformModule('api'), PROFILE_PLATFORM_MODULE],
  );
  return createGraphQLContext({
    access: { caller: 'client' },
    container,
    correlationId: CORRELATION_ID,
    clientIp: undefined,
    userAgent: undefined,
    session: createSessionAccess({
      container,
      caller: 'client',
      token: undefined,
    }),
    botToken: undefined,
  });
}

async function summariesOf(
  userIndexes: readonly number[],
  context: GraphQLContext = createContext(),
): Promise<SummaryData['userSummaries']> {
  const result = await graphql({
    schema,
    source: SUMMARIES_QUERY,
    variableValues: { ids: userIndexes.map(userIdOf) },
    contextValue: context,
  });
  expect(result.errors).toBeUndefined();
  return (result.data as SummaryData).userSummaries;
}

async function setAvatar(
  userIndex: number,
  fileIndex: number | null,
): Promise<void> {
  await db.insert(userProfiles).values({
    id: `01JC0PROF${String(userIndex).padStart(17, '0')}`,
    userId: userIdOf(userIndex),
    avatarFileId: fileIndex === null ? null : fileIdOf(fileIndex),
    createdAt: T0,
    updatedAt: T0,
  });
}

beforeEach(async () => {
  await clearMediaState();
  await clearProfilePlatformTables();
});

describe('profileSchemaModule', () => {
  test('利用者の表示の型と、プロフィールの操作を定義する', () => {
    const composed = composeGatewaySchema([
      mediaSchemaModule,
      profileSchemaModule,
    ]);

    const summary = composed.getType('UserSummary');

    expect(String(summary)).toBe('UserSummary');
    expect(Object.keys(composed.getQueryType()?.getFields() ?? {})).toEqual([
      'publicProfile',
      'myProfile',
      'handleAvailability',
    ]);
    expect(Object.keys(composed.getMutationType()?.getFields() ?? {})).toEqual([
      'updateMyProfile',
    ]);
    expect(profileSchemaModule.name).toBe('profile');
  });
});

describe('UserSummary', () => {
  test('可視の利用者のハンドルとニックネームを、画像が無ければ空の画像で返す', async () => {
    await insertUser(1, { handle: 'Alice', nickname: 'アリス' });
    await insertUser(2, { handle: 'bob', nickname: 'ボブ' });

    const summaries = await summariesOf([2, 1]);

    expect(summaries).toEqual([
      { handle: 'bob', nickname: 'ボブ', avatar: null },
      { handle: 'Alice', nickname: 'アリス', avatar: null },
    ]);
  });

  test('プロフィールの行が無い利用者と、画像が未設定のプロフィールの利用者は画像を空で返す', async () => {
    await insertUser(1);
    await insertUser(2);
    await setAvatar(2, null);

    const summaries = await summariesOf([1, 2]);

    expect(summaries?.map((summary) => summary?.['avatar'])).toEqual([
      null,
      null,
    ]);
  });

  test('停止中・退会済み・存在しない利用者は空で返し、可視の利用者の位置は保つ', async () => {
    await insertUser(1, { handle: 'alice', nickname: 'アリス' });
    await insertUser(2, {
      handle: 'bob',
      status: 'suspended',
      suspendedAt: after(1),
    });
    await insertUser(3, { handle: 'carol', deletedAt: after(2) });

    const summaries = await summariesOf([2, 1, 3, 9]);

    expect(summaries).toEqual([
      null,
      { handle: 'alice', nickname: 'アリス', avatar: null },
      null,
      null,
    ]);
  });

  test('配信できる画像はオブジェクトキー・フォールバックの形式・寸法を返す', async () => {
    await insertUser(1);
    await insertFile(1, {
      ...AVATAR_COLUMNS,
      contentType: 'image/jpeg',
      width: 512,
      height: 256,
      ownerId: userIdOf(1),
    });
    await setAvatar(1, 1);

    const summaries = await summariesOf([1]);

    expect(summaries?.[0]?.['avatar']).toEqual({
      id: fileIdOf(1),
      objectKey: objectKeyOf(1),
      fallbackFormat: 'JPG',
      width: 512,
      height: 256,
    });
  });

  test('隔離中・削除待ち・保存未完了の画像はオブジェクトキーを空にして画像の枠は返す', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertUser(3);
    await insertFile(1, {
      ...AVATAR_COLUMNS,
      ownerId: userIdOf(1),
      location: 'quarantine',
      moderationStatus: 'flagged',
    });
    await insertReason(1, 'auto');
    await insertFile(2, {
      ...AVATAR_COLUMNS,
      ownerId: userIdOf(2),
      eraseRequestedAt: T0,
    });
    await insertFile(3, {
      ...AVATAR_COLUMNS,
      ownerId: userIdOf(3),
      storedAt: null,
      moderationStatus: 'pending',
    });
    await setAvatar(1, 1);
    await setAvatar(2, 2);
    await setAvatar(3, 3);

    const summaries = await summariesOf([1, 2, 3]);

    expect(
      summaries?.map((summary) => [
        (summary?.['avatar'] as { id: string }).id,
        (summary?.['avatar'] as { objectKey: string | null }).objectKey,
      ]),
    ).toEqual([
      [fileIdOf(1), null],
      [fileIdOf(2), null],
      [fileIdOf(3), null],
    ]);
  });

  test('画像の記録が無い利用者は画像を空で返す', async () => {
    await insertUser(1);
    await setAvatar(1, 9);

    const summaries = await summariesOf([1]);

    expect(summaries?.[0]?.['avatar']).toBe(null);
  });

  test('複数の利用者と画像を、利用者の照会1回と画像の照会1回にまとめて読む', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertUser(3);
    await insertFile(1, { ...AVATAR_COLUMNS, ownerId: userIdOf(1) });
    await insertFile(2, { ...AVATAR_COLUMNS, ownerId: userIdOf(2) });
    await setAvatar(1, 1);
    await setAvatar(2, 2);
    const queries: string[] = [];

    const summaries = await summariesOf(
      [1, 2, 3],
      createContext(createRecordingD1(queries)),
    );

    expect(summaries?.map((summary) => summary?.['avatar'] !== null)).toEqual([
      true,
      true,
      false,
    ]);
    expect(
      queries.filter((query) => USERS_SELECT_PATTERN.test(query)),
    ).toHaveLength(1);
    expect(
      queries.filter((query) => MEDIA_FILES_SELECT_PATTERN.test(query)),
    ).toHaveLength(1);
  });
});

import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../../../../lib/workers/di/invocation-container.ts';
import { createMediaPlatformModule } from '../../../../../lib/workers/media/media-platform-module.ts';
import {
  FILE_PURPOSE,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
  T0,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearMediaState } from '../../../../../lib/workers/media/testing/media-operations-fixtures.ts';
import { createSessionAccess } from '../../../gateway/session-access.ts';
import {
  createGraphQLContext,
  type GraphQLContext,
} from '../../graphql-context.ts';
import { composeGatewaySchema } from '../../schema-composer.ts';
import { defineSchemaModule } from '../../schema-module.ts';
import { mediaSchemaModule } from './index.ts';
import { mediaFileLoader } from './loaders.ts';
import { toMediaAttachment, toMediaImage } from './mappers.ts';

interface IdsArgs {
  readonly ids: readonly string[];
}

interface MediaData {
  readonly images?: readonly (Record<string, unknown> | null)[];
  readonly attachments?: readonly (Record<string, unknown> | null)[];
}

const CORRELATION_ID = 'correlation-media-schema';

const MEDIA_FILES_SELECT_PATTERN = /^select .+ from "media_files"/i;

async function loadFiles(context: GraphQLContext, ids: readonly string[]) {
  const loader = context.loaders.get(mediaFileLoader);
  return Promise.all(ids.map((id) => loader.load(id)));
}

// メディアのモジュールはクエリを持たないため、下流のドメインのモジュールの代わりに型を返すクエリを持つモジュールを合わせて確かめる
const consumerSchemaModule = defineSchemaModule({
  name: 'media-consumer',
  typeDefs: /* GraphQL */ `
    type Query {
      images(ids: [ID!]!): [MediaImage]!
      attachments(ids: [ID!]!): [MediaAttachment]!
    }
  `,
  resolvers: {
    Query: {
      images: async (
        _parent: unknown,
        args: IdsArgs,
        context: GraphQLContext,
      ) =>
        (await loadFiles(context, args.ids)).map((file) =>
          file === null ? null : toMediaImage(file),
        ),
      attachments: async (
        _parent: unknown,
        args: IdsArgs,
        context: GraphQLContext,
      ) =>
        (await loadFiles(context, args.ids)).map((file) =>
          file === null ? null : toMediaAttachment(file),
        ),
    },
  },
});

const schema = composeGatewaySchema([mediaSchemaModule, consumerSchemaModule]);

const IMAGES_QUERY = /* GraphQL */ `
  query Images($ids: [ID!]!) {
    images(ids: $ids) {
      id
      objectKey
      fallbackFormat
      width
      height
    }
  }
`;

const ATTACHMENTS_QUERY = /* GraphQL */ `
  query Attachments($ids: [ID!]!) {
    attachments(ids: $ids) {
      id
      originalFileName
      contentType
      byteSize
      downloadPath
    }
  }
`;

const IMAGES_AND_ATTACHMENTS_QUERY = /* GraphQL */ `
  query ImagesAndAttachments($imageIds: [ID!]!, $attachmentIds: [ID!]!) {
    images(ids: $imageIds) {
      id
      objectKey
    }
    attachments(ids: $attachmentIds) {
      id
      downloadPath
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

function createContext(db: D1Database = env.DB): GraphQLContext {
  const container = createInvocationContainer(
    {
      env: { ...env, DB: db },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: undefined,
      },
    },
    [createMediaPlatformModule('api')],
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

async function execute(
  source: string,
  variableValues: Record<string, unknown>,
  context: GraphQLContext = createContext(),
): Promise<MediaData> {
  const result = await graphql({
    schema,
    source,
    variableValues,
    contextValue: context,
  });
  expect(result.errors).toBeUndefined();
  return result.data as MediaData;
}

async function executeExpectingErrors(
  source: string,
  variableValues: Record<string, unknown>,
): Promise<readonly string[]> {
  const result = await graphql({
    schema,
    source,
    variableValues,
    contextValue: createContext(),
  });
  return (result.errors ?? []).map((error) => error.message);
}

function createRecordingContext(): {
  readonly context: GraphQLContext;
  readonly mediaFileSelects: () => readonly string[];
} {
  const queries: string[] = [];
  return {
    context: createContext(createRecordingD1(queries)),
    mediaFileSelects: () =>
      queries.filter((query) => MEDIA_FILES_SELECT_PATTERN.test(query)),
  };
}

beforeEach(async () => {
  await clearMediaState();
});

describe('mediaSchemaModule', () => {
  test('クエリ・ミューテーションを持たず、型だけを定義する', () => {
    const typeMap = composeGatewaySchema([mediaSchemaModule]).getTypeMap();

    expect(Object.keys(typeMap)).toEqual(
      expect.arrayContaining([
        'MediaImage',
        'MediaAttachment',
        'MediaImageFallbackFormat',
      ]),
    );
    expect(composeGatewaySchema([mediaSchemaModule]).getQueryType()).toBe(
      undefined,
    );
    expect(composeGatewaySchema([mediaSchemaModule]).getMutationType()).toBe(
      undefined,
    );
    expect(mediaSchemaModule.resolvers).toBeUndefined();
  });

  test('配信できる画像は原本の形式ごとのフォールバックとオブジェクトキー・寸法を返す', async () => {
    await insertFile(1, {
      contentType: 'image/jpeg',
      width: 1200,
      height: 630,
    });
    await insertFile(2, { contentType: 'image/png' });
    await insertFile(3, {
      contentType: 'image/svg+xml',
      width: null,
      height: null,
    });

    const data = await execute(IMAGES_QUERY, {
      ids: [fileIdOf(1), fileIdOf(2), fileIdOf(3)],
    });

    expect(data.images).toEqual([
      {
        id: fileIdOf(1),
        objectKey: objectKeyOf(1),
        fallbackFormat: 'JPG',
        width: 1200,
        height: 630,
      },
      {
        id: fileIdOf(2),
        objectKey: objectKeyOf(2),
        fallbackFormat: 'PNG',
        width: 640,
        height: 480,
      },
      {
        id: fileIdOf(3),
        objectKey: objectKeyOf(3),
        fallbackFormat: 'SVG',
        width: null,
        height: null,
      },
    ]);
  });

  test('隔離中・削除待ち・保存未完了の画像はオブジェクトキーを空にし、論理削除済みの画像は返す', async () => {
    await insertFile(1, {
      location: 'quarantine',
      moderationStatus: 'flagged',
    });
    await insertReason(1, 'auto');
    await insertFile(2, { eraseRequestedAt: T0 });
    await insertFile(3, { storedAt: null, moderationStatus: 'pending' });
    await insertFile(4, { deletedAt: T0 });

    const data = await execute(IMAGES_QUERY, {
      ids: [fileIdOf(1), fileIdOf(2), fileIdOf(3), fileIdOf(4)],
    });

    expect(data.images?.map((image) => image?.objectKey)).toEqual([
      null,
      null,
      null,
      objectKeyOf(4),
    ]);
    expect(data.images?.map((image) => image?.fallbackFormat)).toEqual([
      'PNG',
      'PNG',
      'PNG',
      'PNG',
    ]);
  });

  test('記録の無い識別子は空を返す', async () => {
    await insertFile(1);

    const data = await execute(IMAGES_QUERY, {
      ids: [fileIdOf(9), fileIdOf(1)],
    });

    expect(data.images?.map((image) => image?.id ?? null)).toEqual([
      null,
      fileIdOf(1),
    ]);
  });

  test('添付は元のファイル名・引数を除いたMIMEタイプ・バイト数とダウンロードのパスを返す', async () => {
    await insertFile(1, {
      purpose: FILE_PURPOSE,
      storage: 'files',
      location: 'files',
      originalFileName: 'お問い合わせ.txt',
      contentType: 'text/plain; charset=utf-8',
      byteSize: 321,
      width: null,
      height: null,
      moderationStatus: 'not_required',
    });

    const data = await execute(ATTACHMENTS_QUERY, { ids: [fileIdOf(1)] });

    expect(data.attachments).toEqual([
      {
        id: fileIdOf(1),
        originalFileName: 'お問い合わせ.txt',
        contentType: 'text/plain',
        byteSize: 321,
        downloadPath: `/_bff/files/${fileIdOf(1)}`,
      },
    ]);
  });

  test('同じ操作の中で読み込む画像と添付を1回の一括取得にまとめる', async () => {
    await insertFile(1);
    await insertFile(2);
    await insertFile(3, {
      purpose: FILE_PURPOSE,
      storage: 'files',
      location: 'files',
      contentType: 'application/pdf',
      moderationStatus: 'not_required',
    });
    const { context, mediaFileSelects } = createRecordingContext();

    const data = await execute(
      IMAGES_AND_ATTACHMENTS_QUERY,
      {
        imageIds: [fileIdOf(1), fileIdOf(2), fileIdOf(1)],
        attachmentIds: [fileIdOf(3)],
      },
      context,
    );

    expect(data.images?.map((image) => image?.id)).toEqual([
      fileIdOf(1),
      fileIdOf(2),
      fileIdOf(1),
    ]);
    expect(data.attachments?.map((attachment) => attachment?.id)).toEqual([
      fileIdOf(3),
    ]);
    expect(mediaFileSelects()).toHaveLength(1);
  });

  test('一括読み込みの件数の上限を超える画像は上限ごとに分けて取得する', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => fileIdOf(index + 1));
    for (const [index] of ids.entries()) {
      await insertFile(index + 1);
    }
    const { context, mediaFileSelects } = createRecordingContext();

    const data = await execute(IMAGES_QUERY, { ids }, context);

    expect(data.images).toHaveLength(51);
    expect(data.images?.every((image) => image?.objectKey !== null)).toBe(true);
    expect(mediaFileSelects()).toHaveLength(2);
  });

  test('画像を返す項目にファイル用の用途のファイルを渡すとエラーを返す', async () => {
    await insertFile(1, {
      purpose: FILE_PURPOSE,
      storage: 'files',
      location: 'files',
      contentType: 'application/pdf',
      moderationStatus: 'not_required',
    });

    const messages = await executeExpectingErrors(IMAGES_QUERY, {
      ids: [fileIdOf(1)],
    });

    expect(messages).toEqual([
      `ファイル${fileIdOf(1)}は画像用の用途の画像ではありません。`,
    ]);
  });

  test('添付を返す項目に画像用の用途のファイルを渡すとエラーを返す', async () => {
    await insertFile(1);

    const messages = await executeExpectingErrors(ATTACHMENTS_QUERY, {
      ids: [fileIdOf(1)],
    });

    expect(messages).toEqual([
      `ファイル${fileIdOf(1)}はファイル用の用途のファイルではありません。`,
    ]);
  });
});

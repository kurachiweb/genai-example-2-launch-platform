import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { z } from 'zod';

import {
  encodeFileNameHeader,
  UPLOAD_FILE_NAME_HEADER,
  type UploadedFile,
} from '../../common-lib/media/upload-protocol.ts';
import { NOT_FOUND_RESPONSE } from '../../lib/core/errors/error-envelope.ts';
import type { QuarantineReason } from '../../lib/core/media/media-file.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../lib/core/media/media-messages.ts';
import { MEDIA_SMOKE_PURPOSE } from '../../lib/core/media/upload-purpose.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { platformEnvShape } from '../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMediaPlatformModule } from '../../lib/workers/media/media-platform-module.ts';
import {
  clearMediaTables,
  FINDINGS,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
  readFile,
  readReasons,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  createRecordingQueue,
  listObjectKeys,
  pdfBytes,
  pngBytes,
  putExistingObject,
  readRecord,
  type RecordingQueue,
  ULID_PATTERN,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import { MEDIA_SMOKE_MODULE } from './media-smoke-module.ts';

type TestEnv = typeof env;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

interface SmokeRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string | null;
  readonly token?: string | null;
  readonly body?: Uint8Array;
  readonly contentType?: string;
}

interface SmokeRoute {
  readonly label: string;
  readonly method: string;
  readonly path: (fileId: string) => string;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

const BASE_URL = 'https://event.launch.example';
const IMAGES_PATH = '/internal/media/smoke/images';
const SMOKE_TOKEN = 'media-smoke-token-for-workers-integration-tests';
const SMOKE_FILE = 1;
const OTHER_PURPOSE_FILE = 2;

const alwaysAllowedRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

const NOT_FOUND_BODY = NOT_FOUND_RESPONSE.body;

const ROUTES: readonly SmokeRoute[] = [
  { label: 'アップロード', method: 'POST', path: () => IMAGES_PATH },
  {
    label: '状態の取得',
    method: 'GET',
    path: (fileId) => `${IMAGES_PATH}/${fileId}`,
  },
  {
    label: '隔離',
    method: 'POST',
    path: (fileId) => `${IMAGES_PATH}/${fileId}/quarantine`,
  },
  {
    label: '解除',
    method: 'POST',
    path: (fileId) => `${IMAGES_PATH}/${fileId}/release`,
  },
  {
    label: '削除',
    method: 'DELETE',
    path: (fileId) => `${IMAGES_PATH}/${fileId}`,
  },
];

const FILE_ROUTES = ROUTES.filter((route) => route.label !== 'アップロード');

let queue: RecordingQueue;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

function createTestApp(): TestApp {
  return createWorkerApp<TestEnv>({
    appName: 'event',
    envSchema: z.object(platformEnvShape),
    modules: [createMediaPlatformModule('event'), MEDIA_SMOKE_MODULE],
    rateLimitExclusions: [],
    sentry: (bindings) =>
      buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: undefined,
      }),
  });
}

function requestHeaders(request: SmokeRequest): Headers {
  const headers = new Headers();
  const authorization =
    request.authorization === undefined
      ? `Bearer ${SMOKE_TOKEN}`
      : request.authorization;
  if (authorization !== null) {
    headers.set('Authorization', authorization);
  }
  if (request.body !== undefined) {
    headers.set('Content-Length', String(request.body.length));
    headers.set('Content-Type', request.contentType ?? 'image/png');
    headers.set(UPLOAD_FILE_NAME_HEADER, encodeFileNameHeader('smoke.png'));
  }
  return headers;
}

async function send(request: SmokeRequest): Promise<Response> {
  const token = request.token === undefined ? SMOKE_TOKEN : request.token;
  const ctx = createExecutionContext();
  const response = await createTestApp().fetch(
    new Request(`${BASE_URL}${request.path}`, {
      method: request.method,
      headers: requestHeaders(request),
      ...(request.body === undefined ? {} : { body: request.body }),
    }),
    {
      ...env,
      ...(token === null ? {} : { MEDIA_SMOKE_TOKEN: token }),
      JOBS_QUEUE: queue.queue,
      IP_RATE_LIMITER: alwaysAllowedRateLimiter,
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function sendTo(
  route: SmokeRoute,
  fileId: string,
  options: Pick<SmokeRequest, 'authorization' | 'token'> = {},
): Promise<Response> {
  return send({
    method: route.method,
    path: route.path(fileId),
    ...options,
    ...(route.label === 'アップロード' ? { body: pngBytes(16, 16) } : {}),
  });
}

async function insertSmokeFile(
  reasons: readonly QuarantineReason[] = [],
): Promise<void> {
  await insertFile(SMOKE_FILE, {
    purpose: MEDIA_SMOKE_PURPOSE.name,
    ownerKind: 'system',
    ownerId: null,
    location: reasons.length > 0 ? 'quarantine' : 'images',
  });
  for (const reason of reasons) {
    await insertReason(SMOKE_FILE, reason);
  }
  await putExistingObject(
    reasons.length > 0 ? 'quarantine' : 'images',
    objectKeyOf(SMOKE_FILE),
    'smoke-image',
  );
}

async function insertOtherPurposeFile(): Promise<void> {
  await insertFile(OTHER_PURPOSE_FILE);
  await putExistingObject(
    'images',
    objectKeyOf(OTHER_PURPOSE_FILE),
    'product-image',
  );
}

function relocationRequests(): QueueEnvelope[] {
  return queue.sent.filter(
    (envelope) => envelope.type === RELOCATE_FILES_MESSAGE.type,
  );
}

async function reasonsOf(index: number): Promise<QuarantineReason[]> {
  return (await readReasons())
    .filter((row) => row.fileId === fileIdOf(index))
    .map((row) => row.reason);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  queue = createRecordingQueue();
  await clearMediaTables();
  await clearMediaState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('動作確認の経路が使えない環境', () => {
  test.each(
    ROUTES.flatMap((route) =>
      [
        { tokenLabel: '未設定', token: null },
        { tokenLabel: '空', token: '' },
      ].map((setting) => ({ ...route, ...setting })),
    ),
  )(
    'トークンが$tokenLabelの環境では、$labelの経路が正しい形のトークンでも未登録の経路と同じ404を返して何も変えない',
    async (route) => {
      await insertSmokeFile();

      const response = await sendTo(route, fileIdOf(SMOKE_FILE), {
        token: route.token,
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toStrictEqual(NOT_FOUND_BODY);
      expect(queue.sent).toEqual([]);
      expect(await readFile(SMOKE_FILE)).toBeDefined();
      expect(await reasonsOf(SMOKE_FILE)).toEqual([]);
      expect(await listObjectKeys('images')).toEqual([objectKeyOf(SMOKE_FILE)]);
    },
  );
});

describe('動作確認のトークンの照合', () => {
  test.each(
    ROUTES.flatMap((route) =>
      [
        { authLabel: 'Authorizationヘッダーが無い', authorization: null },
        {
          authLabel: '異なるトークン',
          authorization: `Bearer ${SMOKE_TOKEN}x`,
        },
        {
          authLabel: '長さが同じで内容が異なるトークン',
          authorization: `Bearer ${SMOKE_TOKEN.slice(0, -1)}X`,
        },
        {
          authLabel: 'Bearer以外の方式',
          authorization: `Basic ${SMOKE_TOKEN}`,
        },
      ].map((credentials) => ({ ...route, ...credentials })),
    ),
  )('$labelの経路は$authLabelとき401を返して何も変えない', async (route) => {
    await insertSmokeFile();

    const response = await sendTo(route, fileIdOf(SMOKE_FILE), {
      authorization: route.authorization,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: { code: 'unauthenticated', message: '認証されていません。' },
    });
    expect(queue.sent).toEqual([]);
    expect(await readFile(SMOKE_FILE)).toBeDefined();
    expect(await reasonsOf(SMOKE_FILE)).toEqual([]);
    expect(await listObjectKeys('images')).toEqual([objectKeyOf(SMOKE_FILE)]);
  });

  test('トークンの値を応答にもログにも出さない', async () => {
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    await insertSmokeFile();

    const responses = await Promise.all([
      send({
        method: 'GET',
        path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}`,
        authorization: `Bearer ${SMOKE_TOKEN}x`,
      }),
      send({
        method: 'GET',
        path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}`,
      }),
      send({ method: 'POST', path: IMAGES_PATH, body: pngBytes(16, 16) }),
    ]);

    const bodies = await Promise.all(
      responses.map((response) => response.text()),
    );
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(bodies.join('\n')).not.toContain(SMOKE_TOKEN);
    expect(logged).not.toContain(SMOKE_TOKEN);
  });
});

describe('POST /internal/media/smoke/images', () => {
  test('画像を動作確認の用途・保有者「システム」で受け付け、201とアップロードの結果を返して判定を依頼する', async () => {
    const response = await send({
      method: 'POST',
      path: IMAGES_PATH,
      body: pngBytes(16, 16),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { data } = await response.json<{ readonly data: UploadedFile }>();
    const { fileId, objectKey, ...rest } = data;
    expect(fileId).toMatch(ULID_PATTERN);
    expect(objectKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(rest).toStrictEqual({
      originalFileName: 'smoke.png',
      contentType: 'image/png',
      byteSize: 64,
      width: 16,
      height: 16,
    });
    const record = await readRecord(data.fileId);
    expect(record).toMatchObject({
      purpose: MEDIA_SMOKE_PURPOSE.name,
      storage: 'images',
      location: 'images',
      ownerKind: 'system',
      ownerId: null,
      moderationStatus: 'pending',
    });
    expect(record?.storedAt).not.toBeNull();
    expect(await listObjectKeys('images')).toEqual([data.objectKey]);
    expect(
      queue.sent
        .filter((envelope) => envelope.type === MODERATE_IMAGE_MESSAGE.type)
        .map((envelope) => envelope.body),
    ).toEqual([{ fileId: data.fileId }]);
  });

  test('受け付けない形式は通常のアップロードと同じ失敗を返して何も保存しない', async () => {
    const response = await send({
      method: 'POST',
      path: IMAGES_PATH,
      body: pdfBytes(),
      contentType: 'application/pdf',
    });

    expect(response.status).toBe(415);
    expect((await response.json<ErrorBody>()).error.code).toBe(
      'unsupported_file_type',
    );
    expect(await listObjectKeys('images')).toEqual([]);
    expect(queue.sent).toEqual([]);
  });
});

describe('GET /internal/media/smoke/images/:fileId', () => {
  test('判定の状態・保存先・隔離理由・検出内容を返す', async () => {
    await insertFile(SMOKE_FILE, {
      purpose: MEDIA_SMOKE_PURPOSE.name,
      ownerKind: 'system',
      ownerId: null,
      location: 'quarantine',
      moderationStatus: 'flagged',
      moderationDetail: FINDINGS,
    });
    await insertReason(SMOKE_FILE, 'auto');

    const response = await send({
      method: 'GET',
      path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}`,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({
      data: {
        moderationStatus: 'flagged',
        location: 'quarantine',
        quarantineReasons: ['auto'],
        findings: FINDINGS,
      },
    });
  });

  test('検出内容が記録されていない判定待ちの画像は空の検出内容を返す', async () => {
    await insertFile(SMOKE_FILE, {
      purpose: MEDIA_SMOKE_PURPOSE.name,
      ownerKind: 'system',
      ownerId: null,
      moderationStatus: 'pending',
    });

    const response = await send({
      method: 'GET',
      path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}`,
    });

    expect(await response.json()).toStrictEqual({
      data: {
        moderationStatus: 'pending',
        location: 'images',
        quarantineReasons: [],
        findings: [],
      },
    });
  });
});

describe('POST /internal/media/smoke/images/:fileId/quarantine', () => {
  test('管理者の操作の理由で隔離し、202を返して移動を依頼する', async () => {
    await insertSmokeFile();

    const response = await send({
      method: 'POST',
      path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}/quarantine`,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await reasonsOf(SMOKE_FILE)).toEqual(['admin_action']);
    expect(relocationRequests().map((envelope) => envelope.body)).toEqual([
      { fileIds: [fileIdOf(SMOKE_FILE)] },
    ]);
  });
});

describe('POST /internal/media/smoke/images/:fileId/release', () => {
  test('管理者の操作の理由だけを外し、202を返して移動を依頼する', async () => {
    await insertSmokeFile(['admin_action']);

    const response = await send({
      method: 'POST',
      path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}/release`,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await reasonsOf(SMOKE_FILE)).toEqual([]);
    expect(relocationRequests().map((envelope) => envelope.body)).toEqual([
      { fileIds: [fileIdOf(SMOKE_FILE)] },
    ]);
  });

  test('自動判定の理由は外さない', async () => {
    await insertSmokeFile(['auto', 'admin_action']);

    const response = await send({
      method: 'POST',
      path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}/release`,
    });

    expect(response.status).toBe(202);
    expect(await reasonsOf(SMOKE_FILE)).toEqual(['auto']);
  });
});

describe('DELETE /internal/media/smoke/images/:fileId', () => {
  test('記録と原本を物理削除し、202を返す', async () => {
    await insertSmokeFile();

    const response = await send({
      method: 'DELETE',
      path: `${IMAGES_PATH}/${fileIdOf(SMOKE_FILE)}`,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await readFile(SMOKE_FILE)).toBeUndefined();
    expect(await listObjectKeys('images')).toEqual([]);
  });
});

describe('動作確認以外のファイルへの操作', () => {
  test.each(FILE_ROUTES)(
    '$labelの経路は動作確認以外の用途のファイルに404を返して変えない',
    async (route) => {
      await insertOtherPurposeFile();

      const response = await sendTo(route, fileIdOf(OTHER_PURPOSE_FILE));

      expect(response.status).toBe(404);
      expect(await response.json()).toStrictEqual(NOT_FOUND_BODY);
      expect(queue.sent).toEqual([]);
      expect(await readFile(OTHER_PURPOSE_FILE)).toMatchObject({
        purpose: 'product-image',
        location: 'images',
        eraseRequestedAt: null,
      });
      expect(await reasonsOf(OTHER_PURPOSE_FILE)).toEqual([]);
      expect(await listObjectKeys('images')).toEqual([
        objectKeyOf(OTHER_PURPOSE_FILE),
      ]);
    },
  );

  test.each(FILE_ROUTES)(
    '$labelの経路は存在しないファイルに404を返す',
    async (route) => {
      const response = await sendTo(route, fileIdOf(99));

      expect(response.status).toBe(404);
      expect(await response.json()).toStrictEqual(NOT_FOUND_BODY);
      expect(queue.sent).toEqual([]);
    },
  );
});

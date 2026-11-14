import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';

import type { UploaderDenialCode } from '../../../common-lib/media/media-error-codes.ts';
import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
} from '../../../common-lib/media/media-types.ts';
import {
  encodeFileNameHeader,
  UPLOAD_FILE_NAME_HEADER,
  type UploadedFile,
} from '../../../common-lib/media/upload-protocol.ts';
import type { AppModule } from '../../../lib/core/di/app-module.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import { MODERATE_IMAGE_MESSAGE } from '../../../lib/core/media/media-messages.ts';
import {
  createUploadPurposeRegistry,
  defineUploadPurpose,
  type UploadPurpose,
  type UploadPurposeRegistry,
} from '../../../lib/core/media/upload-purpose.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import type {
  AuthenticatedPrincipal,
  Principal,
} from '../../../lib/core/session/session-view.ts';
import { platformEnvShape } from '../../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { createMediaPlatformModule } from '../../../lib/workers/media/media-platform-module.ts';
import {
  clearMediaState,
  countRecords,
  createRecordingQueue,
  expectNothingStored,
  jpegPrefixBytes,
  listObjectKeys,
  pdfBytes,
  pngBytes,
  readObject,
  readRecord,
  type RecordingQueue,
  trackedStreamOf,
  ULID_PATTERN,
  utf8,
} from '../../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../../lib/workers/observability/sentry.ts';
import { createFailingD1 } from '../../../test/support/failing-d1.ts';
import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
  type UploaderEligibilityDecision,
} from '../../application/media/uploader-eligibility.ts';
import {
  SESSION_TYPES,
  type SessionVerification,
  type SessionVerifier,
} from '../../application/session/session-verifier.ts';
import { AllowAllUploaderEligibility } from '../../infrastructure/media/allow-all-uploader-eligibility.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
} from '../gateway/gateway-headers.ts';
import { createInternalRoutesModule } from '../gateway/internal-only.ts';
import { resolveGatewayClientIp } from '../gateway/internal-request.ts';
import { registerUploadRoutes } from './upload-route.ts';

type TestEnv = typeof env;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

interface CheckCall {
  readonly principal: AuthenticatedPrincipal;
  readonly purpose: UploadPurpose;
  readonly sessionPrincipal: Principal;
}

interface RecordingEligibility {
  readonly eligibility: UploaderEligibility;
  readonly calls: CheckCall[];
}

interface UploadRequestOptions {
  readonly caller?: CallerKind | null;
  readonly token?: string | null;
  readonly contentType?: string | null;
  readonly contentLength?: string | null;
  readonly fileName?: string;
  readonly body?: Uint8Array | ReadableStream<Uint8Array> | null;
}

interface UploadApp {
  readonly eligibility: UploaderEligibility | 'allow-all';
  readonly db?: D1Database;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';
const SESSION_TOKEN_LENGTH = 43;
const USER_TOKEN = 'user'.padEnd(SESSION_TOKEN_LENGTH, '0');
const ADMIN_TOKEN = 'admin'.padEnd(SESSION_TOKEN_LENGTH, '0');
const USER_ID = '01JC0USER00000000000000001';
const ADMIN_ID = '01JC0ADMIN0000000000000001';

const USER_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: '01JC0USERSESSION0000000001',
});

const ADMIN_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: '01JC0ADMINSESSION000000001',
});

const SHARED_IMAGE_PURPOSE = defineUploadPurpose({
  name: 'product-image',
  storage: 'images',
  uploaderKinds: ['user', 'admin'],
  allowedTypes: ['image/png', 'image/jpeg', 'image/svg+xml'],
  maxBytes: 1024,
});

const ADMIN_IMAGE_PURPOSE = defineUploadPurpose({
  name: 'banner-image',
  storage: 'images',
  uploaderKinds: ['admin'],
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: 5_242_880,
});

const USER_FILE_PURPOSE = defineUploadPurpose({
  name: 'inquiry-attachment',
  storage: 'files',
  uploaderKinds: ['user'],
  allowedTypes: ATTACHMENT_MEDIA_TYPES,
  maxBytes: MAX_UPLOAD_BYTES,
});

const REGISTRY: UploadPurposeRegistry = createUploadPurposeRegistry([
  SHARED_IMAGE_PURPOSE,
  ADMIN_IMAGE_PURPOSE,
  USER_FILE_PURPOSE,
]);

const DENIAL_MESSAGES: Readonly<Record<UploaderDenialCode, string>> = {
  account_unavailable:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  email_not_verified:
    'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
};

const PRINCIPAL_BY_TOKEN: Readonly<Record<string, AuthenticatedPrincipal>> = {
  [USER_TOKEN]: USER_PRINCIPAL,
  [ADMIN_TOKEN]: ADMIN_PRINCIPAL,
};

const alwaysAllowedRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

let queue: RecordingQueue;

function verifyByToken(
  subjectKind: string,
  token: string,
): SessionVerification {
  const principal = PRINCIPAL_BY_TOKEN[token];
  return principal?.subjectKind === subjectKind
    ? { status: 'valid', principal }
    : { status: 'invalid' };
}

function recordingEligibility(
  decision: UploaderEligibilityDecision,
): RecordingEligibility {
  const calls: CheckCall[] = [];
  return {
    calls,
    eligibility: {
      check: async ({ session, principal, purpose }) => {
        calls.push({
          principal,
          purpose,
          sessionPrincipal: await session.principal(),
        });
        return decision;
      },
    },
  };
}

function testModule(eligibility: UploadApp['eligibility']): AppModule<TestApp> {
  return {
    name: 'upload-route-test',
    bindings: new ContainerModule(({ bind }) => {
      bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).toConstantValue({
        verify: ({ subjectKind, token }) =>
          Promise.resolve(verifyByToken(subjectKind, token)),
      });
      bind<UploadPurposeRegistry>(
        MEDIA_TYPES.UploadPurposeRegistry,
      ).toConstantValue(REGISTRY);
      if (eligibility === 'allow-all') {
        bind<UploaderEligibility>(UPLOAD_ACCESS_TYPES.UploaderEligibility).to(
          AllowAllUploaderEligibility,
        );
        return;
      }
      bind<UploaderEligibility>(
        UPLOAD_ACCESS_TYPES.UploaderEligibility,
      ).toConstantValue(eligibility);
    }),
  };
}

function createTestApp(eligibility: UploadApp['eligibility']): TestApp {
  return createWorkerApp<TestEnv>({
    appName: 'api',
    envSchema: z.object(platformEnvShape),
    modules: [
      testModule(eligibility),
      createMediaPlatformModule('api'),
      createInternalRoutesModule<TestEnv>([registerUploadRoutes]),
    ],
    rateLimitExclusions: [],
    resolveClientIp: resolveGatewayClientIp,
    sentry: (bindings) =>
      buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: undefined,
      }),
  });
}

function defaultTokenOf(caller: CallerKind | null): string | null {
  return caller === 'admin' ? ADMIN_TOKEN : USER_TOKEN;
}

function requestHeaders(options: UploadRequestOptions): Headers {
  const caller = options.caller === undefined ? 'client' : options.caller;
  const token =
    options.token === undefined ? defaultTokenOf(caller) : options.token;
  const body = options.body === undefined ? pngBytes(16, 16) : options.body;
  const contentLength =
    options.contentLength === undefined
      ? body instanceof Uint8Array
        ? String(body.length)
        : null
      : options.contentLength;
  const contentType =
    options.contentType === undefined ? 'image/png' : options.contentType;
  const headers = new Headers({
    [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
    [UPLOAD_FILE_NAME_HEADER]: encodeFileNameHeader(
      options.fileName ?? 'photo.png',
    ),
  });
  if (caller !== null) {
    headers.set(GATEWAY_HEADERS.caller, caller);
  }
  if (token !== null) {
    headers.set(GATEWAY_HEADERS.sessionToken, token);
  }
  if (contentLength !== null) {
    headers.set('Content-Length', contentLength);
  }
  if (contentType !== null) {
    headers.set('Content-Type', contentType);
  }
  return headers;
}

async function upload(
  purpose: string,
  options: UploadRequestOptions = {},
  app: UploadApp = { eligibility: 'allow-all' },
): Promise<Response> {
  const body = options.body === undefined ? pngBytes(16, 16) : options.body;
  const ctx = createExecutionContext();
  const response = await createTestApp(app.eligibility).fetch(
    new Request(`${BASE_URL}/internal/media/uploads/${purpose}`, {
      method: 'POST',
      headers: requestHeaders(options),
      body,
    }),
    {
      ...env,
      JOBS_QUEUE: queue.queue,
      IP_RATE_LIMITER: alwaysAllowedRateLimiter,
      ...(app.db === undefined ? {} : { DB: app.db }),
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function errorOf(response: Response): Promise<ErrorBody> {
  return response.json<ErrorBody>();
}

async function uploadedOf(response: Response): Promise<UploadedFile> {
  const body = await response.json<{ readonly data: UploadedFile }>();
  return body.data;
}

function moderationRequests(): QueueEnvelope[] {
  return queue.sent.filter(
    (envelope) => envelope.type === MODERATE_IMAGE_MESSAGE.type,
  );
}

beforeEach(async () => {
  queue = createRecordingQueue();
  await clearMediaState();
});

afterAll(() => {
  resetSync();
});

describe('POST /internal/media/uploads/:purpose', () => {
  test('画像用の用途は201で識別子と情報を返し、記録・画像用のオブジェクト・判定の依頼を作り、Locationを付けない', async () => {
    const bytes = pngBytes(120, 80);

    const response = await upload(SHARED_IMAGE_PURPOSE.name, {
      body: bytes,
      fileName: '商品の写真.png',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Location')).toBeNull();
    const file = await uploadedOf(response);
    expect(file).toStrictEqual({
      fileId: expect.stringMatching(ULID_PATTERN) as string,
      originalFileName: '商品の写真.png',
      contentType: 'image/png',
      byteSize: bytes.length,
      width: 120,
      height: 80,
      objectKey: expect.any(String) as string,
    });
    const record = await readRecord(file.fileId);
    expect(record).toMatchObject({
      purpose: SHARED_IMAGE_PURPOSE.name,
      ownerKind: 'user',
      ownerId: USER_ID,
      storage: 'images',
    });
    expect(await listObjectKeys('images')).toStrictEqual([file.objectKey]);
    expect(moderationRequests()).toHaveLength(1);
  });

  test('ファイル用の用途は201にLocationでダウンロードの経路を付け、ファイル用のバケットへ保存し、判定を依頼しない', async () => {
    const response = await upload(USER_FILE_PURPOSE.name, {
      body: pdfBytes(),
      contentType: 'application/pdf',
      fileName: '見積書.pdf',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const file = await uploadedOf(response);
    expect(response.headers.get('Location')).toBe(`/_bff/files/${file.fileId}`);
    expect(file).toMatchObject({
      originalFileName: '見積書.pdf',
      contentType: 'application/pdf',
      width: null,
      height: null,
      objectKey: null,
    });
    const record = await readRecord(file.fileId);
    expect(record).toMatchObject({ storage: 'files', ownerId: USER_ID });
    const stored = await readObject('files', record?.objectKey ?? '');
    expect(stored?.httpMetadata?.contentDisposition).toContain('attachment');
    expect(await listObjectKeys('images')).toStrictEqual([]);
    expect(moderationRequests()).toHaveLength(0);
  });

  test('管理者側の要求は、管理者の主体を保有者として記録する', async () => {
    const response = await upload(ADMIN_IMAGE_PURPOSE.name, {
      caller: 'admin',
    });

    expect(response.status).toBe(201);
    const file = await uploadedOf(response);
    expect(await readRecord(file.fileId)).toMatchObject({
      ownerKind: 'admin',
      ownerId: ADMIN_ID,
    });
  });

  describe('受付の前の拒否は、本文を読まずにファイルを保存しない', () => {
    test.each([
      ['未登録の用途', 'unknown-purpose', {}, 404, 'upload_purpose_not_found'],
      [
        'セッションが無い',
        SHARED_IMAGE_PURPOSE.name,
        { token: null },
        401,
        'unauthenticated',
      ],
      [
        '無効なセッション',
        SHARED_IMAGE_PURPOSE.name,
        { token: 'expired'.padEnd(SESSION_TOKEN_LENGTH, '0') },
        401,
        'unauthenticated',
      ],
      [
        '利用者が管理者だけの用途を指定する',
        ADMIN_IMAGE_PURPOSE.name,
        {},
        403,
        'upload_forbidden',
      ],
      [
        '管理者が利用者だけの用途を指定する',
        USER_FILE_PURPOSE.name,
        { caller: 'admin', contentType: 'application/pdf' },
        403,
        'upload_forbidden',
      ],
    ] as const)(
      '%sなら%sの経路で%iと%sになる',
      async (_label, purpose, options: UploadRequestOptions, status, code) => {
        const tracked = trackedStreamOf(pngBytes(16, 16));

        const response = await upload(purpose, {
          ...options,
          body: tracked.stream,
          contentLength: '64',
        });

        expect(response.status).toBe(status);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const body = await errorOf(response);
        expect(body.error.code).toBe(code);
        expect(body.error.message).not.toBe('');
        expect(tracked.pulledChunks()).toBe(0);
        expect(await expectNothingStored()).toBe(true);
      },
    );

    test('主体の種類が対象外の拒否は「この操作はできません。」を返す', async () => {
      const response = await upload(ADMIN_IMAGE_PURPOSE.name);

      expect(await errorOf(response)).toStrictEqual({
        error: { code: 'upload_forbidden', message: 'この操作はできません。' },
      });
    });
  });

  test.each([
    [
      'Content-Lengthが無い',
      { contentLength: null, body: null },
      411,
      'content_length_required',
    ],
    [
      'Content-Lengthが数字でない',
      { contentLength: '-1' },
      400,
      'invalid_content_length',
    ],
    [
      '上限サイズを超える',
      { body: pngBytes(16, 16, 2048) },
      413,
      'file_too_large',
    ],
    [
      '許可されない形式',
      { contentType: 'image/gif' },
      415,
      'unsupported_file_type',
    ],
    [
      '内容と申告が一致しない',
      { body: jpegPrefixBytes() },
      422,
      'file_type_mismatch',
    ],
    [
      '外部識別子の無いDOCTYPEを含むSVG',
      {
        contentType: 'image/svg+xml',
        body: utf8(
          '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        ),
      },
      422,
      'svg_declaration_not_allowed',
    ],
  ] as const)(
    '受付処理の拒否(%s)は、%iと受付処理のコードを共通のエラー形式で返し、ファイルを保存しない',
    async (_label, options: UploadRequestOptions, status, code) => {
      const response = await upload(SHARED_IMAGE_PURPOSE.name, options);

      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const body = await errorOf(response);
      expect(Object.keys(body)).toStrictEqual(['error']);
      expect(body.error.code).toBe(code);
      expect(body.error.message).not.toBe('');
      expect(await expectNothingStored()).toBe(true);
    },
  );

  test('保存先が一時的に使えなければ、503と再試行までの秒数を返す', async () => {
    const response = await upload(
      SHARED_IMAGE_PURPOSE.name,
      {},
      { eligibility: 'allow-all', db: createFailingD1() },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toMatch(/^[0-9]+$/u);
    expect((await errorOf(response)).error.code).toBe('storage_unavailable');
    expect(await listObjectKeys('images')).toStrictEqual([]);
  });

  test('外部経路の要求は、経路を実行せずに定型の404で応答する', async () => {
    const tracked = trackedStreamOf(pngBytes(16, 16));

    const response = await upload(SHARED_IMAGE_PURPOSE.name, {
      caller: null,
      body: tracked.stream,
      contentLength: '64',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    expect(tracked.pulledChunks()).toBe(0);
    expect(await countRecords()).toBe(0);
  });
});

describe('アップロードできる利用者かの差し込み口', () => {
  test.each(['account_unavailable', 'email_not_verified'] as const)(
    '判定が%sで拒否すると、利用者側の要求は本文を読まずに403と判定のコードになり、ファイルを保存しない',
    async (code) => {
      const { eligibility, calls } = recordingEligibility({
        allowed: false,
        code,
      });
      const tracked = trackedStreamOf(pngBytes(16, 16));

      const response = await upload(
        SHARED_IMAGE_PURPOSE.name,
        { body: tracked.stream, contentLength: '64' },
        { eligibility },
      );

      expect(response.status).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await errorOf(response)).toStrictEqual({
        error: { code, message: DENIAL_MESSAGES[code] },
      });
      expect(tracked.pulledChunks()).toBe(0);
      expect(await expectNothingStored()).toBe(true);
      expect(calls).toStrictEqual([
        {
          principal: USER_PRINCIPAL,
          purpose: SHARED_IMAGE_PURPOSE,
          sessionPrincipal: USER_PRINCIPAL,
        },
      ]);
    },
  );

  test('主体の種類が対象外の要求は、判定を呼ばずに403にする', async () => {
    const { eligibility, calls } = recordingEligibility({ allowed: true });

    const response = await upload(
      ADMIN_IMAGE_PURPOSE.name,
      {},
      { eligibility },
    );

    expect(response.status).toBe(403);
    expect(calls).toStrictEqual([]);
  });

  test('管理者側の要求では判定を呼ばず、拒否する判定を束縛していてもアップロードが通る', async () => {
    const { eligibility, calls } = recordingEligibility({
      allowed: false,
      code: 'account_unavailable',
    });

    const response = await upload(
      SHARED_IMAGE_PURPOSE.name,
      { caller: 'admin' },
      { eligibility },
    );

    expect(response.status).toBe(201);
    expect(calls).toStrictEqual([]);
    expect(await countRecords()).toBe(1);
  });

  test('判定が許可すると、本文を読んで利用者のアップロードを受け付ける', async () => {
    const { eligibility, calls } = recordingEligibility({ allowed: true });
    const bytes = pngBytes(16, 16);
    const tracked = trackedStreamOf(bytes);

    const response = await upload(
      SHARED_IMAGE_PURPOSE.name,
      { body: tracked.stream, contentLength: String(bytes.length) },
      { eligibility },
    );

    expect(response.status).toBe(201);
    expect(tracked.pulledChunks()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(await countRecords()).toBe(1);
  });

  test('全許可の実装を束縛すると、利用者のアップロードが通る', async () => {
    const response = await upload(
      SHARED_IMAGE_PURPOSE.name,
      {},
      { eligibility: 'allow-all' },
    );

    expect(response.status).toBe(201);
    expect(await countRecords()).toBe(1);
  });
});

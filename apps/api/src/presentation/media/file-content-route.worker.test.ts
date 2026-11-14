import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';
import { z } from 'zod';

import type { AppModule } from '../../../lib/core/di/app-module.ts';
import {
  INTERNAL_ERROR_RESPONSE,
  NOT_FOUND_RESPONSE,
} from '../../../lib/core/errors/error-envelope.ts';
import { attachmentDisposition } from '../../../lib/core/media/file-name.ts';
import type {
  MediaFileView,
  MediaLocation,
} from '../../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';
import { platformEnvShape } from '../../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { createMediaPlatformModule } from '../../../lib/workers/media/media-platform-module.ts';
import {
  ADMIN_A,
  fileIdOf,
  FILE_PURPOSE,
  insertFile,
  insertReason,
  objectKeyOf,
  T0,
  USER_A,
  USER_B,
} from '../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  filePurposeRow,
} from '../../../lib/workers/media/testing/media-operations-fixtures.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../../lib/workers/observability/sentry.ts';
import { createFailingD1 } from '../../../test/support/failing-d1.ts';
import {
  type FileAccessCaller,
  PolicyFileAccessAuthorizer,
  type FileAccessAuthorizer,
} from '../../application/media/file-access-authorizer.ts';
import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
  type FileReadPolicy,
} from '../../application/media/file-access-policies.ts';
import {
  SESSION_TYPES,
  type SessionVerification,
  type SessionVerifier,
} from '../../application/session/session-verifier.ts';
import { DenyAllAdminMediaReviewPolicy } from '../../infrastructure/media/deny-all-admin-media-review-policy.ts';
import { OwnerOnlyFileReadPolicy } from '../../infrastructure/media/owner-only-file-read-policy.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
} from '../gateway/gateway-headers.ts';
import { createInternalRoutesModule } from '../gateway/internal-only.ts';
import { resolveGatewayClientIp } from '../gateway/internal-request.ts';
import { registerFileContentRoutes } from './file-content-route.ts';

type TestEnv = typeof env;
type TestApp = Hono<PlatformHonoEnv<TestEnv>>;

interface PolicyCall {
  readonly principal: AuthenticatedPrincipal;
  readonly file: MediaFileView;
}

interface RecordingPolicy {
  readonly policy: FileReadPolicy & AdminMediaReviewPolicy;
  readonly calls: PolicyCall[];
}

interface AccessOptions {
  readonly registeredPolicy?: FileReadPolicy;
  readonly adminReviewPolicy?: AdminMediaReviewPolicy;
  readonly bindings?: Partial<Pick<TestEnv, 'DB' | 'FILES_BUCKET'>>;
}

interface DownloadOptions {
  readonly caller?: CallerKind | null;
  readonly token?: string | null;
}

interface StoredContent {
  readonly location: MediaLocation;
  readonly text: string;
  readonly httpMetadata?: R2HTTPMetadata;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';
const SESSION_TOKEN_LENGTH = 43;
const USER_A_TOKEN = 'user-a'.padEnd(SESSION_TOKEN_LENGTH, '0');
const USER_B_TOKEN = 'user-b'.padEnd(SESSION_TOKEN_LENGTH, '0');
const ADMIN_TOKEN = 'admin'.padEnd(SESSION_TOKEN_LENGTH, '0');

const REGISTERED_READ_POLICY: unique symbol = Symbol.for(
  'test.InquiryAttachmentReadPolicy',
);

const PRINCIPAL_BY_TOKEN: Readonly<Record<string, AuthenticatedPrincipal>> = {
  [USER_A_TOKEN]: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_A,
    sessionId: '01JC0SESS0000000000000000A',
  },
  [USER_B_TOKEN]: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_B,
    sessionId: '01JC0SESS0000000000000000B',
  },
  [ADMIN_TOKEN]: {
    kind: 'authenticated',
    subjectKind: 'admin',
    subjectId: ADMIN_A,
    sessionId: '01JC0SESS0000000000000000C',
  },
};

const alwaysAllowedRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

const BUCKETS: Readonly<Record<MediaLocation, R2Bucket>> = {
  images: env.IMAGES_BUCKET,
  files: env.FILES_BUCKET,
  quarantine: env.QUARANTINE_BUCKET,
};

const FAILING_R2_MESSAGE = '差し込んだR2の読み出しの失敗';

function verifyByToken(
  subjectKind: string,
  token: string,
): SessionVerification {
  const principal = PRINCIPAL_BY_TOKEN[token];
  return principal?.subjectKind === subjectKind
    ? { status: 'valid', principal }
    : { status: 'invalid' };
}

function recordingPolicy(
  decide: (call: PolicyCall) => Promise<boolean>,
): RecordingPolicy {
  const calls: PolicyCall[] = [];
  const judge = (call: PolicyCall): Promise<boolean> => {
    calls.push(call);
    return decide(call);
  };
  return { calls, policy: { canRead: judge, canReview: judge } };
}

const allowing = (): RecordingPolicy =>
  recordingPolicy(() => Promise.resolve(true));

const denying = (): RecordingPolicy =>
  recordingPolicy(() => Promise.resolve(false));

function testModule(options: AccessOptions): AppModule<TestApp> {
  return {
    name: 'file-content-route-test',
    bindings: new ContainerModule(({ bind }) => {
      bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).toConstantValue({
        verify: ({ subjectKind, token }) =>
          Promise.resolve(verifyByToken(subjectKind, token)),
      });
      bind<FileReadPolicy>(FILE_ACCESS_TYPES.DefaultFileReadPolicy).to(
        OwnerOnlyFileReadPolicy,
      );
      if (options.adminReviewPolicy === undefined) {
        bind<AdminMediaReviewPolicy>(
          FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
        ).to(DenyAllAdminMediaReviewPolicy);
      } else {
        bind<AdminMediaReviewPolicy>(
          FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
        ).toConstantValue(options.adminReviewPolicy);
      }
      if (options.registeredPolicy !== undefined) {
        bind<FileReadPolicy>(REGISTERED_READ_POLICY).toConstantValue(
          options.registeredPolicy,
        );
      }
      const registrations =
        options.registeredPolicy === undefined
          ? []
          : [{ purpose: FILE_PURPOSE, policy: REGISTERED_READ_POLICY }];
      bind<FileAccessAuthorizer>(
        FILE_ACCESS_TYPES.FileAccessAuthorizer,
      ).toDynamicValue(
        (context) =>
          new PolicyFileAccessAuthorizer({
            registrations,
            resolveReadPolicy: (identifier) => context.get(identifier),
            defaultReadPolicy: context.get<FileReadPolicy>(
              FILE_ACCESS_TYPES.DefaultFileReadPolicy,
            ),
            adminReviewPolicy: context.get<AdminMediaReviewPolicy>(
              FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
            ),
          }),
      );
    }),
  };
}

function createTestApp(options: AccessOptions): TestApp {
  return createWorkerApp<TestEnv>({
    appName: 'api',
    envSchema: z.object(platformEnvShape),
    modules: [
      testModule(options),
      createMediaPlatformModule('api'),
      createInternalRoutesModule<TestEnv>([registerFileContentRoutes]),
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

function defaultTokenOf(caller: CallerKind | null): string {
  return caller === 'admin' ? ADMIN_TOKEN : USER_A_TOKEN;
}

function requestHeaders(options: DownloadOptions): Headers {
  const caller = options.caller === undefined ? 'client' : options.caller;
  const token =
    options.token === undefined ? defaultTokenOf(caller) : options.token;
  const headers = new Headers({ [GATEWAY_HEADERS.clientIp]: RELAYED_IP });
  if (caller !== null) {
    headers.set(GATEWAY_HEADERS.caller, caller);
  }
  if (token !== null) {
    headers.set(GATEWAY_HEADERS.sessionToken, token);
  }
  return headers;
}

async function download(
  fileId: string,
  options: DownloadOptions = {},
  access: AccessOptions = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await createTestApp(access).fetch(
    new Request(`${BASE_URL}/internal/media/files/${fileId}`, {
      headers: requestHeaders(options),
    }),
    { ...env, IP_RATE_LIMITER: alwaysAllowedRateLimiter, ...access.bindings },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function putContent(
  index: number,
  { location, text, httpMetadata }: StoredContent,
): Promise<void> {
  await BUCKETS[location].put(
    objectKeyOf(index),
    text,
    httpMetadata === undefined ? {} : { httpMetadata },
  );
}

const ATTACHMENT_NAME = '見積書(第2版).pdf';
const ATTACHMENT_TEXT = '%PDF-1.7 見積書の内容';

async function seedAttachment(
  index: number,
  columns: Parameters<typeof insertFile>[1] = {},
): Promise<void> {
  await insertFile(index, {
    ...filePurposeRow(),
    originalFileName: ATTACHMENT_NAME,
    attachedAt: T0,
    ...columns,
  });
  await putContent(index, {
    location: 'files',
    text: ATTACHMENT_TEXT,
    httpMetadata: {
      contentType: 'application/pdf',
      contentDisposition: attachmentDisposition(ATTACHMENT_NAME),
      cacheControl: 'private, max-age=0',
    },
  });
}

const IMAGE_NAME = '隔離中の画像.png';
const IMAGE_TEXT = 'png-bytes-of-quarantined-image';

async function seedQuarantinedImage(index: number): Promise<void> {
  await insertFile(index, {
    location: 'quarantine',
    originalFileName: IMAGE_NAME,
    moderationStatus: 'flagged',
  });
  await insertReason(index, 'auto');
  await putContent(index, {
    location: 'quarantine',
    text: IMAGE_TEXT,
    httpMetadata: { contentType: 'image/png' },
  });
}

async function errorOf(response: Response): Promise<ErrorBody> {
  return response.json<ErrorBody>();
}

async function expectIndistinguishableNotFound(
  response: Response,
): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Content-Disposition')).toBeNull();
  expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
}

function failingBucket(): R2Bucket {
  return {
    get: () => Promise.reject(new Error(FAILING_R2_MESSAGE)),
  } as unknown as R2Bucket;
}

beforeEach(async () => {
  await clearMediaState();
});

afterAll(() => {
  resetSync();
});

test('判定の呼び出し元の種類は、内部経路の呼び出し元の種類と同じ値の集合である', () => {
  expectTypeOf<FileAccessCaller>().toEqualTypeOf<CallerKind>();
});

describe('GET /internal/media/files/:fileId', () => {
  test('保有者のファイルを、元のファイル名の添付・保存時の形式・バイト数・no-store・nosniffを付けて本文のまま返す', async () => {
    await seedAttachment(1);

    const response = await download(fileIdOf(1));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      attachmentDisposition(ATTACHMENT_NAME),
    );
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; /u,
    );
    expect(response.headers.get('Content-Length')).toBe(
      String(new TextEncoder().encode(ATTACHMENT_TEXT).length),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe(ATTACHMENT_TEXT);
  });

  test('テキストのファイルは、保存時の文字コードの引数付きの形式で返す', async () => {
    await insertFile(1, {
      ...filePurposeRow(),
      contentType: 'text/plain; charset=utf-8',
      originalFileName: 'メモ.txt',
    });
    await putContent(1, {
      location: 'files',
      text: '本文',
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });

    const response = await download(fileIdOf(1));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(response.headers.get('Content-Disposition')).toBe(
      attachmentDisposition('メモ.txt'),
    );
  });

  test('オブジェクトに形式の記録が無ければ、記録の形式で返す', async () => {
    await insertFile(1, filePurposeRow());
    await putContent(1, { location: 'files', text: 'pdf' });

    const response = await download(fileIdOf(1));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
  });

  describe('未ログイン', () => {
    test.each([
      ['セッションが無い', null],
      ['無効なセッション', 'expired'.padEnd(SESSION_TOKEN_LENGTH, '0')],
    ] as const)(
      '%sなら、ファイルの有無と方針によらず401と共通のエラー形式で応答する',
      async (_label, token) => {
        await seedAttachment(1);
        const { policy, calls } = allowing();

        const response = await download(
          fileIdOf(1),
          { token },
          { registeredPolicy: policy },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect((await errorOf(response)).error.code).toBe('unauthenticated');
        expect(calls).toStrictEqual([]);
      },
    );

    test('形式の不正な識別子でも、404より先に401で応答する', async () => {
      const response = await download('not-a-file-id', { token: null });

      expect(response.status).toBe(401);
    });
  });

  describe('存在の有無が分からないよう、同じ404で応答する', () => {
    test.each([
      ['形式の不正な識別子', 'not-a-file-id'],
      ['26文字でない識別子', fileIdOf(1).slice(1)],
      ['存在しない識別子', fileIdOf(99)],
    ])('%s', async (_label, fileId) => {
      await seedAttachment(1);
      const { policy, calls } = allowing();

      const response = await download(fileId, {}, { registeredPolicy: policy });

      await expectIndistinguishableNotFound(response);
      expect(calls).toStrictEqual([]);
    });

    test.each([
      ['保存未完了', { storedAt: null }],
      ['論理削除', { deletedAt: T0 }],
      ['削除待ち', { eraseRequestedAt: T0 }],
    ] as const)(
      '%sのファイルは、閲覧を許可する方針が登録されていても判定せずに404にする',
      async (_label, columns) => {
        await seedAttachment(1, columns);
        const { policy, calls } = allowing();

        const response = await download(
          fileIdOf(1),
          {},
          { registeredPolicy: policy },
        );

        await expectIndistinguishableNotFound(response);
        expect(calls).toStrictEqual([]);
      },
    );

    test('論理削除した画像は、管理者の画像確認の方針が許可しても404にする', async () => {
      await insertFile(1, { deletedAt: T0 });
      await putContent(1, { location: 'images', text: 'png' });
      const { policy, calls } = allowing();

      const response = await download(
        fileIdOf(1),
        { caller: 'admin' },
        { adminReviewPolicy: policy },
      );

      await expectIndistinguishableNotFound(response);
      expect(calls).toStrictEqual([]);
    });

    test('方針の無い用途のファイルは、保有者以外の利用者に404で応答する', async () => {
      await seedAttachment(1);

      const response = await download(fileIdOf(1), { token: USER_B_TOKEN });

      await expectIndistinguishableNotFound(response);
    });

    test('方針の無い用途のファイルは、保有者でない管理者にも404で応答する', async () => {
      await seedAttachment(1);

      const response = await download(fileIdOf(1), { caller: 'admin' });

      await expectIndistinguishableNotFound(response);
    });

    test('登録した方針が拒否すれば、保有者にも404で応答する', async () => {
      await seedAttachment(1);
      const { policy, calls } = denying();

      const response = await download(
        fileIdOf(1),
        {},
        { registeredPolicy: policy },
      );

      await expectIndistinguishableNotFound(response);
      expect(calls).toHaveLength(1);
    });

    test('管理者の画像確認の方針が既定(全拒否)なら、管理者側の画像の要求に404で応答する', async () => {
      await seedQuarantinedImage(1);

      const response = await download(fileIdOf(1), { caller: 'admin' });

      await expectIndistinguishableNotFound(response);
    });

    test('利用者側からの画像の要求は、保有者でも管理者の画像確認の方針が許可しても404にする', async () => {
      await seedQuarantinedImage(1);
      const { policy, calls } = allowing();

      const response = await download(
        fileIdOf(1),
        {},
        { adminReviewPolicy: policy },
      );

      await expectIndistinguishableNotFound(response);
      expect(calls).toStrictEqual([]);
    });

    test('記録はあるがどのバケットにもオブジェクトが無ければ404にする', async () => {
      await insertFile(1, filePurposeRow());

      const response = await download(fileIdOf(1));

      await expectIndistinguishableNotFound(response);
    });
  });

  test('登録した方針が許可すれば、保有者でない管理者にもファイルを返し、方針へ主体とファイルを渡す', async () => {
    await seedAttachment(1);
    const { policy, calls } = allowing();

    const response = await download(
      fileIdOf(1),
      { caller: 'admin' },
      { registeredPolicy: policy },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ATTACHMENT_TEXT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.principal).toStrictEqual(PRINCIPAL_BY_TOKEN[ADMIN_TOKEN]);
    expect(calls[0]?.file).toMatchObject({
      id: fileIdOf(1),
      purpose: FILE_PURPOSE,
      owner: { kind: 'user', id: USER_A },
    });
  });

  describe('管理者側の画像の確認', () => {
    test('管理者の画像確認の方針が許可すれば、隔離中の画像を隔離バケットから添付として返す', async () => {
      await seedQuarantinedImage(1);
      const { policy, calls } = allowing();

      const response = await download(
        fileIdOf(1),
        { caller: 'admin' },
        { adminReviewPolicy: policy },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      expect(response.headers.get('Content-Disposition')).toBe(
        attachmentDisposition(IMAGE_NAME),
      );
      expect(response.headers.get('Content-Length')).toBe(
        String(IMAGE_TEXT.length),
      );
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(await response.text()).toBe(IMAGE_TEXT);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.file).toMatchObject({
        id: fileIdOf(1),
        quarantined: true,
        location: 'quarantine',
      });
    });

    test.each([
      [
        '隔離バケットの記録で、移動が済み画像用のバケットにある',
        'quarantine',
        'images',
      ],
      [
        '画像用のバケットの記録で、移動が済み隔離バケットにある',
        'images',
        'quarantine',
      ],
    ] as const)(
      '保存先の記録とずれた画像(%s)を、他方のバケットから読む',
      async (_label, recorded, actual) => {
        await insertFile(1, {
          location: recorded,
          originalFileName: IMAGE_NAME,
        });
        await putContent(1, {
          location: actual,
          text: IMAGE_TEXT,
          httpMetadata: { contentType: 'image/png' },
        });

        const response = await download(
          fileIdOf(1),
          { caller: 'admin' },
          { adminReviewPolicy: allowing().policy },
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(IMAGE_TEXT);
      },
    );
  });

  test('方針が例外を投げると、共通のエラー処理が500の定型の応答にする', async () => {
    await seedAttachment(1);
    const { policy } = recordingPolicy(() =>
      Promise.reject(new Error('差し込んだ方針の失敗')),
    );

    const response = await download(
      fileIdOf(1),
      {},
      { registeredPolicy: policy },
    );

    expect(response.status).toBe(INTERNAL_ERROR_RESPONSE.status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(INTERNAL_ERROR_RESPONSE.body);
  });

  test.each([
    ['記録の保存先', { DB: createFailingD1() }],
    ['オブジェクトの保存先', { FILES_BUCKET: failingBucket() }],
  ] as const)(
    '%sが一時的に使えなければ、503と再試行までの秒数を返す',
    async (_label, bindings) => {
      await seedAttachment(1);

      const response = await download(fileIdOf(1), {}, { bindings });

      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toMatch(/^[0-9]+$/u);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect((await errorOf(response)).error.code).toBe('storage_unavailable');
    },
  );

  test('外部経路の要求は、経路を実行せずに定型の404で応答する', async () => {
    await seedAttachment(1);
    const { policy, calls } = allowing();

    const response = await download(
      fileIdOf(1),
      { caller: null },
      { registeredPolicy: policy },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    expect(calls).toStrictEqual([]);
  });
});

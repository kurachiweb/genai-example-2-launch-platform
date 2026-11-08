import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
} from '../../common-lib/media/media-types.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../lib/core/media/media-file.ts';
import {
  defineUploadPurpose,
  type UploadPurposeRegistry,
} from '../../lib/core/media/upload-purpose.ts';
import type { AuthenticatedPrincipal } from '../../lib/core/session/session-view.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { D1MediaFileStore } from '../../lib/workers/media/d1-media-file-store.ts';
import { MediaFilesService } from '../../lib/workers/media/media-files-service.ts';
import { clearMediaState } from '../../lib/workers/media/testing/media-operations-fixtures.ts';
import { MediaUploadReceiver } from '../../lib/workers/media/upload-receiver.ts';
import {
  callInternal,
  callPublic,
} from '../../test/support/gateway-test-harness.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../test/support/media-file-view.ts';
import {
  type FileAccessAuthorizer,
  FileAccessRegistrationError,
  PolicyFileAccessAuthorizer,
} from '../application/media/file-access-authorizer.ts';
import {
  type AdminMediaReviewInput,
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
  type FileReadPolicy,
  type FileReadPolicyInput,
} from '../application/media/file-access-policies.ts';
import {
  ExpiredFileErasureJob,
  LocationReconciliationJob,
  MEDIA_JOB_TYPES,
  ModerationRequeueJob,
} from '../application/media/media-daily-jobs.ts';
import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../application/media/uploader-eligibility.ts';
import * as mainModule from '../index.ts';
import { OwnerOnlyFileReadPolicy } from '../infrastructure/media/owner-only-file-read-policy.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { createApiMediaModule } from './media-module.ts';
import { MODULES } from './modules.ts';
import { UPLOAD_PURPOSES } from './upload-purposes.ts';

type TestApp = Hono<PlatformHonoEnv<typeof env>>;

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';
const FILE_ID = '01JC0FILE000000000000000001';

// 業務日付2026-11-02の業務時刻4:21
const SCHEDULED_TIME = new Date(Date.UTC(2026, 10, 2, 12, 21));
const DAILY_CRON = '21 12 * * *';

const MEDIA_JOB_NAMES = [
  'media-pipeline.expired-file-erasure',
  'media-pipeline.moderation-requeue',
  'media-pipeline.location-reconciliation',
];

const OWNER: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JC0USER00000000000000001',
  sessionId: '01JC0SESSION0000000000001',
});

const OTHER_USER: AuthenticatedPrincipal = Object.freeze({
  ...OWNER,
  subjectId: '01JC0USER00000000000000002',
});

const ADMIN: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: '01JC0ADMIN0000000000000001',
  sessionId: '01JC0SESSION0000000000002',
});

const INQUIRY_ATTACHMENT = defineUploadPurpose({
  name: 'inquiry-attachment',
  storage: 'files',
  uploaderKinds: ['user'],
  allowedTypes: ATTACHMENT_MEDIA_TYPES,
  maxBytes: 1024,
});

const PRODUCT_IMAGE = defineUploadPurpose({
  name: 'product-image',
  storage: 'images',
  uploaderKinds: ['user'],
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: 1024,
});

const INQUIRY_POLICY: unique symbol = Symbol('InquiryAttachmentReadPolicy');

class RecordingReadPolicy implements FileReadPolicy {
  readonly calls: FileReadPolicyInput[] = [];

  canRead(input: FileReadPolicyInput): Promise<boolean> {
    this.calls.push(input);
    return Promise.resolve(input.principal.subjectId === OTHER_USER.subjectId);
  }
}

class RecordingReviewPolicy implements AdminMediaReviewPolicy {
  readonly calls: AdminMediaReviewInput[] = [];

  canReview(input: AdminMediaReviewInput): Promise<boolean> {
    this.calls.push(input);
    return Promise.resolve(true);
  }
}

function createContainer(modules: readonly AppModule<TestApp>[] = MODULES) {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-api-media-module',
        clientIp: undefined,
      },
    },
    modules,
  );
}

function canAccess(
  modules: readonly AppModule<TestApp>[],
  caller: 'client' | 'admin',
  principal: AuthenticatedPrincipal,
  file: MediaFileView,
): Promise<boolean> {
  return createContainer(modules)
    .get<FileAccessAuthorizer>(FILE_ACCESS_TYPES.FileAccessAuthorizer)
    .canAccess({ caller, principal, file });
}

function internalRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set(GATEWAY_HEADERS.clientIp, RELAYED_IP);
  return new Request(`${BASE_URL}${path}`, { ...init, headers });
}

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

async function runScheduled(cron: string, scheduledTime: Date): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron,
      scheduledTime: scheduledTime.getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

beforeEach(async () => {
  await clearMediaState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのメディアのモジュール', () => {
  test('処理単位のコンテナから、共通の操作・登録箇所の用途の登録表・既定の方針・判定・3つのジョブを解決する', () => {
    const container = createContainer();

    expect(
      container
        .get<UploadPurposeRegistry>(MEDIA_TYPES.UploadPurposeRegistry)
        .list(),
    ).toEqual(UPLOAD_PURPOSES);
    expect(container.get(MEDIA_TYPES.MediaFiles)).toBeInstanceOf(
      MediaFilesService,
    );
    expect(container.get(MEDIA_TYPES.UploadReceiver)).toBeInstanceOf(
      MediaUploadReceiver,
    );
    expect(container.get(MEDIA_TYPES.MediaFileStore)).toBeInstanceOf(
      D1MediaFileStore,
    );
    expect(
      container.get(FILE_ACCESS_TYPES.DefaultFileReadPolicy),
    ).toBeInstanceOf(OwnerOnlyFileReadPolicy);
    expect(
      container.get<AdminMediaReviewPolicy>(
        FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
      ),
    ).toHaveProperty('canReview');
    expect(
      container.get(FILE_ACCESS_TYPES.FileAccessAuthorizer),
    ).toBeInstanceOf(PolicyFileAccessAuthorizer);
    expect(
      container.get<UploaderEligibility>(
        UPLOAD_ACCESS_TYPES.UploaderEligibility,
      ),
    ).toHaveProperty('check');
    expect(container.get(MEDIA_JOB_TYPES.ExpiredFileErasureJob)).toBeInstanceOf(
      ExpiredFileErasureJob,
    );
    expect(container.get(MEDIA_JOB_TYPES.ModerationRequeueJob)).toBeInstanceOf(
      ModerationRequeueJob,
    );
    expect(
      container.get(MEDIA_JOB_TYPES.LocationReconciliationJob),
    ).toBeInstanceOf(LocationReconciliationJob);
  });

  test('方針を登録していないファイル用の用途は、既定の閲覧の方針で保有者だけが読める', async () => {
    const file = mediaFileViewOf({
      owner: { kind: 'user', id: OWNER.subjectId },
    });

    expect(await canAccess(MODULES, 'client', OWNER, file)).toBe(true);
    expect(await canAccess(MODULES, 'client', OTHER_USER, file)).toBe(false);
  });

  test('管理者側の管理者による画像の判定は、管理者の画像確認の識別子に束縛した方針へ任せる', async () => {
    const review = new RecordingReviewPolicy();
    const modules: AppModule<TestApp>[] = [
      ...MODULES.filter(({ name }) => name !== 'media-review-policy'),
      {
        name: 'test-review-policy',
        bindings: new ContainerModule(({ bind }) => {
          bind<AdminMediaReviewPolicy>(
            FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
          ).toConstantValue(review);
        }),
      },
    ];
    const image = imageFileViewOf();

    expect(await canAccess(modules, 'admin', ADMIN, image)).toBe(true);
    expect(review.calls).toEqual([{ principal: ADMIN, file: image }]);
  });

  test('用途に登録した閲覧の方針を、判定のときに処理単位のコンテナから解決して使う', async () => {
    const policy = new RecordingReadPolicy();
    const modules: AppModule<TestApp>[] = [
      ...MODULES.filter(({ name }) => name !== 'api-media'),
      createApiMediaModule({
        purposes: [INQUIRY_ATTACHMENT, PRODUCT_IMAGE],
        readPolicies: [
          { purpose: 'inquiry-attachment', policy: INQUIRY_POLICY },
        ],
      }),
      {
        name: 'test-read-policy',
        bindings: new ContainerModule(({ bind }) => {
          bind<FileReadPolicy>(INQUIRY_POLICY).toConstantValue(policy);
        }),
      },
    ];
    const file = mediaFileViewOf({
      owner: { kind: 'user', id: OWNER.subjectId },
    });

    expect(await canAccess(modules, 'client', OTHER_USER, file)).toBe(true);
    expect(await canAccess(modules, 'client', OWNER, file)).toBe(false);
    expect(policy.calls.map(({ principal }) => principal.subjectId)).toEqual([
      OTHER_USER.subjectId,
      OWNER.subjectId,
    ]);
    expect(
      createContainer(modules)
        .get<UploadPurposeRegistry>(MEDIA_TYPES.UploadPurposeRegistry)
        .list(),
    ).toEqual([INQUIRY_ATTACHMENT, PRODUCT_IMAGE]);
  });

  test.each([
    { label: '用途の登録表に無い', purpose: 'unknown-attachment' },
    { label: '画像用の', purpose: 'product-image' },
  ])(
    '閲覧の方針を$label用途に登録すると、モジュールの組み立てが失敗する',
    ({ purpose }) => {
      const build = () =>
        createApiMediaModule({
          purposes: [INQUIRY_ATTACHMENT, PRODUCT_IMAGE],
          readPolicies: [{ purpose, policy: INQUIRY_POLICY }],
        });

      expect(build).toThrow(FileAccessRegistrationError);
      expect(build).toThrow(JSON.stringify(purpose));
    },
  );
});

describe('メディアの内部REST', () => {
  test('アップロードの経路を内部経路に登録し、未登録の用途は404と用途のエラーコードになる', async () => {
    const response = await callInternal(
      'client',
      internalRequest('/internal/media/uploads/product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '1' },
        body: new Uint8Array([0]),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'upload_purpose_not_found' },
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('非公開ファイルの経路を内部経路に登録し、未ログインの要求は401になる', async () => {
    const response = await callInternal(
      'admin',
      internalRequest(`/internal/media/files/${FILE_ID}`),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test.each([
    { method: 'POST', path: '/internal/media/uploads/user-avatar' },
    { method: 'GET', path: `/internal/media/files/${FILE_ID}` },
  ])('外部経路からの$method $pathは404になる', async ({ method, path }) => {
    const response = await callPublic(
      new Request(`${BASE_URL}${path}`, { method }),
    );

    expect(response.status).toBe(404);
  });
});

describe('定期実行からのメディアの日次バッチ', () => {
  test('4:21の起動で、メディアの3つのジョブが物理削除・判定の再依頼・保存先の照合の順に成功する', async () => {
    const logs = recordConsole();

    await runScheduled(DAILY_CRON, SCHEDULED_TIME);

    const summary = logs.find(
      ({ message }) => message === '定期実行を終えました',
    );
    const jobs = (summary?.['jobs'] ?? []) as readonly {
      readonly name: string;
      readonly result: string;
    }[];
    expect(
      jobs
        .filter(({ name }) => name.startsWith('media-pipeline.'))
        .map(({ name, result }) => ({ name, result })),
    ).toEqual(MEDIA_JOB_NAMES.map((name) => ({ name, result: 'succeeded' })));
    expect(
      logs
        .filter(({ category }) => category.startsWith('api.media.'))
        .map(({ category }) => category),
    ).toEqual([
      'api.media.expired-file-erasure',
      'api.media.moderation-requeue',
      'api.media.location-reconciliation',
    ]);
  });
});

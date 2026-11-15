import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { ATTACHMENT_MEDIA_TYPES } from '../../common-lib/media/media-types.ts';
import {
  encodeFileNameHeader,
  UPLOAD_FILE_NAME_HEADER,
  type UploadedFile,
} from '../../common-lib/media/upload-protocol.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createWorkerApp } from '../../lib/workers/http/create-worker-app.ts';
import {
  clearIdentityTables,
  insertUser,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearMediaState,
  expectNothingStored,
  pdfBytes,
  readRecord,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import { defineUploadPurpose } from '../../lib/core/media/upload-purpose.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import { AccountUploaderEligibility } from '../application/identity/account-uploader-eligibility.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { SessionIssuer } from '../application/identity/session-issuer.ts';
import { UPLOAD_ACCESS_TYPES } from '../application/media/uploader-eligibility.ts';
import { GATEWAY_HEADERS } from '../presentation/gateway/gateway-headers.ts';
import { resolveGatewayClientIp } from '../presentation/gateway/internal-request.ts';
import { apiEnvSchema } from './env-schema.ts';
import { createApiMediaModule } from './media-module.ts';
import { MODULES } from './modules.ts';
import { RATE_LIMIT_EXCLUSIONS } from './rate-limit-exclusions.ts';

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';

const TEST_ATTACHMENT = defineUploadPurpose({
  name: 'test-attachment',
  storage: 'files',
  uploaderKinds: ['user'],
  allowedTypes: ATTACHMENT_MEDIA_TYPES,
  maxBytes: 1024,
});

const alwaysAllowedRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

const MODULES_WITH_TEST_PURPOSE = [
  ...MODULES.filter(({ name }) => name !== 'api-media'),
  createApiMediaModule({ purposes: [TEST_ATTACHMENT], readPolicies: [] }),
];

const app = createWorkerApp<Env>({
  appName: 'api',
  envSchema: apiEnvSchema,
  modules: MODULES_WITH_TEST_PURPOSE,
  rateLimitExclusions: RATE_LIMIT_EXCLUSIONS,
  resolveClientIp: resolveGatewayClientIp,
  sentry: (bindings) =>
    buildSentryOptions({
      ...readSentryRuntimeOptions(bindings),
      dsn: undefined,
    }),
});

function createContainer() {
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

async function issueSessionOf(userIndex: number): Promise<string> {
  const issued = await createContainer()
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });
  return issued.token;
}

async function uploadAs(token: string): Promise<Response> {
  const body = pdfBytes();
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${BASE_URL}/internal/media/uploads/${TEST_ATTACHMENT.name}`, {
      method: 'POST',
      headers: {
        [GATEWAY_HEADERS.caller]: 'client',
        [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
        [GATEWAY_HEADERS.sessionToken]: token,
        [UPLOAD_FILE_NAME_HEADER]: encodeFileNameHeader('見積書.pdf'),
        'Content-Type': 'application/pdf',
        'Content-Length': String(body.length),
      },
      body,
    }),
    { ...env, IP_RATE_LIMITER: alwaysAllowedRateLimiter },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

beforeEach(async () => {
  await clearMediaState();
  await clearIdentityTables();
});

afterAll(() => {
  resetSync();
});

describe('アップロードできる利用者の判定の束縛', () => {
  test('処理単位のコンテナで、差し込み口の識別子が利用者の状態による判定に解決する', () => {
    const container = createContainer();

    const eligibility = container.get(UPLOAD_ACCESS_TYPES.UploaderEligibility);

    expect(eligibility).toBeInstanceOf(AccountUploaderEligibility);
    expect(eligibility).toBe(
      container.get(IDENTITY_TYPES.AccountUploaderEligibility),
    );
    expect(eligibility).not.toBe(
      createContainer().get(UPLOAD_ACCESS_TYPES.UploaderEligibility),
    );
  });

  test('停止中の利用者のセッションでのアップロードは403と利用できないアカウントのコードになり、記録もオブジェクトも残さない', async () => {
    await insertUser(1, { status: 'suspended', emailVerifiedAt: T0 });
    const token = await issueSessionOf(1);

    const response = await uploadAs(token);

    expect(response.status).toBe(403);
    expect(await response.json<ErrorBody>()).toStrictEqual({
      error: {
        code: 'account_unavailable',
        message:
          'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
      },
    });
    expect(await expectNothingStored()).toBe(true);
  });

  test('メールアドレスが未確認の利用者のアップロードは受け付けて、その利用者を保有者として記録する', async () => {
    await insertUser(1, { emailVerifiedAt: null });
    const token = await issueSessionOf(1);

    const response = await uploadAs(token);

    expect(response.status).toBe(201);
    const { data } = await response.json<{ readonly data: UploadedFile }>();
    expect(await readRecord(data.fileId)).toMatchObject({
      purpose: TEST_ATTACHMENT.name,
      ownerKind: 'user',
      ownerId: userIdOf(1),
    });
  });
});

import { z } from '@hono/zod-openapi';
import { resetSync } from '@logtape/logtape';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import { users } from '../../../../db/schema/identity/users.ts';
import { apiKeys } from '../../../../db/schema/public-api/api-keys.ts';
import { createKeyedHasher } from '../../../../lib/core/crypto/keyed-hasher.ts';
import type { WindowState } from '../../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../../lib/core/rate-limit/rate-limit-key.ts';
import {
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  apiKeyIdOf,
  clearApiKeyTables,
  insertApiKey,
} from '../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from '../../../../test/support/observability-recording.ts';
import { createPublicApiRestHarness } from '../../../../test/support/public-api-rest-harness.ts';
import type { PublicApiCaller } from '../../../application/public-api/api-key-authorizer.ts';
import {
  PUBLIC_API_READ_RULE,
  PUBLIC_API_WRITE_RULE,
} from '../../../application/public-api/rate-limit-rules.ts';
import { API_KEY_HASH_PURPOSE } from '../../../domain/public-api/api-key-token.ts';
import type { PublicRestRoutes } from '../public-api-app.ts';
import { dataEnvelope } from '../responses.ts';
import { publicApiError } from './public-api-errors.ts';
import { definePublicApiRoute } from './route-definition.ts';

const PUBLIC_PATH = '/test/products/{id}';

const OWN_PATH = '/test/me/profile';

const MISSING_PRODUCT_ID = 'missing';

const BEARER_CHALLENGE = 'Bearer realm="public-api"';

const INVALID_TOKEN_CHALLENGE =
  'Bearer realm="public-api", error="invalid_token"';

const RATE_LIMIT_HEADERS = Object.freeze([
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
]);

const WINDOW_STATE_KEY = 'window';

const MILLISECONDS_PER_MINUTE = 60_000;

const SUSPENDED_COLUMNS = {
  emailVerifiedAt: T0,
  status: 'suspended',
  suspendedAt: T0,
} as const;

const callerSchema = z.object({ record_id: z.string(), user_id: z.string() });

const callerResponse = {
  200: {
    description: '呼び出し元',
    content: { 'application/json': { schema: dataEnvelope(callerSchema) } },
  },
} as const;

const publicReadRoute = definePublicApiRoute({
  method: 'get',
  path: PUBLIC_PATH,
  description: 'テスト用のプロダクトを返す。',
  feature: 'products',
  access: 'read',
  target: 'public',
  request: { params: z.object({ id: z.string() }) },
  responses: callerResponse,
});

const ownReadRoute = definePublicApiRoute({
  method: 'get',
  path: OWN_PATH,
  feature: 'profile',
  access: 'read',
  target: 'own',
  responses: callerResponse,
});

const ownWriteRoute = definePublicApiRoute({
  method: 'put',
  path: OWN_PATH,
  feature: 'profile',
  access: 'write',
  target: 'own',
  responses: callerResponse,
});

const callerView = (caller: PublicApiCaller) => ({
  data: { record_id: caller.keyId, user_id: caller.user.user.id },
});

const testRoutes: PublicRestRoutes<Env> = (api) => {
  api.openapi(publicReadRoute, (c) => {
    if (c.req.valid('param').id === MISSING_PRODUCT_ID) {
      throw publicApiError('product_not_found');
    }
    return c.json(callerView(c.get('publicApiCaller')), 200);
  });
  api.openapi(ownReadRoute, (c) =>
    c.json(callerView(c.get('publicApiCaller')), 200),
  );
  api.openapi(ownWriteRoute, (c) =>
    c.json(callerView(c.get('publicApiCaller')), 200),
  );
};

const harness = createPublicApiRestHarness([testRoutes]);

const hasher = createKeyedHasher(env.HASH_PEPPER);

let logs: LoggedObject[] = [];

let nextIndex = 300;

interface Owner {
  readonly userIndex: number;
  readonly keyIndex: number;
  readonly plain: string;
}

function plainKeyOf(index: number): string {
  return `lsk_${String(index).padStart(43, 'x')}`;
}

// 利用者単位の回数の記録(厳密カウンタ)はテストの間で消せないため、テストごとに別の利用者とキーを使う
async function freshOwner(
  columns: Parameters<typeof insertUser>[1] = { emailVerifiedAt: T0 },
  scopes: Partial<typeof apiKeys.$inferInsert> = {},
): Promise<Owner> {
  const index = nextIndex;
  nextIndex += 1;
  const plain = plainKeyOf(index);
  await insertUser(index, columns);
  await insertApiKey(index, index, {
    keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, plain),
    scopeProfile: 'read_write',
    ...scopes,
  });
  return { userIndex: index, keyIndex: index, plain };
}

function invoke(
  method: string,
  path: string,
  authorization?: string,
): Promise<Response> {
  return harness.request(path, {
    method,
    headers:
      authorization === undefined ? {} : { Authorization: authorization },
  });
}

const readPublic = (authorization?: string) =>
  invoke('GET', '/test/products/p1', authorization);

const readOwn = (authorization?: string) =>
  invoke('GET', OWN_PATH, authorization);

const writeOwn = (authorization?: string) =>
  invoke('PUT', OWN_PATH, authorization);

const bearer = (plain: string) => `Bearer ${plain}`;

async function errorCodeOf(response: Response): Promise<string> {
  const body: { error: { code: string } } = await response.json();
  return body.error.code;
}

function rateLimitHeadersOf(response: Response): Record<string, string | null> {
  return Object.fromEntries(
    RATE_LIMIT_HEADERS.map((name) => [name, response.headers.get(name)]),
  );
}

async function repeat(
  count: number,
  call: () => Promise<Response>,
): Promise<Response[]> {
  const responses: Response[] = [];
  for (let attempt = 0; attempt < count; attempt += 1) {
    responses.push(await call());
  }
  return responses;
}

function rejectionLogs(): LoggedObject[] {
  return logs.filter(({ category }) => category === 'api.public-api');
}

const LOG_ENVELOPE_FIELDS = new Set([
  'time',
  'level',
  'category',
  'message',
  'correlationId',
]);

function attributesOf(log: LoggedObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(log).filter(([name]) => !LOG_ENVELOPE_FIELDS.has(name)),
  );
}

// 期間の始まりを1分前へずらし、1分が経った後の要求を再現する
async function elapseWindow(
  userIndex: number,
  ruleName: string,
): Promise<void> {
  const key = await hashRateLimitKey(hasher, userIdOf(userIndex));
  const namespace = env.RATE_LIMIT_COUNTER;
  const stub = namespace.get(namespace.idFromName(`${ruleName}:${key}`));
  await runInDurableObject(stub, (_instance, state) => {
    const current = state.storage.kv.get<WindowState>(WINDOW_STATE_KEY);
    if (current === undefined) {
      throw new Error('回数の記録がありません。');
    }
    state.storage.kv.put(WINDOW_STATE_KEY, {
      ...current,
      windowStartedAt: current.windowStartedAt - MILLISECONDS_PER_MINUTE,
    });
  });
}

beforeAll(() => {
  logs = configureRecordingLogs();
});

beforeEach(async () => {
  await clearApiKeyTables();
  logs.splice(0);
});

afterAll(() => {
  resetSync();
});

describe('apiKeyAuth: 認証', () => {
  test('Authorizationヘッダーが無ければ認証が必要な旨を401とBearer方式のWWW-Authenticateで返し、回数のヘッダーを付けない', async () => {
    const response = await readPublic();

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'unauthenticated',
        message: 'APIキーによる認証が必要です。',
      },
    });
    expect(response.headers.get('WWW-Authenticate')).toBe(BEARER_CHALLENGE);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(rateLimitHeadersOf(response)).toStrictEqual({
      'X-RateLimit-Limit': null,
      'X-RateLimit-Remaining': null,
      'X-RateLimit-Reset': null,
    });
  });

  test.each(['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer  ', 'lsk_token'])(
    'Bearerの形式でないAuthorization「%s」は認証が必要な旨の401にする',
    async (authorization) => {
      const response = await readPublic(authorization);

      expect(response.status).toBe(401);
      expect(await errorCodeOf(response)).toBe('unauthenticated');
      expect(response.headers.get('WWW-Authenticate')).toBe(BEARER_CHALLENGE);
    },
  );

  test('形式に合わないキー・存在しないキー・削除済みのキーは理由を区別しない401とinvalid_tokenのWWW-Authenticateで返す', async () => {
    const owner = await freshOwner();
    const deleted = await freshOwner();
    await db
      .delete(apiKeys)
      .where(eq(apiKeys.id, apiKeyIdOf(deleted.keyIndex)));

    const responses = [
      await readPublic(bearer('lsk_short')),
      await readPublic(bearer(`${owner.plain}x`)),
      await readPublic(bearer(plainKeyOf(9999))),
      await readPublic(bearer(deleted.plain)),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({
        error: { code: 'invalid_api_key', message: 'APIキーが無効です。' },
      });
      expect(response.headers.get('WWW-Authenticate')).toBe(
        INVALID_TOKEN_CHALLENGE,
      );
      expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
    }
  });

  test('照合できたキーで処理し、経路の処理へキーのIDと持ち主を渡し、上限・残り・リセットの時刻を付ける', async () => {
    const owner = await freshOwner();
    const before = Math.floor(Date.now() / 1000);

    const response = await readPublic(bearer(owner.plain));

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      data: {
        record_id: apiKeyIdOf(owner.keyIndex),
        user_id: userIdOf(owner.userIndex),
      },
    });
    const headers = rateLimitHeadersOf(response);
    expect(headers['X-RateLimit-Limit']).toBe('30');
    expect(headers['X-RateLimit-Remaining']).toBe('29');
    const reset = Number(headers['X-RateLimit-Reset']);
    expect(Number.isInteger(reset)).toBe(true);
    expect(reset).toBeGreaterThanOrEqual(before + 60);
    expect(reset).toBeLessThanOrEqual(before + 62);
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
  });

  test('認証の後に経路の処理が投げた想定内の失敗は共通のエラー形式で返し、消費した回数のヘッダーを付ける', async () => {
    const owner = await freshOwner();

    const response = await invoke(
      'GET',
      `/test/products/${MISSING_PRODUCT_ID}`,
      bearer(owner.plain),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: {
        code: 'product_not_found',
        message: 'プロダクトが見つかりません。',
      },
    });
    expect(response.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('29');
  });

  test('Bearerの方式名の大文字小文字を区別しない', async () => {
    const owner = await freshOwner();

    const response = await readPublic(`bearer ${owner.plain}`);

    expect(response.status).toBe(200);
  });
});

describe('apiKeyAuth: 権限と利用者の状態', () => {
  test('権限スコープが経路の機能と操作を許さなければ403で返し、回数を消費しない', async () => {
    const owner = await freshOwner(
      { emailVerifiedAt: T0 },
      { scopeProducts: 'none', scopeProfile: 'read' },
    );

    const publicResponse = await readPublic(bearer(owner.plain));
    const writeResponse = await writeOwn(bearer(owner.plain));
    const allowed = await readOwn(bearer(owner.plain));

    for (const response of [publicResponse, writeResponse]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toStrictEqual({
        error: {
          code: 'insufficient_scope',
          message: 'このAPIキーにはこの操作の権限がありません。',
        },
      });
      expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
      expect(response.headers.get('WWW-Authenticate')).toBeNull();
    }
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('X-RateLimit-Remaining')).toBe('29');
  });

  test('停止中の持ち主のキーは公開データの経路で200、自分のデータの経路で403になり、停止の解除の後は自分のデータの経路も200になる', async () => {
    const owner = await freshOwner(SUSPENDED_COLUMNS);

    const publicResponse = await readPublic(bearer(owner.plain));
    const ownRead = await readOwn(bearer(owner.plain));
    const ownWrite = await writeOwn(bearer(owner.plain));

    expect(publicResponse.status).toBe(200);
    for (const response of [ownRead, ownWrite]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toStrictEqual({
        error: {
          code: 'account_unavailable',
          message:
            'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
        },
      });
    }

    await db
      .update(users)
      .set({ status: 'active', suspendedAt: null })
      .where(eq(users.id, userIdOf(owner.userIndex)));
    const reactivatedRead = await readOwn(bearer(owner.plain));
    const reactivatedWrite = await writeOwn(bearer(owner.plain));

    expect(reactivatedRead.status).toBe(200);
    expect(reactivatedRead.headers.get('X-RateLimit-Remaining')).toBe('28');
    expect(reactivatedWrite.status).toBe(200);
    expect(reactivatedWrite.headers.get('X-RateLimit-Remaining')).toBe('14');
  });
});

describe('apiKeyAuth: 利用者単位の回数の制限', () => {
  test('読み取りは30回目まで処理し、31回目を429とRetry-After・上限・残り・リセットの時刻で返す', async () => {
    const owner = await freshOwner();

    const responses = await repeat(31, () => readPublic(bearer(owner.plain)));
    const thirtieth = responses[29];
    const rejected = responses[30];

    expect(responses.slice(0, 30).map(({ status }) => status)).toStrictEqual(
      Array.from({ length: 30 }, () => 200),
    );
    expect(thirtieth?.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(rejected?.status).toBe(429);
    expect(await rejected?.json()).toStrictEqual({
      error: {
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。しばらく待ってから再度お試しください。',
      },
    });
    expect(
      rejected === undefined ? {} : rateLimitHeadersOf(rejected),
    ).toStrictEqual({
      'X-RateLimit-Limit': '30',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': thirtieth?.headers.get('X-RateLimit-Reset'),
    });
    const retryAfter = Number(rejected?.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(rejected?.headers.get('Cache-Control')).toBe('no-store');
    expect(rejected?.headers.get('Access-Control-Expose-Headers')).toBeNull();
  });

  test('書き込みは読み取りと別に数え、15回目まで処理し16回目を429で返す', async () => {
    const owner = await freshOwner();
    await readOwn(bearer(owner.plain));

    const responses = await repeat(16, () => writeOwn(bearer(owner.plain)));
    const fifteenth = responses[14];
    const rejected = responses[15];

    expect(responses.slice(0, 15).map(({ status }) => status)).toStrictEqual(
      Array.from({ length: 15 }, () => 200),
    );
    expect(responses[0]?.headers.get('X-RateLimit-Limit')).toBe('15');
    expect(responses[0]?.headers.get('X-RateLimit-Remaining')).toBe('14');
    expect(fifteenth?.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(rejected?.status).toBe(429);
    expect(await errorCodeOf(rejected ?? new Response())).toBe(
      'rate_limit_exceeded',
    );
    expect(
      rejected === undefined ? {} : rateLimitHeadersOf(rejected),
    ).toStrictEqual({
      'X-RateLimit-Limit': '15',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': fifteenth?.headers.get('X-RateLimit-Reset'),
    });
    expect(Number(rejected?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(
      1,
    );
  });

  test('同じ持ち主の全てのキーの要求を合わせて数える', async () => {
    const owner = await freshOwner();
    const secondPlain = plainKeyOf(owner.keyIndex + 5000);
    await insertApiKey(owner.keyIndex + 5000, owner.userIndex, {
      keyHash: await hasher.hash(API_KEY_HASH_PURPOSE, secondPlain),
    });

    await readPublic(bearer(owner.plain));
    const second = await readPublic(bearer(secondPlain));

    expect(second.status).toBe(200);
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('28');
  });

  test('期間の最初の要求から1分が経つと、読み取りと書き込みの回数をリセットする', async () => {
    const owner = await freshOwner();
    await repeat(31, () => readPublic(bearer(owner.plain)));
    await repeat(16, () => writeOwn(bearer(owner.plain)));

    await elapseWindow(owner.userIndex, PUBLIC_API_READ_RULE.name);
    await elapseWindow(owner.userIndex, PUBLIC_API_WRITE_RULE.name);
    const read = await readPublic(bearer(owner.plain));
    const write = await writeOwn(bearer(owner.plain));

    expect(read.status).toBe(200);
    expect(read.headers.get('X-RateLimit-Remaining')).toBe('29');
    expect(write.status).toBe(200);
    expect(write.headers.get('X-RateLimit-Remaining')).toBe('14');
  });
});

describe('apiKeyAuth: ログ', () => {
  test('拒否を拒否の種類・キーのID・利用者のID・経路のパターン・状態コードだけで記録し、Authorizationと平文を記録しない', async () => {
    const owner = await freshOwner(
      { emailVerifiedAt: T0 },
      { scopeProducts: 'none' },
    );
    const limited = await freshOwner();
    await readPublic();
    await readPublic(bearer(plainKeyOf(9999)));
    await readPublic(bearer(owner.plain));
    await repeat(31, () => readOwn(bearer(limited.plain)));

    expect(
      rejectionLogs().map((log) => ({
        level: log.level,
        ...attributesOf(log),
      })),
    ).toStrictEqual([
      {
        level: 'info',
        reason: 'unauthenticated',
        route: '/v1/test/products/:id',
        status: 401,
      },
      {
        level: 'info',
        reason: 'invalid_api_key',
        route: '/v1/test/products/:id',
        status: 401,
      },
      {
        level: 'info',
        reason: 'insufficient_scope',
        recordId: apiKeyIdOf(owner.keyIndex),
        userId: userIdOf(owner.userIndex),
        route: '/v1/test/products/:id',
        status: 403,
      },
      {
        level: 'info',
        reason: 'rate_limit_exceeded',
        recordId: apiKeyIdOf(limited.keyIndex),
        userId: userIdOf(limited.userIndex),
        route: '/v1/test/me/profile',
        status: 429,
      },
    ]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(owner.plain);
    expect(logged).not.toContain(limited.plain);
    expect(logged).not.toContain(plainKeyOf(9999));
    expect(logged.toLowerCase()).not.toContain('bearer');
    expect(logged.toLowerCase()).not.toContain('authorization');
  });
});

describe('definePublicApiRoute: 仕様書', () => {
  interface OperationObject {
    readonly description?: string;
    readonly security?: unknown;
    readonly responses: Record<string, unknown>;
  }

  async function operationsOf(): Promise<
    Record<string, Record<string, OperationObject>>
  > {
    const response = await invoke('GET', '/openapi.json');
    expect(response.status).toBe(200);
    const document: {
      paths: Record<string, Record<string, OperationObject>>;
    } = await response.json();
    return document.paths;
  }

  test('経路の説明の末尾に必要な機能と操作を記載し、Bearerの認証方式と401・403・429の応答を載せる', async () => {
    const paths = await operationsOf();

    expect(paths[PUBLIC_PATH]?.get?.description).toBe(
      'テスト用のプロダクトを返す。\n\n必要な権限: プロダクトの読み取り',
    );
    expect(paths[OWN_PATH]?.get?.description).toBe(
      '必要な権限: プロフィールの読み取り',
    );
    expect(paths[OWN_PATH]?.put?.description).toBe(
      '必要な権限: プロフィールの読み書き',
    );
    for (const operation of [
      paths[PUBLIC_PATH]?.get,
      paths[OWN_PATH]?.get,
      paths[OWN_PATH]?.put,
    ]) {
      expect(operation?.security).toStrictEqual([{ ApiKeyAuth: [] }]);
      expect(Object.keys(operation?.responses ?? {}).sort()).toStrictEqual([
        '200',
        '401',
        '403',
        '429',
      ]);
    }
  });

  test('経路の宣言の機能・操作・対象を仕様書の経路の項目に出さない', async () => {
    const paths = await operationsOf();
    const operation = paths[PUBLIC_PATH]?.get ?? {};

    expect(Object.keys(operation)).not.toContain('feature');
    expect(Object.keys(operation)).not.toContain('access');
    expect(Object.keys(operation)).not.toContain('target');
    expect(Object.keys(operation)).not.toContain('middleware');
  });
});

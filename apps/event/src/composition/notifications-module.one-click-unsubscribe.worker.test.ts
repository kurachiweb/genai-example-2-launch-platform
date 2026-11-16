import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';

import type { NotificationTopic } from '../../common-lib/notifications/notification-topics.ts';
import { notificationPreferences } from '../../db/schema/notifications/notification-preferences.ts';
import { notificationUnsubscribeTokens } from '../../db/schema/notifications/notification-unsubscribe-tokens.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type { UnsubscribeTokenService } from '../../lib/core/notifications/ports.ts';
import { SECURITY_HEADERS } from '../../lib/workers/http/security-headers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  recipientIdOf,
  T0,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { MODULES } from './modules.ts';
import { consumeIpRateLimit } from './testing/ip-rate-limit-quota.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const EVENT_ORIGIN = 'https://event.test.example';

const RECIPIENT = 1;

// 形式は正しいが、どの種からも導出していないトークン
const UNKNOWN_TOKEN = `${'0123456789abcdef'.repeat(5)}01234Q`;

const INVALID_BODY = 'このリンクは無効です。';

const UNSUBSCRIBED_BODY = '配信を停止しました。';

const IP_LIMIT = 500;
const PERIOD_MILLISECONDS = 10_000;
const BURST_MARGIN_MILLISECONDS = 4_000;
const BURST_TEST_TIMEOUT_MILLISECONDS = 30_000;

// 上限までの残りの1回を超えて送る回数。IP制限で数える要求なら2回目が上限を超える
const REQUESTS_BEYOND_REMAINING = 2;

const CONSOLE_METHODS = ['log', 'debug', 'info', 'warn', 'error'] as const;

interface LoggedObject {
  readonly category?: string;
  readonly [property: string]: unknown;
}

// IP単位の制限の計数を他のテストと分けるため、テストごとに接続元を変える
let nextIp = 1;
function freshIp(): string {
  nextIp += 1;
  return `203.0.113.${String(100 + nextIp)}`;
}

// Miniflareのバインディングは壁時計にそろえた10秒の期間で数えるため、連続した要求が期間の切り替わりをまたがないように待つ
async function waitForFreshWindow(): Promise<void> {
  const remaining = PERIOD_MILLISECONDS - (Date.now() % PERIOD_MILLISECONDS);
  if (remaining < BURST_MARGIN_MILLISECONDS) {
    await scheduler.wait(remaining + 100);
  }
}

function tokenService(): UnsubscribeTokenService {
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
  ).get<UnsubscribeTokenService>(
    NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
  );
}

async function issueToken(topic: NotificationTopic): Promise<string> {
  const userId = recipientIdOf(RECIPIENT);
  const tokens = await tokenService().tokensFor([{ userId, topic }], T0);
  const token = tokens.get(`${userId}:${topic}`);
  if (token === undefined) {
    throw new Error('配信停止のトークンを発行できなかった');
  }
  return token;
}

async function enable(topics: readonly NotificationTopic[]): Promise<void> {
  await db.insert(notificationPreferences).values(
    topics.map((topic) => ({
      userId: recipientIdOf(RECIPIENT),
      topic,
      enabled: true,
      createdAt: T0,
      updatedAt: T0,
    })),
  );
}

async function preferenceRows() {
  return db
    .select({
      topic: notificationPreferences.topic,
      enabled: notificationPreferences.enabled,
      updatedAt: notificationPreferences.updatedAt,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, recipientIdOf(RECIPIENT)))
    .orderBy(asc(notificationPreferences.topic));
}

function unsubscribeUrl(token: string | undefined): string {
  const url = new URL('/unsubscribe', EVENT_ORIGIN);
  if (token !== undefined) {
    url.search = new URLSearchParams({ token }).toString();
  }
  return url.href;
}

// RFC 8058のメールソフトが送る形の要求で、Cookieや認証のヘッダーを持たない
function postOneClick(
  token: string | undefined,
  ip: string = freshIp(),
): Promise<Response> {
  return exports.default.fetch(unsubscribeUrl(token), {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': ip,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'List-Unsubscribe=One-Click',
  });
}

function getOneClick(token: string | undefined): Promise<Response> {
  return exports.default.fetch(unsubscribeUrl(token), {
    headers: { 'CF-Connecting-IP': freshIp() },
    redirect: 'manual',
  });
}

async function expectPlainText(
  response: Response,
  status: number,
  body: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/u);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).toBe(body);
}

function loggedObjects(spies: readonly MockInstance[]): LoggedObject[] {
  return spies.flatMap((spy) =>
    spy.mock.calls.map(([object]) => object as LoggedObject),
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearNotificationTables();
  await insertRecipient(RECIPIENT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('POST /unsubscribe(ワンクリックの配信停止)', () => {
  test('ログインを求めずに、トークンの組の種別だけの受信を停止して200を返す', async () => {
    await enable(['match_result', 'match_preview']);
    const token = await issueToken('match_result');

    const response = await postOneClick(token);

    await expectPlainText(response, 200, UNSUBSCRIBED_BODY);
    const rows = await preferenceRows();
    expect(
      rows.map(({ topic, enabled }) => ({ topic, enabled })),
    ).toStrictEqual([
      { topic: 'match_preview', enabled: true },
      { topic: 'match_result', enabled: false },
    ]);
    expect(
      rows.find(({ topic }) => topic === 'match_result')?.updatedAt.getTime(),
    ).toBeGreaterThan(T0.getTime());
  });

  test('同じ要求の繰り返しは受信設定を変えずに200を返す', async () => {
    await enable(['match_result']);
    const token = await issueToken('match_result');
    await (await postOneClick(token)).body?.cancel();
    const afterFirst = await preferenceRows();

    const second = await postOneClick(token);

    await expectPlainText(second, 200, UNSUBSCRIBED_BODY);
    expect(await preferenceRows()).toStrictEqual(afterFirst);
  });

  test('受信しない設定のままの種別でも、行を作らずに200を返す', async () => {
    const token = await issueToken('followed_user_award');

    const response = await postOneClick(token);

    await expectPlainText(response, 200, UNSUBSCRIBED_BODY);
    expect(await preferenceRows()).toStrictEqual([]);
  });

  test.each([
    { name: 'トークンが無い', token: undefined },
    { name: '空のトークン', token: '' },
    { name: '86文字に満たないトークン', token: 'short-token' },
    { name: '使えない文字を含むトークン', token: `${'a'.repeat(85)}=` },
  ])('$nameは受信設定を変えずに400を返す', async ({ token }) => {
    await enable(['match_result']);

    const response = await postOneClick(token);

    await expectPlainText(response, 400, INVALID_BODY);
    expect(await preferenceRows()).toMatchObject([
      { topic: 'match_result', enabled: true },
    ]);
  });

  test('形式は正しいが照合できないトークンは受信設定を変えずに404を返す', async () => {
    await enable(['match_result']);

    const response = await postOneClick(UNKNOWN_TOKEN);

    await expectPlainText(response, 404, INVALID_BODY);
    expect(await preferenceRows()).toMatchObject([
      { topic: 'match_result', enabled: true },
    ]);
  });

  test('退会で種が消えたトークンは404を返す', async () => {
    const token = await issueToken('match_result');
    await db
      .delete(notificationUnsubscribeTokens)
      .where(
        eq(notificationUnsubscribeTokens.userId, recipientIdOf(RECIPIENT)),
      );

    const response = await postOneClick(token);

    await expectPlainText(response, 404, INVALID_BODY);
  });

  test(
    '同じIPからの501回目もIP制限で429にならず、他の経路の回数にも数えられない',
    async () => {
      await waitForFreshWindow();
      const ip = freshIp();
      await consumeIpRateLimit(ip, IP_LIMIT - 1);
      const statuses: number[] = [];
      for (let index = 0; index < REQUESTS_BEYOND_REMAINING; index += 1) {
        const response = await postOneClick('malformed', ip);
        statuses.push(response.status);
        await response.body?.cancel();
      }

      const health = await exports.default.fetch(`${EVENT_ORIGIN}/health`, {
        headers: { 'CF-Connecting-IP': ip },
      });

      expect(statuses.every((status) => status === 400)).toBe(true);
      expect(health.status).toBe(200);
      await health.body?.cancel();
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );
});

describe('GET /unsubscribe', () => {
  test('受信を変えずに、トークンをフラグメントに載せた配信停止ページへ303で移す', async () => {
    await enable(['match_result']);
    const token = await issueToken('match_result');

    const response = await getOneClick(token);

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(
      `${env.CLIENT_SITE_ORIGIN}/unsubscribe#token=${token}`,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(await preferenceRows()).toMatchObject([
      { topic: 'match_result', enabled: true },
    ]);
  });

  test.each([
    { name: 'トークンが無い', token: undefined },
    { name: '形式違反のトークン', token: 'short-token' },
  ])(
    '$nameときは、トークンを載せない配信停止ページへ303で移す',
    async ({ token }) => {
      const response = await getOneClick(token);

      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe(
        `${env.CLIENT_SITE_ORIGIN}/unsubscribe`,
      );
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      await response.body?.cancel();
    },
  );
});

describe('ワンクリックの配信停止の応答の全体', () => {
  test('Worker全体を通した応答のReferrer-Policyは、全体のセキュリティヘッダーのsame-originである', async () => {
    await enable(['match_result']);
    const token = await issueToken('match_result');

    const responses = [
      await postOneClick(token),
      await postOneClick('malformed'),
      await postOneClick(UNKNOWN_TOKEN),
      await getOneClick(token),
    ];

    for (const response of responses) {
      expect(response.headers.get('Referrer-Policy')).toBe(
        SECURITY_HEADERS['Referrer-Policy'],
      );
      expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
      await response.body?.cancel();
    }
  });

  test('アクセスログにトークンが残らず、パスだけが記録される', async () => {
    const spies = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    await enable(['match_result']);
    const token = await issueToken('match_result');

    for (const response of [
      await postOneClick(token),
      await postOneClick(UNKNOWN_TOKEN),
      await getOneClick(token),
    ]) {
      await response.body?.cancel();
    }

    const accessLogs = loggedObjects(spies).filter(
      ({ category }) => category === 'event.http.access',
    );
    expect(accessLogs).toHaveLength(3);
    for (const log of accessLogs) {
      expect(log['path']).toBe('/unsubscribe');
    }
    const outputs = JSON.stringify(spies.map((spy) => spy.mock.calls));
    expect(outputs).not.toContain(token);
    expect(outputs).not.toContain(UNKNOWN_TOKEN);
  });
});

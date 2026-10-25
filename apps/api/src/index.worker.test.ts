import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

import { createKeyedHasher } from '../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../lib/core/di/identifiers.ts';
import { hashRateLimitKey } from '../lib/core/rate-limit/rate-limit-key.ts';
import type { BotVerifier } from '../lib/workers/bot-protection/turnstile-verifier.ts';
import { createInvocationContainer } from '../lib/workers/di/invocation-container.ts';
import type { RateLimitCounterClient } from '../lib/workers/rate-limit/rate-limit-counter-client.ts';
import { MODULES } from './composition/modules.ts';
import worker from './index.ts';

const API_ORIGIN = 'https://genai-example-2-api.example';
const SITEVERIFY_HOSTNAME = 'client.launch.example';
const TOKEN = ['turnstile', 'response', 'composition', '0001'].join('-');

interface SiteverifyRequestBody {
  readonly secret?: unknown;
  readonly response?: unknown;
  readonly remoteip?: unknown;
}

function createContainer(scopeEnv: Env) {
  return createInvocationContainer(
    {
      env: scopeEnv,
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

function withExpectedHostnames(hostnames: string): Env {
  return { ...env, TURNSTILE_EXPECTED_HOSTNAMES: hostnames } as Env;
}

function stubSiteverify(hostname: string): SiteverifyRequestBody[] {
  const bodies: SiteverifyRequestBody[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    bodies.push(
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as SiteverifyRequestBody)
        : {},
    );
    return Promise.resolve(
      Response.json({
        success: true,
        hostname,
        challenge_ts: '2026-10-25T03:04:05.678Z',
        'error-codes': [],
      }),
    );
  });
  return bodies;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのエントリ', () => {
  test('ヘルスチェックが外部からの経路として200とキャッシュの禁止を返す', async () => {
    const response = await exports.default.fetch(`${API_ORIGIN}/health`, {
      headers: { 'CF-Connecting-IP': '203.0.113.71' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('未登録の経路は共通のエラー形式の404になる', async () => {
    const response = await exports.default.fetch(
      `${API_ORIGIN}/unregistered-route`,
      { headers: { 'CF-Connecting-IP': '203.0.113.72' } },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_found' },
    });
  });

  test('ジョブの無い時刻の定期実行が失敗せずに終わる', async () => {
    const scheduled = worker.scheduled;
    if (scheduled === undefined) {
      throw new Error('定期実行のハンドラーがエクスポートされていません');
    }
    const ctx = createExecutionContext();

    await expect(
      scheduled(
        createScheduledController({
          cron: '21 12 * * *',
          scheduledTime: Date.UTC(2026, 9, 25, 12, 21),
        }),
        env,
        ctx,
      ),
    ).resolves.toBeUndefined();
    await waitOnExecutionContext(ctx);
  });
});

describe('APIサーバーの基盤モジュール', () => {
  test('コンテナから厳密カウンタのクライアントを取得し、Durable Objectで回数を数えられる', async () => {
    const client = createContainer(env).get<RateLimitCounterClient>(
      PLATFORM_TYPES.RateLimitCounterClient,
    );
    const rule = { name: 'composition-test', limit: 2, windowSeconds: 60 };
    const key = await hashRateLimitKey(
      createKeyedHasher(env.HASH_PEPPER),
      'composition',
      crypto.randomUUID(),
    );

    const decisions = [
      await client.hit(rule, key),
      await client.hit(rule, key),
      await client.hit(rule, key),
    ];

    expect(decisions.map(({ allowed, count }) => ({ allowed, count }))).toEqual(
      [
        { allowed: true, count: 1 },
        { allowed: true, count: 2 },
        { allowed: false, count: 2 },
      ],
    );
    await client.reset(rule, key);
  });

  test('処理単位の中では同じbot判定の検証と厳密カウンタのクライアントを使う', () => {
    const container = createContainer(env);

    expect(container.get(PLATFORM_TYPES.BotVerifier)).toBe(
      container.get(PLATFORM_TYPES.BotVerifier),
    );
    expect(container.get(PLATFORM_TYPES.RateLimitCounterClient)).toBe(
      container.get(PLATFORM_TYPES.RateLimitCounterClient),
    );
  });

  test('コンテナから取得したbot判定の検証が、環境のシークレットを判定サービスへ送る', async () => {
    const bodies = stubSiteverify(SITEVERIFY_HOSTNAME);
    const verifier = createContainer(env).get<BotVerifier>(
      PLATFORM_TYPES.BotVerifier,
    );

    const result = await verifier.verify({
      token: TOKEN,
      remoteIp: '203.0.113.73',
    });

    expect(result.ok).toBe(true);
    expect(bodies).toEqual([
      {
        secret: env.TURNSTILE_SECRET_KEY,
        response: TOKEN,
        remoteip: '203.0.113.73',
      },
    ]);
  });

  test('トークンが無ければ判定サービスへ通信せずに失敗する', async () => {
    const bodies = stubSiteverify(SITEVERIFY_HOSTNAME);
    const verifier = createContainer(env).get<BotVerifier>(
      PLATFORM_TYPES.BotVerifier,
    );

    const result = await verifier.verify({
      token: undefined,
      remoteIp: undefined,
    });

    expect(result).toEqual({
      ok: false,
      failure: 'missing-token',
      errorCodes: [],
    });
    expect(bodies).toEqual([]);
  });

  test('期待するホスト名をカンマで分け、空白と空の項目を除いて照合する', async () => {
    const verifier = createContainer(
      withExpectedHostnames(' Client.Launch.example , ,admin.launch.example,'),
    ).get<BotVerifier>(PLATFORM_TYPES.BotVerifier);

    stubSiteverify(SITEVERIFY_HOSTNAME);
    const matched = await verifier.verify({
      token: TOKEN,
      remoteIp: undefined,
    });
    vi.restoreAllMocks();
    stubSiteverify('other.launch.example');
    const mismatched = await verifier.verify({
      token: TOKEN,
      remoteIp: undefined,
    });

    expect(matched.ok).toBe(true);
    expect(mismatched).toMatchObject({
      ok: false,
      failure: 'hostname-mismatch',
    });
  });

  test('期待するホスト名が空なら、ホスト名を照合しない', async () => {
    stubSiteverify('any.launch.example');
    const verifier = createContainer(
      withExpectedHostnames(''),
    ).get<BotVerifier>(PLATFORM_TYPES.BotVerifier);

    const result = await verifier.verify({ token: TOKEN, remoteIp: undefined });

    expect(result.ok).toBe(true);
  });
});

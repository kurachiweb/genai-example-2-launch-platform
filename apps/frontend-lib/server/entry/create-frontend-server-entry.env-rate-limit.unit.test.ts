import { afterEach, describe, expect, test } from 'bun:test';

import { createHmac } from 'node:crypto';

import { resetSync } from '@logtape/logtape';

import {
  createHarness,
  errorBodyOf,
  expectSecurityHeaders,
  HASH_PEPPER,
  logsOf,
  pageRequest,
  sameOriginPost,
} from '../../test/server-entry-fixtures.ts';
import { NON_PAGE_CONTENT_SECURITY_POLICY } from '../http/security-policy.ts';

const CLIENT_IP = '203.0.113.5';

const ENV_KEYS = [
  'API',
  'APP_ENVIRONMENT',
  'HASH_PEPPER',
  'IMAGES_ORIGIN',
  'IP_RATE_LIMITER',
  'LOG_LEVEL',
  'SENTRY_ENVIRONMENT',
  'SENTRY_TRACES_SAMPLE_RATE',
  'TURNSTILE_SITE_KEY',
];

afterEach(() => {
  resetSync();
});

describe('createFrontendServerEntry(環境の不備)', () => {
  test('欠けた・不正なキーの名前だけを[caller, env]のerrorログに出し、500の静的なエラー画面を返して送信する', async () => {
    const harness = createHarness({
      env: { APP_ENVIRONMENT: 'production', TURNSTILE_SITE_KEY: undefined },
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(await response.text()).toContain('ページを表示できませんでした');
    expectSecurityHeaders(response);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      NON_PAGE_CONTENT_SECURITY_POLICY,
    );
    const [logged, ...rest] = logsOf(harness, 'client.env');
    expect(rest).toEqual([]);
    expect(logged?.level).toBe('error');
    expect(logged?.invalidEnvNames).toEqual([
      'APP_ENVIRONMENT',
      'TURNSTILE_SITE_KEY',
    ]);
    expect(JSON.stringify(harness.logs())).not.toContain('production');
    expect(harness.reported).toHaveLength(1);
    expect(harness.limiter.keys).toEqual([]);
    expect(harness.startCalls).toEqual([]);
    expect(harness.api.calls).toEqual([]);
  });

  test('環境がオブジェクトでなければ必要なキーをすべて名前で出す', async () => {
    const harness = createHarness({ rawEnv: undefined });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(500);
    expect(logsOf(harness, 'client.env')[0]?.invalidEnvNames).toEqual(ENV_KEYS);
  });

  test.each([undefined, ''])(
    'ペッパーが%pの環境では、IP制限を呼ばずにキーの名前だけを出して500にする',
    async (hashPepper) => {
      const harness = createHarness({ env: { HASH_PEPPER: hashPepper } });

      const response = await harness.fetch(pageRequest());

      expect(response.status).toBe(500);
      expect(logsOf(harness, 'client.env')[0]?.invalidEnvNames).toEqual([
        'HASH_PEPPER',
      ]);
      expect(harness.limiter.keys).toEqual([]);
      expect(harness.startCalls).toEqual([]);
    },
  );

  test('環境の検証を通っても許可先として使えない値は、そのキーの名前だけを出して500にする', async () => {
    const harness = createHarness({
      env: { IMAGES_ORIGIN: 'https://images.example:8443' },
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(500);
    const [logged] = logsOf(harness, 'client.env');
    expect(logged?.invalidEnvNames).toEqual(['IMAGES_ORIGIN']);
    expect(JSON.stringify(harness.logs())).not.toContain('8443');
    expect(harness.reported).toHaveLength(1);
    expect(harness.limiter.keys).toEqual([]);
    expect(harness.startCalls).toEqual([]);
  });

  test('送信する例外のメッセージには値を含めずキーの名前だけを入れる', async () => {
    const harness = createHarness({
      env: { SENTRY_TRACES_SAMPLE_RATE: '7.5' },
    });

    await harness.fetch(pageRequest());

    const [reported] = harness.reported;
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toContain('SENTRY_TRACES_SAMPLE_RATE');
    expect((reported as Error).message).not.toContain('7.5');
  });
});

describe('createFrontendServerEntry(IP制限)', () => {
  test('接続元のIPアドレスのキーを検証済みの環境のペッパーでハッシュ化して判定し、IPアドレスをバインディングへ渡さない', async () => {
    const harness = createHarness();

    await harness.fetch(pageRequest());

    expect(harness.limiter.keys).toEqual([
      createHmac('sha512', HASH_PEPPER)
        .update(`rate-limit-key\u0000${JSON.stringify([`ip:${CLIENT_IP}`])}`)
        .digest('base64url'),
    ]);
    expect(harness.limiter.keys.join()).not.toContain(CLIENT_IP);
  });

  test('ページの要求の超過は429の静的なエラー画面とRetry-After: 10で返し、描画を呼ばない', async () => {
    const harness = createHarness({ limited: true });

    const response = await harness.fetch(pageRequest('/launches?page=2'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(await response.text()).toContain('操作が集中しています');
    expectSecurityHeaders(response);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}=='/u);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(harness.startCalls).toEqual([]);
    const [warning, ...rest] = logsOf(harness, 'client.http.rate-limit');
    expect(rest).toEqual([]);
    expect(warning?.level).toBe('warning');
    expect(warning?.path).toBe('/launches');
    const serializedLogs = JSON.stringify(harness.logs());
    expect(serializedLogs).not.toContain(CLIENT_IP);
    expect(serializedLogs).not.toContain(HASH_PEPPER);
    expect(harness.reported).toEqual([]);
  });

  test('ページ以外の要求の超過は429の共通のエラー形式で返し、CSRFの検証も中継もしない', async () => {
    const harness = createHarness({ limited: true });

    const response = await harness.fetch(
      sameOriginPost('/_bff/graphql', { 'Sec-Fetch-Site': 'cross-site' }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(await errorBodyOf(response)).toBe('rate_limit_exceeded');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      NON_PAGE_CONTENT_SECURITY_POLICY,
    );
    expectSecurityHeaders(response);
    expect(logsOf(harness, 'client.http.csrf')).toEqual([]);
    expect(harness.api.calls).toEqual([]);
    expect(harness.startCalls).toEqual([]);
    expect(harness.reported).toEqual([]);
  });

  test('判定の例外では要求を通し、[caller, http, rate-limit]へ警告を出す', async () => {
    const harness = createHarness({
      env: {
        IP_RATE_LIMITER: {
          limit: () => Promise.reject(new Error('binding failure')),
        },
      },
    });

    const response = await harness.fetch(pageRequest());

    expect(response.status).toBe(200);
    expect(logsOf(harness, 'client.http.rate-limit')[0]?.level).toBe('warning');
  });
});

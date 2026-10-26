import { describe, expect, test } from 'bun:test';

import {
  APP_ENVIRONMENTS,
  type AppEnvironment,
  CALLER_KINDS,
  GATEWAY_HEADERS,
  isDeployedEnvironment,
  SESSION_RESPONSE_HEADERS,
} from './gateway-headers.ts';

describe('isDeployedEnvironment', () => {
  test.each([
    ['local', false],
    ['staging', true],
    ['prod', true],
  ] as const satisfies readonly (readonly [AppEnvironment, boolean])[])(
    '%sをデプロイ先と判定するかは%pになる',
    (environment, expected) => {
      expect(isDeployedEnvironment(environment)).toBe(expected);
    },
  );
});

describe('内部経路の契約', () => {
  test('呼び出し元の種類は利用者側と管理者側の2つで、実行時に書き換えられない', () => {
    expect(CALLER_KINDS).toEqual(['client', 'admin']);
    expect(Object.isFrozen(CALLER_KINDS)).toBe(true);
  });

  test('環境の種別はローカル・ステージング・本番の3つで、実行時に書き換えられない', () => {
    expect(APP_ENVIRONMENTS).toEqual(['local', 'staging', 'prod']);
    expect(Object.isFrozen(APP_ENVIRONMENTS)).toBe(true);
  });

  test('中継ヘッダーの名前はフロントエンドサーバーとの契約の値で、実行時に書き換えられない', () => {
    expect(GATEWAY_HEADERS).toEqual({
      caller: 'x-internal-caller',
      clientIp: 'x-original-client-ip',
      sessionToken: 'x-session-token',
      botToken: 'cf-turnstile-response',
      debugCaller: 'x-debug-caller',
    });
    expect(Object.isFrozen(GATEWAY_HEADERS)).toBe(true);
  });

  test('セッションの指示ヘッダーの名前はフロントエンドサーバーとの契約の値で、実行時に書き換えられない', () => {
    expect(SESSION_RESPONSE_HEADERS).toEqual({
      issue: 'x-session-issue',
      maxAge: 'x-session-max-age',
      clear: 'x-session-clear',
    });
    expect(Object.isFrozen(SESSION_RESPONSE_HEADERS)).toBe(true);
  });
});

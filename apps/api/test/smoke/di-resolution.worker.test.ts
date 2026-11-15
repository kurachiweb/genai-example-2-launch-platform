import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  createKeyedHasher,
  hashPurpose,
  type KeyedHasher,
} from '../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { Greeting, greetingModule, SMOKE_TYPES } from './fixtures/greeting.ts';

describe('Vitest(Oxc)の変換経路でのDIの解決', () => {
  test('処理単位のコンテナから@inject付きのクラスと基盤の依存をworkerd上で解決する', async () => {
    const container = createInvocationContainer(
      {
        env,
        executionCtx: createExecutionContext(),
        info: {
          kind: 'fetch',
          correlationId: 'correlation-di-smoke',
          clientIp: undefined,
        },
      },
      [{ bindings: greetingModule }],
    );
    const purpose = hashPurpose('test.di-smoke');

    const greeting = container.get<Greeting>(SMOKE_TYPES.Greeting);
    const keyedHasher = container.get<KeyedHasher>(PLATFORM_TYPES.KeyedHasher);

    expect(greeting).toBeInstanceOf(Greeting);
    expect(greeting.message()).toBe('こんにちは、Inversify');
    expect(await keyedHasher.hash(purpose, 'value')).toBe(
      await createKeyedHasher(env.HASH_PEPPER).hash(purpose, 'value'),
    );
  });
});

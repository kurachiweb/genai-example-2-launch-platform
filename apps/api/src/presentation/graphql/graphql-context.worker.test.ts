import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type Container, ContainerModule } from 'inversify';
import { describe, expect, test } from 'vitest';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { createInvocationContainer } from '../../../lib/workers/di/invocation-container.ts';
import {
  BOT_VERIFICATION_FAILED_MESSAGE,
  type BotVerificationInput,
  type BotVerifier,
  createTurnstileVerifier,
  type HttpFetch,
} from '../../../lib/workers/bot-protection/turnstile-verifier.ts';
import type { CallerKind } from '../gateway/gateway-headers.ts';
import { createSessionAccess } from '../gateway/session-access.ts';
import {
  createGraphQLContext,
  type GraphQLContext,
  type GraphQLContextScope,
} from './graphql-context.ts';
import { defineLoader } from './loaders.ts';

interface Greeting {
  readonly prefix: string;
}

interface FakeVerifier {
  readonly verifier: BotVerifier;
  readonly inputs: BotVerificationInput[];
}

interface SentSiteverifyBody {
  readonly response?: string;
  readonly remoteip?: string;
}

const GREETING = Symbol.for('test.graphql-context.Greeting');

const BOT_TOKEN = ['turnstile', 'response', 'context', '0003'].join('-');
const CLIENT_IP = '198.51.100.43';
const CORRELATION_ID = 'correlation-graphql-context';
const HOSTNAME = 'client.launch.example';

const REJECTION = new AppError({
  kind: 'forbidden',
  code: 'bot_verification_failed',
  message: BOT_VERIFICATION_FAILED_MESSAGE,
});

function createFakeVerifier(outcome: 'pass' | 'reject'): FakeVerifier {
  const inputs: BotVerificationInput[] = [];
  const verifier: BotVerifier = {
    verify() {
      return Promise.reject(new Error('assertHumanだけを呼ぶ想定です'));
    },
    assertHuman(input) {
      inputs.push(input);
      return outcome === 'pass' ? Promise.resolve() : Promise.reject(REJECTION);
    },
  };
  return { verifier, inputs };
}

function createContainer(
  options: { prefix?: string; verifier?: BotVerifier } = {},
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: CORRELATION_ID,
        clientIp: CLIENT_IP,
      },
    },
    [
      {
        bindings: new ContainerModule(({ bind }) => {
          bind<Greeting>(GREETING).toConstantValue({
            prefix: options.prefix ?? 'scope',
          });
          if (options.verifier !== undefined) {
            bind<BotVerifier>(PLATFORM_TYPES.BotVerifier).toConstantValue(
              options.verifier,
            );
          }
        }),
      },
    ],
  );
}

function createScope(
  options: {
    caller?: CallerKind;
    clientIp?: string | undefined;
    botToken?: string | undefined;
    container?: Container;
  } = {},
): GraphQLContextScope {
  const container = options.container ?? createContainer();
  const caller = options.caller ?? 'client';
  return {
    access: { caller },
    container,
    correlationId: CORRELATION_ID,
    clientIp: 'clientIp' in options ? options.clientIp : CLIENT_IP,
    session: createSessionAccess({ container, caller, token: undefined }),
    botToken: 'botToken' in options ? options.botToken : BOT_TOKEN,
  };
}

function contextWithVerifier(
  verifier: BotVerifier,
  options: {
    clientIp?: string | undefined;
    botToken?: string | undefined;
  } = {},
): GraphQLContext {
  return createGraphQLContext(
    createScope({ ...options, container: createContainer({ verifier }) }),
  );
}

function createSiteverify(body: unknown): {
  readonly fetch: HttpFetch;
  readonly sent: SentSiteverifyBody[];
} {
  const sent: SentSiteverifyBody[] = [];
  const fakeFetch: HttpFetch = (_, init) => {
    if (typeof init?.body === 'string') {
      sent.push(JSON.parse(init.body) as SentSiteverifyBody);
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { fetch: fakeFetch, sent };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗するはずの処理が成功しました');
}

describe('createGraphQLContext', () => {
  test('処理単位の呼び出し元・相関ID・クライアントIP・セッションの参照を持つ', () => {
    const scope = createScope({ caller: 'admin' });

    const context = createGraphQLContext(scope);

    expect(context.caller).toBe('admin');
    expect(context.correlationId).toBe(CORRELATION_ID);
    expect(context.clientIp).toBe(CLIENT_IP);
    expect(context.session).toBe(scope.session);
  });

  test('クライアントIPが不明な処理単位では不明のまま渡す', () => {
    const context = createGraphQLContext(createScope({ clientIp: undefined }));

    expect(context.clientIp).toBeUndefined();
  });

  test('処理単位のコンテナから依存を取得できる', () => {
    const context = createGraphQLContext(
      createScope({ container: createContainer({ prefix: 'resolved' }) }),
    );

    expect(context.resolve<Greeting>(GREETING)).toEqual({ prefix: 'resolved' });
  });

  test('一括読み込みの登録表は処理単位のコンテナから依存を取得し、要求ごとに別のものになる', async () => {
    const batches: (readonly string[])[] = [];
    const definition = defineLoader<string, string>({
      name: 'greeting',
      batch: (keys, scope) => {
        batches.push([...keys]);
        const { prefix } = scope.resolve<Greeting>(GREETING);
        return Promise.resolve(keys.map((key) => `${prefix}:${key}`));
      },
    });
    const first = createGraphQLContext(
      createScope({ container: createContainer({ prefix: 'first' }) }),
    );
    const second = createGraphQLContext(
      createScope({ container: createContainer({ prefix: 'second' }) }),
    );

    const values = await Promise.all([
      first.loaders.get(definition).load('a'),
      first.loaders.get(definition).load('b'),
      second.loaders.get(definition).load('a'),
    ]);

    expect(values).toEqual(['first:a', 'first:b', 'second:a']);
    expect(first.loaders.get(definition)).toBe(first.loaders.get(definition));
    expect(first.loaders).not.toBe(second.loaders);
    expect(batches).toEqual([['a', 'b'], ['a']]);
  });

  test('bot判定の呼び出しは引き継いだトークンとクライアントIPと操作名を検証へ渡し、成功なら通過する', async () => {
    const fake = createFakeVerifier('pass');
    const context = contextWithVerifier(fake.verifier);

    await expect(context.assertHuman('sign-up')).resolves.toBeUndefined();

    expect(fake.inputs).toEqual([
      { token: BOT_TOKEN, remoteIp: CLIENT_IP, expectedAction: 'sign-up' },
    ]);
  });

  test('操作名を指定しないbot判定では検証へ操作名を渡さない', async () => {
    const fake = createFakeVerifier('pass');
    const context = contextWithVerifier(fake.verifier);

    await context.assertHuman();

    expect(fake.inputs).toEqual([{ token: BOT_TOKEN, remoteIp: CLIENT_IP }]);
    expect(fake.inputs[0]).not.toHaveProperty('expectedAction');
  });

  test('トークンとクライアントIPが無い処理単位では不明のまま検証へ渡す', async () => {
    const fake = createFakeVerifier('pass');
    const context = contextWithVerifier(fake.verifier, {
      botToken: undefined,
      clientIp: undefined,
    });

    await context.assertHuman();

    expect(fake.inputs).toEqual([{ token: undefined, remoteIp: undefined }]);
  });

  test('bot判定の検証が失敗すると共通エラーで拒否する', async () => {
    const fake = createFakeVerifier('reject');
    const context = contextWithVerifier(fake.verifier);

    const error = await rejectionOf(context.assertHuman('sign-up'));

    expect(error).toBe(REJECTION);
    expect(fake.inputs).toHaveLength(1);
  });

  test('backend-platformの検証へトークンとクライアントIPが届き、判定の失敗は値を含まない共通エラーになる', async () => {
    const siteverify = createSiteverify({
      success: false,
      'error-codes': ['invalid-input-response'],
    });
    const verifier = createTurnstileVerifier({
      secretKey: 'test-turnstile-secret',
      expectedHostnames: [HOSTNAME],
      fetch: siteverify.fetch,
    });
    const context = contextWithVerifier(verifier);

    const error = await rejectionOf(context.assertHuman());

    expect(siteverify.sent).toEqual([
      expect.objectContaining({ response: BOT_TOKEN, remoteip: CLIENT_IP }),
    ]);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'forbidden',
      code: 'bot_verification_failed',
    });
    expect(JSON.stringify(error)).not.toContain(BOT_TOKEN);
    expect((error as AppError).message).not.toContain(BOT_TOKEN);
  });

  test('backend-platformの検証が成功すれば通過する', async () => {
    const siteverify = createSiteverify({
      success: true,
      hostname: HOSTNAME,
      challenge_ts: '2026-10-26T01:02:03.456Z',
      action: 'sign-up',
      'error-codes': [],
    });
    const verifier = createTurnstileVerifier({
      secretKey: 'test-turnstile-secret',
      expectedHostnames: [HOSTNAME],
      fetch: siteverify.fetch,
    });
    const context = contextWithVerifier(verifier);

    await expect(context.assertHuman('sign-up')).resolves.toBeUndefined();
    expect(siteverify.sent).toHaveLength(1);
  });

  test('bot判定を呼ばなければ、検証が登録されていない処理単位でも文脈を作って使える', () => {
    const context = createGraphQLContext(createScope());

    expect(context.resolve<Greeting>(GREETING)).toEqual({ prefix: 'scope' });
  });

  test('文脈の項目を別のオブジェクトへ写しても依存の取得とbot判定を呼び出せる', async () => {
    const fake = createFakeVerifier('pass');
    const copied: GraphQLContext = { ...contextWithVerifier(fake.verifier) };

    await copied.assertHuman();

    expect(copied.resolve<Greeting>(GREETING)).toEqual({ prefix: 'scope' });
    expect(fake.inputs).toHaveLength(1);
  });
});

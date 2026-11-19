import { describe, expect, test } from 'bun:test';

import type {
  ApiKeyFeature,
  ApiKeyScopes,
} from '../../../common-lib/public-api/api-key-rules.ts';
import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type {
  ApiAccess,
  ApiTarget,
} from '../../domain/public-api/api-key-scopes.ts';
import { API_KEY_HASH_PURPOSE } from '../../domain/public-api/api-key-token.ts';
import { identityError } from '../identity/identity-errors.ts';
import {
  type ApiKeyAuthorizer,
  StoreApiKeyAuthorizer,
} from './api-key-authorizer.ts';
import type { PublicApiRateLimits, PublicApiRateLimitStatus } from './ports.ts';
import { PublicApiRateLimitError } from './public-api-rate-limit-error.ts';
import { ruleForAccess } from './rate-limit-rules.ts';
import {
  createFakeApiKeyStore,
  currentUserOf,
  type FakeApiKeyStore,
  generatedPlainOf,
  OTHER_USER_ID,
  type StoredKey,
  storedKeyOf,
  USER_ID,
} from './testing/api-key-management-fakes.ts';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const WINDOW_RESET_AT = NOW.getTime() + 60_000;

const KEY_ID = '01JC0APKEYAVTH000000000001';

const SECOND_KEY_ID = '01JC0APKEYAVTH000000000002';

const PLAIN_KEY = generatedPlainOf(101);

const SECOND_PLAIN_KEY = generatedPlainOf(102);

const MISSING_PLAIN_KEY = generatedPlainOf(999);

const NO_ACCESS_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'none',
  launches: 'none',
  upvotes: 'none',
  comments: 'none',
  ratings: 'none',
  profile: 'none',
  productDescriptions: 'none',
});

const SCOPES: ApiKeyScopes = Object.freeze({
  ...NO_ACCESS_SCOPES,
  products: 'read',
  profile: 'read_write',
});

const INVALID_API_KEY = {
  kind: 'unauthenticated',
  status: 401,
  code: 'invalid_api_key',
  message: 'APIキーが無効です。',
};

const ACCOUNT_UNAVAILABLE = {
  kind: 'forbidden',
  status: 403,
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
};

const INSUFFICIENT_SCOPE = {
  kind: 'forbidden',
  status: 403,
  code: 'insufficient_scope',
  message: 'このAPIキーにはこの操作の権限がありません。',
};

const fakeHashOf = (purpose: HashPurpose, value: string): string =>
  `${purpose}:${value}`;

type UserState = 'active' | 'suspended' | 'missing';

interface RequestCall {
  readonly userId: string;
  readonly access: ApiAccess;
  readonly now: Date;
}

interface Harness {
  readonly authorizer: ApiKeyAuthorizer;
  readonly store: FakeApiKeyStore;
  readonly calls: string[];
  readonly hashed: { readonly purpose: HashPurpose; readonly value: string }[];
  readonly sessions: SessionView[];
  readonly requestCalls: RequestCall[];
}

const keyOf = (overrides: Partial<StoredKey> = {}): StoredKey =>
  storedKeyOf({
    id: KEY_ID,
    userId: USER_ID,
    scopes: SCOPES,
    keyHash: fakeHashOf(API_KEY_HASH_PURPOSE, PLAIN_KEY),
    ...overrides,
  });

const suspendedUserOf = (current: CurrentUser): CurrentUser => ({
  ...current,
  user: { ...current.user, status: 'suspended' },
});

// 規則の上限を超えた呼び出しを、実装と同じ値を持つ拒否にする
function createCountingRateLimits(
  calls: string[],
  requestCalls: RequestCall[],
): PublicApiRateLimits {
  return {
    consumeIssue: () => {
      throw new Error('テストでは使わない');
    },
    consumeRequest: (userId, access, now) => {
      calls.push(`consumeRequest:${access}`);
      requestCalls.push({ userId, access, now });
      const { limit } = ruleForAccess(access);
      const used = requestCalls.filter(
        (call) => call.userId === userId && call.access === access,
      ).length;
      const status: PublicApiRateLimitStatus = {
        limit,
        remaining: Math.max(limit - used, 0),
        resetAt: WINDOW_RESET_AT,
      };
      if (used > limit) {
        return Promise.reject(
          new PublicApiRateLimitError({
            rateLimit: status,
            retryAfterSeconds: Math.ceil(
              (WINDOW_RESET_AT - now.getTime()) / 1000,
            ),
          }),
        );
      }
      return Promise.resolve(status);
    },
  };
}

function createHarness(
  options: {
    readonly keys?: readonly StoredKey[];
    readonly userState?: UserState;
  } = {},
): Harness {
  const store = createFakeApiKeyStore(options.keys ?? [keyOf()]);
  const calls: string[] = [];
  const hashed: { purpose: HashPurpose; value: string }[] = [];
  const sessions: SessionView[] = [];
  const requestCalls: RequestCall[] = [];
  const userState = options.userState ?? 'active';
  const trackedStore: FakeApiKeyStore = {
    ...store,
    findByHash: (keyHash) => {
      calls.push('findByHash');
      return store.findByHash(keyHash);
    },
  };
  const hasher: KeyedHasher = {
    hash: (purpose, value) => {
      calls.push('hash');
      hashed.push({ purpose, value });
      return Promise.resolve(fakeHashOf(purpose, value));
    },
    verify: () => {
      throw new Error('テストでは使わない');
    },
  };
  const resolveUser = async (session: SessionView): Promise<CurrentUser> => {
    sessions.push(session);
    const principal = await session.principal();
    if (userState === 'missing' || principal.kind !== 'authenticated') {
      throw identityError('unauthenticated');
    }
    const current = { ...currentUserOf(principal.subjectId), principal };
    return userState === 'suspended' ? suspendedUserOf(current) : current;
  };
  const guard: AccountGuard = {
    currentUser: () => {
      throw new Error('テストでは使わない');
    },
    requireUser: (session) => {
      calls.push('requireUser');
      return resolveUser(session);
    },
    requireWritableUser: async (session) => {
      calls.push('requireWritableUser');
      const current = await resolveUser(session);
      if (current.user.status === 'suspended') {
        throw identityError('account_unavailable');
      }
      return current;
    },
    requireVerifiedUser: () => {
      throw new Error('テストでは使わない');
    },
  };
  return {
    authorizer: new StoreApiKeyAuthorizer(
      trackedStore,
      hasher,
      guard,
      createCountingRateLimits(calls, requestCalls),
    ),
    store,
    calls,
    hashed,
    sessions,
    requestCalls,
  };
}

const requestOf = (
  overrides: Partial<{
    readonly token: string;
    readonly feature: ApiKeyFeature;
    readonly access: ApiAccess;
    readonly target: ApiTarget;
    readonly now: Date;
  }> = {},
) => ({
  token: PLAIN_KEY,
  feature: 'products' as ApiKeyFeature,
  access: 'read' as ApiAccess,
  target: 'public' as ApiTarget,
  now: NOW,
  ...overrides,
});

async function captureError(action: () => Promise<unknown>): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が投げられなかった');
}

const summaryOf = (error: AppError): Readonly<Record<string, unknown>> => ({
  kind: error.kind,
  status: STATUS_BY_KIND[error.kind],
  code: error.code,
  message: error.message,
});

describe('StoreApiKeyAuthorizer.authorize の成功', () => {
  test('公開データの読み取りは、照合したキーの持ち主と権限スコープと回数の上限・残り・リセットの時刻を返す', async () => {
    const { authorizer, calls, hashed, requestCalls } = createHarness();

    const authorization = await authorizer.authorize(requestOf());

    expect(authorization).toStrictEqual({
      caller: {
        keyId: KEY_ID,
        user: {
          principal: {
            kind: 'authenticated',
            subjectKind: 'user',
            subjectId: USER_ID,
            sessionId: `api-key:${KEY_ID}`,
          },
          user: currentUserOf().user,
        },
        scopes: SCOPES,
      },
      rateLimit: { limit: 30, remaining: 29, resetAt: WINDOW_RESET_AT },
    });
    expect(calls).toStrictEqual([
      'hash',
      'findByHash',
      'requireUser',
      'consumeRequest:read',
    ]);
    expect(hashed).toStrictEqual([
      { purpose: API_KEY_HASH_PURPOSE, value: PLAIN_KEY },
    ]);
    expect(requestCalls).toStrictEqual([
      { userId: USER_ID, access: 'read', now: NOW },
    ]);
  });

  test('利用者の状態の判定へ、キーの持ち主とキーのIDを入れた疑似のセッションを渡す', async () => {
    const { authorizer, sessions } = createHarness();

    await authorizer.authorize(requestOf());

    expect(sessions).toHaveLength(1);
    expect(await sessions[0]?.principal()).toStrictEqual({
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: USER_ID,
      sessionId: `api-key:${KEY_ID}`,
    });
  });

  test('自分のデータの経路は書き込みのできる利用者であることを確かめる', async () => {
    const { authorizer, calls } = createHarness();

    await authorizer.authorize(
      requestOf({ feature: 'profile', access: 'write', target: 'own' }),
    );

    expect(calls).toStrictEqual([
      'hash',
      'findByHash',
      'requireWritableUser',
      'consumeRequest:write',
    ]);
  });

  test('書き込みの経路は書き込みの規則の上限と残りを返す', async () => {
    const { authorizer } = createHarness();

    const authorization = await authorizer.authorize(
      requestOf({ feature: 'profile', access: 'write', target: 'own' }),
    );

    expect(authorization.rateLimit).toStrictEqual({
      limit: 15,
      remaining: 14,
      resetAt: WINDOW_RESET_AT,
    });
  });
});

describe('StoreApiKeyAuthorizer.authorize のキーの照合', () => {
  test('形式に合わないキーは照合せずに無効にし、回数を消費しない', async () => {
    const { authorizer, calls } = createHarness();

    const errors = await Promise.all(
      ['', 'lsk_short', `sk_${PLAIN_KEY.slice(4)}`, `${PLAIN_KEY}x`].map(
        (token) =>
          captureError(() => authorizer.authorize(requestOf({ token }))),
      ),
    );

    for (const error of errors) {
      expect(summaryOf(error)).toStrictEqual(INVALID_API_KEY);
    }
    expect(calls).toStrictEqual([]);
  });

  test('存在しないキーは形式違反と区別しない無効にし、利用者の状態を確かめず回数を消費しない', async () => {
    const { authorizer, calls } = createHarness();

    const error = await captureError(() =>
      authorizer.authorize(requestOf({ token: MISSING_PLAIN_KEY })),
    );

    expect(summaryOf(error)).toStrictEqual(INVALID_API_KEY);
    expect(calls).toStrictEqual(['hash', 'findByHash']);
  });

  test('毎回キーの行を読むため、削除したキーは次の要求から無効になる', async () => {
    const { authorizer, store } = createHarness();
    await authorizer.authorize(requestOf());

    await store.delete(USER_ID, KEY_ID);
    const error = await captureError(() => authorizer.authorize(requestOf()));

    expect(summaryOf(error)).toStrictEqual(INVALID_API_KEY);
  });

  test('毎回キーの行を読むため、編集した権限スコープは次の要求から効く', async () => {
    const { authorizer, store } = createHarness();
    await authorizer.authorize(requestOf());

    await store.update({
      userId: USER_ID,
      keyId: KEY_ID,
      name: '既存のキー',
      scopes: NO_ACCESS_SCOPES,
      at: NOW,
    });
    const error = await captureError(() => authorizer.authorize(requestOf()));

    expect(summaryOf(error)).toStrictEqual(INSUFFICIENT_SCOPE);
  });
});

describe('StoreApiKeyAuthorizer.authorize の利用者の状態', () => {
  test('停止中の持ち主のキーは公開データの経路で通る', async () => {
    const { authorizer, calls } = createHarness({ userState: 'suspended' });

    const authorization = await authorizer.authorize(requestOf());

    expect(authorization.caller.user.user.status).toBe('suspended');
    expect(calls).toStrictEqual([
      'hash',
      'findByHash',
      'requireUser',
      'consumeRequest:read',
    ]);
  });

  test('停止中の持ち主のキーは自分のデータの経路で403にし、回数を消費しない', async () => {
    const { authorizer, requestCalls } = createHarness({
      userState: 'suspended',
    });

    const errors = await Promise.all(
      [
        requestOf({ feature: 'profile', access: 'read', target: 'own' }),
        requestOf({ feature: 'profile', access: 'write', target: 'own' }),
      ].map((request) => captureError(() => authorizer.authorize(request))),
    );

    for (const error of errors) {
      expect(summaryOf(error)).toStrictEqual(ACCOUNT_UNAVAILABLE);
    }
    expect(requestCalls).toStrictEqual([]);
  });

  test('利用者の状態は権限より先に判定する', async () => {
    const { authorizer } = createHarness({ userState: 'suspended' });

    const error = await captureError(() =>
      authorizer.authorize(
        requestOf({
          feature: 'productDescriptions',
          access: 'write',
          target: 'own',
        }),
      ),
    );

    expect(summaryOf(error)).toStrictEqual(ACCOUNT_UNAVAILABLE);
  });

  test('キーの持ち主の利用者が見つからない場合は、どちらの経路でもキーの無効にし、回数を消費しない', async () => {
    const { authorizer, requestCalls } = createHarness({
      userState: 'missing',
    });

    const errors = await Promise.all(
      [
        requestOf(),
        requestOf({ feature: 'profile', access: 'read', target: 'own' }),
      ].map((request) => captureError(() => authorizer.authorize(request))),
    );

    for (const error of errors) {
      expect(summaryOf(error)).toStrictEqual(INVALID_API_KEY);
    }
    expect(requestCalls).toStrictEqual([]);
  });
});

describe('StoreApiKeyAuthorizer.authorize の権限スコープ', () => {
  test.each([
    ['無効の機能の読み取り', 'launches', 'read'],
    ['読み取りだけの機能の書き込み', 'products', 'write'],
  ] as const)(
    '%sは403にし、回数を消費しない',
    async (_label, feature, access) => {
      const { authorizer, calls } = createHarness();

      const error = await captureError(() =>
        authorizer.authorize(requestOf({ feature, access })),
      );

      expect(summaryOf(error)).toStrictEqual(INSUFFICIENT_SCOPE);
      expect(calls).toStrictEqual(['hash', 'findByHash', 'requireUser']);
    },
  );

  test('読み書きの機能は読み取りの経路でも通る', async () => {
    const { authorizer } = createHarness();

    const authorization = await authorizer.authorize(
      requestOf({ feature: 'profile', access: 'read', target: 'own' }),
    );

    expect(authorization.caller.keyId).toBe(KEY_ID);
  });
});

describe('StoreApiKeyAuthorizer.authorize の利用者単位の回数の制限', () => {
  test('同じ利用者の別のキーの要求も、キーの持ち主の利用者として数える', async () => {
    const { authorizer, requestCalls } = createHarness({
      keys: [
        keyOf(),
        keyOf({
          id: SECOND_KEY_ID,
          keyHash: fakeHashOf(API_KEY_HASH_PURPOSE, SECOND_PLAIN_KEY),
        }),
      ],
    });

    await authorizer.authorize(requestOf());
    const second = await authorizer.authorize(
      requestOf({ token: SECOND_PLAIN_KEY }),
    );

    expect(second.caller.keyId).toBe(SECOND_KEY_ID);
    expect(second.rateLimit.remaining).toBe(28);
    expect(requestCalls.map((call) => call.userId)).toStrictEqual([
      USER_ID,
      USER_ID,
    ]);
  });

  test('別の利用者のキーは別に数える', async () => {
    const otherPlain = generatedPlainOf(103);
    const { authorizer, requestCalls } = createHarness({
      keys: [
        keyOf(),
        keyOf({
          id: SECOND_KEY_ID,
          userId: OTHER_USER_ID,
          keyHash: fakeHashOf(API_KEY_HASH_PURPOSE, otherPlain),
        }),
      ],
    });

    await authorizer.authorize(requestOf());
    const other = await authorizer.authorize(requestOf({ token: otherPlain }));

    expect(other.rateLimit.remaining).toBe(29);
    expect(requestCalls.map((call) => call.userId)).toStrictEqual([
      USER_ID,
      OTHER_USER_ID,
    ]);
  });

  test('読み取りと書き込みは別の規則で数える', async () => {
    const { authorizer, requestCalls } = createHarness();

    await authorizer.authorize(requestOf());
    const write = await authorizer.authorize(
      requestOf({ feature: 'profile', access: 'write', target: 'own' }),
    );

    expect(write.rateLimit).toStrictEqual({
      limit: 15,
      remaining: 14,
      resetAt: WINDOW_RESET_AT,
    });
    expect(requestCalls.map((call) => call.access)).toStrictEqual([
      'read',
      'write',
    ]);
  });

  test('上限を超えた要求は再試行の秒数と回数の値を持つ429にする', async () => {
    const { authorizer } = createHarness();
    for (let count = 0; count < 15; count += 1) {
      await authorizer.authorize(
        requestOf({ feature: 'profile', access: 'write', target: 'own' }),
      );
    }

    const error = await captureError(() =>
      authorizer.authorize(
        requestOf({ feature: 'profile', access: 'write', target: 'own' }),
      ),
    );

    expect(error).toBeInstanceOf(PublicApiRateLimitError);
    expect(summaryOf(error)).toStrictEqual({
      kind: 'rate_limited',
      status: 429,
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });
    expect(error.retryAfterSeconds).toBe(60);
    expect((error as PublicApiRateLimitError).rateLimit).toStrictEqual({
      limit: 15,
      remaining: 0,
      resetAt: WINDOW_RESET_AT,
    });
  });

  test('失敗した要求は回数を消費しない', async () => {
    const { authorizer, requestCalls } = createHarness();

    await captureError(() =>
      authorizer.authorize(requestOf({ token: 'lsk_short' })),
    );
    await captureError(() =>
      authorizer.authorize(requestOf({ token: MISSING_PLAIN_KEY })),
    );
    await captureError(() =>
      authorizer.authorize(requestOf({ feature: 'comments' })),
    );
    const authorization = await authorizer.authorize(requestOf());

    expect(requestCalls).toHaveLength(1);
    expect(authorization.rateLimit.remaining).toBe(29);
  });
});

describe('StoreApiKeyAuthorizer.authorize の想定外の失敗', () => {
  test('利用者の状態の判定のunauthenticated以外の例外はそのまま投げる', async () => {
    const harness = createHarness();
    const failure = new Error('D1の障害');
    const authorizer = new StoreApiKeyAuthorizer(
      harness.store,
      {
        hash: (purpose, value) => Promise.resolve(fakeHashOf(purpose, value)),
        verify: () => Promise.resolve(false),
      },
      {
        currentUser: () => Promise.reject(failure),
        requireUser: () => Promise.reject(failure),
        requireWritableUser: () => Promise.reject(failure),
        requireVerifiedUser: () => Promise.reject(failure),
      },
      createCountingRateLimits([], []),
    );

    const caught = await authorizer.authorize(requestOf()).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toBe(failure);
  });
});

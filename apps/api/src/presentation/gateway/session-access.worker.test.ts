import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type Container, ContainerModule } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import { createInvocationContainer } from '../../../lib/workers/di/invocation-container.ts';
import {
  type AuthenticatedPrincipal,
  MAX_SESSION_MAX_AGE_SECONDS,
  SESSION_TYPES,
  type SessionIssue,
  type SessionSubjectKind,
  type SessionVerification,
  type SessionVerifier,
} from '../../application/session/session-verifier.ts';
import {
  type CallerKind,
  SESSION_RESPONSE_HEADERS,
} from './gateway-headers.ts';
import {
  applySessionInstructions,
  createSessionAccess,
  type SessionAccess,
} from './session-access.ts';

interface VerifyCall {
  readonly subjectKind: SessionSubjectKind;
  readonly token: string;
}

interface FakeVerifier {
  readonly verifier: SessionVerifier;
  readonly calls: VerifyCall[];
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

const SESSION_TOKEN = `sess${'0123456789'.repeat(3)}abcdefghi`;
const RENEWED_TOKEN = `renew${'9876543210'.repeat(3)}ABCDEFGH`;
const ISSUED_TOKEN = `issue${'1357924680'.repeat(3)}_-zyxwvu`;
const MAX_AGE_SECONDS = 2_592_000;

const USER_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JBUSER000000000000000000',
  sessionId: '01JBSESSION000000000000000',
});

const ANONYMOUS = { kind: 'anonymous' } as const;

function createFakeVerifier(
  result: SessionVerification = { status: 'invalid' },
): FakeVerifier {
  const calls: VerifyCall[] = [];
  const verifier: SessionVerifier = {
    verify(input) {
      calls.push({ subjectKind: input.subjectKind, token: input.token });
      return Promise.resolve(result);
    },
  };
  return { verifier, calls };
}

function createContainerWith(verifier: SessionVerifier): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-session-access',
        clientIp: undefined,
      },
    },
    [
      {
        bindings: new ContainerModule(({ bind }) => {
          bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).toConstantValue(
            verifier,
          );
        }),
      },
    ],
  );
}

function createAccess(
  fake: FakeVerifier,
  options: { caller?: CallerKind; token?: string | undefined } = {},
): SessionAccess {
  return createSessionAccess({
    container: createContainerWith(fake.verifier),
    caller: options.caller ?? 'client',
    token: 'token' in options ? options.token : SESSION_TOKEN,
  });
}

function appliedHeaders(access: SessionAccess): Headers {
  const headers = new Headers();
  applySessionInstructions(access, headers);
  return headers;
}

function sessionHeaderEntries(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Object.values(SESSION_RESPONSE_HEADERS).flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

function recordLogs(): ConsoleCall[] {
  const calls: ConsoleCall[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const recorder = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: recorder as unknown as Console,
  });
  return calls;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

function captureThrown(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('例外が投げられませんでした');
}

afterAll(() => {
  resetSync();
});

describe('createSessionAccess', () => {
  test.each([
    ['client', 'user'],
    ['admin', 'admin'],
  ] as const satisfies readonly (readonly [CallerKind, SessionSubjectKind])[])(
    '呼び出し元が%sなら%sのセッションとして検証を求める',
    async (caller, subjectKind) => {
      const fake = createFakeVerifier();
      const access = createAccess(fake, { caller });

      await access.principal();

      expect(fake.calls).toStrictEqual([{ subjectKind, token: SESSION_TOKEN }]);
    },
  );

  test('検証が有効と判定すれば、ログイン中の主体を返す', async () => {
    const fake = createFakeVerifier({
      status: 'valid',
      principal: USER_PRINCIPAL,
    });
    const access = createAccess(fake);

    await expect(access.principal()).resolves.toStrictEqual(USER_PRINCIPAL);
  });

  test.each([
    ['トークンが無い', undefined],
    ['空文字の', ''],
    ['42文字の', SESSION_TOKEN.slice(1)],
    ['44文字の', `${SESSION_TOKEN}a`],
    ['base64urlの外の文字を含む', `${SESSION_TOKEN.slice(1)}=`],
    ['改行を含む', `${SESSION_TOKEN.slice(1)}\n`],
  ])(
    '%sときは検証を呼ばずに未ログインとし、Cookieの指示を出さない',
    async (_label, token) => {
      const fake = createFakeVerifier({
        status: 'valid',
        principal: USER_PRINCIPAL,
      });
      const access = createAccess(fake, { token });

      const principal = await access.principal();

      expect(principal).toStrictEqual(ANONYMOUS);
      expect(fake.calls).toHaveLength(0);
      expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({});
    },
  );

  test('何度参照しても、最初の参照で1回だけ検証する', async () => {
    const fake = createFakeVerifier({
      status: 'valid',
      principal: USER_PRINCIPAL,
    });
    const access = createAccess(fake);

    const concurrent = await Promise.all([
      access.principal(),
      access.principal(),
    ]);
    const later = await access.requireAuthenticated();

    expect(concurrent).toStrictEqual([USER_PRINCIPAL, USER_PRINCIPAL]);
    expect(later).toStrictEqual(USER_PRINCIPAL);
    expect(fake.calls).toHaveLength(1);
  });

  test('参照されなければ検証を呼ばない', () => {
    const fake = createFakeVerifier();

    const access = createAccess(fake);

    expect(fake.calls).toHaveLength(0);
    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({});
  });

  test('検証が無効と判定すれば未ログインとし、削除の指示を応答ヘッダーに出す', async () => {
    const fake = createFakeVerifier({ status: 'invalid' });
    const access = createAccess(fake);

    const principal = await access.principal();

    expect(principal).toStrictEqual(ANONYMOUS);
    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.clear]: '1',
    });
  });

  test('検証が更新を返せば、発行の指示を応答ヘッダーに出す', async () => {
    const fake = createFakeVerifier({
      status: 'valid',
      principal: USER_PRINCIPAL,
      renewal: { token: RENEWED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS },
    });
    const access = createAccess(fake);

    await access.principal();

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: RENEWED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: String(MAX_AGE_SECONDS),
    });
  });

  test('検証が更新を返さなければ、Cookieの指示を出さない', async () => {
    const fake = createFakeVerifier({
      status: 'valid',
      principal: USER_PRINCIPAL,
    });
    const access = createAccess(fake);

    await access.principal();

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({});
  });

  test('発行を指示すれば、発行の指示を応答ヘッダーに出す', () => {
    const access = createAccess(createFakeVerifier());

    access.issue({ token: ISSUED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS });

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: ISSUED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: String(MAX_AGE_SECONDS),
    });
  });

  test('失効を指示すれば、削除の指示を応答ヘッダーに出す', () => {
    const access = createAccess(createFakeVerifier());

    access.clear();

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.clear]: '1',
    });
  });

  test('発行と削除を続けて指示すれば、最後の指示だけを応答ヘッダーに出す', () => {
    const issuedLast = createAccess(createFakeVerifier());
    const clearedLast = createAccess(createFakeVerifier());

    issuedLast.clear();
    issuedLast.issue({ token: ISSUED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS });
    clearedLast.issue({ token: ISSUED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS });
    clearedLast.clear();

    expect(sessionHeaderEntries(appliedHeaders(issuedLast))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: ISSUED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: String(MAX_AGE_SECONDS),
    });
    expect(sessionHeaderEntries(appliedHeaders(clearedLast))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.clear]: '1',
    });
  });

  test('リゾルバの指示の後に検証が無効と判定しても、リゾルバの指示を保つ', async () => {
    const access = createAccess(createFakeVerifier({ status: 'invalid' }));

    access.issue({ token: ISSUED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS });
    await access.principal();

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: ISSUED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: String(MAX_AGE_SECONDS),
    });
  });

  test('検証の後のリゾルバの指示は、検証による指示より優先する', async () => {
    const access = createAccess(createFakeVerifier({ status: 'invalid' }));

    await access.principal();
    access.issue({ token: ISSUED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS });

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: ISSUED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: String(MAX_AGE_SECONDS),
    });
  });
});

describe('requireAuthenticated', () => {
  test('ログイン中なら主体を返す', async () => {
    const access = createAccess(
      createFakeVerifier({ status: 'valid', principal: USER_PRINCIPAL }),
    );

    await expect(access.requireAuthenticated()).resolves.toStrictEqual(
      USER_PRINCIPAL,
    );
  });

  test.each([
    ['トークンが無い', undefined],
    ['セッションが無効な', SESSION_TOKEN],
  ])('%sときは未認証の共通エラーにする', async (_label, token) => {
    const access = createAccess(createFakeVerifier({ status: 'invalid' }), {
      token,
    });

    const error = await captureRejection(access.requireAuthenticated());

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'unauthenticated',
      code: 'unauthenticated',
      message: 'ログインが必要です。',
    });
  });
});

describe('applySessionInstructions', () => {
  test.each([
    [
      '形式の合わない識別子',
      { token: 'short', maxAgeSeconds: MAX_AGE_SECONDS },
    ],
    [
      '改行を含む識別子',
      {
        token: `${ISSUED_TOKEN.slice(1)}\r\nset-cookie: injected=1`,
        maxAgeSeconds: MAX_AGE_SECONDS,
      },
    ],
    ['0秒の有効期間', { token: ISSUED_TOKEN, maxAgeSeconds: 0 }],
    ['負の有効期間', { token: ISSUED_TOKEN, maxAgeSeconds: -1 }],
    ['小数の有効期間', { token: ISSUED_TOKEN, maxAgeSeconds: 1.5 }],
    ['非数の有効期間', { token: ISSUED_TOKEN, maxAgeSeconds: Number.NaN }],
    [
      '上限を1秒超える有効期間',
      { token: ISSUED_TOKEN, maxAgeSeconds: MAX_SESSION_MAX_AGE_SECONDS + 1 },
    ],
  ] as const satisfies readonly (readonly [string, SessionIssue])[])(
    '%sの発行を拒否し、応答ヘッダーを設定しない',
    (_label, session) => {
      const access = createAccess(createFakeVerifier());
      const headers = new Headers();
      access.issue(session);

      const error = captureThrown(() => {
        applySessionInstructions(access, headers);
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).not.toContain(session.token);
      expect((error as Error).message).not.toContain(
        String(session.maxAgeSeconds),
      );
      expect(sessionHeaderEntries(headers)).toStrictEqual({});
    },
  );

  test('上限ちょうどの有効期間なら、発行の指示を応答ヘッダーに出す', () => {
    const access = createAccess(createFakeVerifier());

    access.issue({
      token: ISSUED_TOKEN,
      maxAgeSeconds: MAX_SESSION_MAX_AGE_SECONDS,
    });

    expect(sessionHeaderEntries(appliedHeaders(access))).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: ISSUED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: '34560000',
    });
  });

  test('検証の更新の有効期間が上限を超えれば、発行を拒否し、応答ヘッダーを設定しない', async () => {
    const access = createAccess(
      createFakeVerifier({
        status: 'valid',
        principal: USER_PRINCIPAL,
        renewal: {
          token: RENEWED_TOKEN,
          maxAgeSeconds: MAX_SESSION_MAX_AGE_SECONDS + 1,
        },
      }),
    );
    const headers = new Headers();
    await access.principal();

    const error = captureThrown(() => {
      applySessionInstructions(access, headers);
    });

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).not.toContain(RENEWED_TOKEN);
    expect((error as Error).message).not.toContain(
      String(MAX_SESSION_MAX_AGE_SECONDS + 1),
    );
    expect(sessionHeaderEntries(headers)).toStrictEqual({});
  });

  test('指示の無い名前のセッションのヘッダーを残さない', () => {
    const issued = createAccess(createFakeVerifier());
    const cleared = createAccess(createFakeVerifier());
    const issuedHeaders = new Headers({
      [SESSION_RESPONSE_HEADERS.clear]: '1',
    });
    const clearedHeaders = new Headers({
      [SESSION_RESPONSE_HEADERS.issue]: SESSION_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: '60',
    });
    issued.issue({ token: ISSUED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS });
    cleared.clear();

    applySessionInstructions(issued, issuedHeaders);
    applySessionInstructions(cleared, clearedHeaders);

    expect(sessionHeaderEntries(issuedHeaders)).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.issue]: ISSUED_TOKEN,
      [SESSION_RESPONSE_HEADERS.maxAge]: String(MAX_AGE_SECONDS),
    });
    expect(sessionHeaderEntries(clearedHeaders)).toStrictEqual({
      [SESSION_RESPONSE_HEADERS.clear]: '1',
    });
  });

  test('createSessionAccessで作っていない値を拒否する', () => {
    const foreign: SessionAccess = {
      principal: () => Promise.resolve(ANONYMOUS),
      requireAuthenticated: () => Promise.reject(new Error('未使用')),
      issue: () => undefined,
      clear: () => undefined,
    };

    expect(() => {
      applySessionInstructions(foreign, new Headers());
    }).toThrow(TypeError);
  });
});

describe('ログへのトークンの漏えい', () => {
  test('検証・発行・削除・拒否の流れを通しても、ログの出力にトークンの値が含まれない', async () => {
    const logs = recordLogs();
    const logger = getAppLogger(['api', 'presentation', 'session-access-test']);
    const renewed = createAccess(
      createFakeVerifier({
        status: 'valid',
        principal: USER_PRINCIPAL,
        renewal: { token: RENEWED_TOKEN, maxAgeSeconds: MAX_AGE_SECONDS },
      }),
    );
    const invalid = createAccess(createFakeVerifier({ status: 'invalid' }));
    const rejected = createAccess(createFakeVerifier());
    const malformedToken = `${ISSUED_TOKEN}\r\n`;

    await renewed.principal();
    applySessionInstructions(renewed, new Headers());
    const unauthenticated = await captureRejection(
      invalid.requireAuthenticated(),
    );
    applySessionInstructions(invalid, new Headers());
    rejected.issue({ token: malformedToken, maxAgeSeconds: MAX_AGE_SECONDS });
    const rejection = captureThrown(() => {
      applySessionInstructions(rejected, new Headers());
    });
    logger.warn('想定内の失敗', { error: unauthenticated });
    logger.error('想定外の失敗', { error: rejection });

    const output = JSON.stringify(logs);
    expect(logs).toHaveLength(2);
    expect(output).not.toContain(SESSION_TOKEN);
    expect(output).not.toContain(RENEWED_TOKEN);
    expect(output).not.toContain(ISSUED_TOKEN);
  });
});

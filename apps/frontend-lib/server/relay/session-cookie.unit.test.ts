import { describe, expect, test } from 'bun:test';

import {
  buildSessionSetCookie,
  readSessionInstruction,
  readSessionToken,
  type SessionCookieLogger,
  type SessionInstruction,
  toBrowserResponse,
} from './session-cookie.ts';

const CLIENT_COOKIE = '__Host-test_session';
const ADMIN_COOKIE = '__Host-test_admin_session';
const CLIENT_TOKEN = `client${'A'.repeat(31)}_-9xyz`;
const ADMIN_TOKEN = `admin${'B'.repeat(32)}-_8wvu`;
const ISSUED_TOKEN = `issued${'C'.repeat(31)}_-7tsr`;
const COOKIE_ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Lax';

interface WarningRecord {
  readonly message: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

interface RecordingLogger extends SessionCookieLogger {
  readonly warnings: readonly WarningRecord[];
}

const recordingLogger = (): RecordingLogger => {
  const warnings: WarningRecord[] = [];
  return {
    warnings,
    warn: (message, properties) => {
      warnings.push({ message, properties });
    },
  };
};

const requestWithCookie = (cookie: string | undefined): Request =>
  new Request('https://app.example/_bff/graphql', {
    method: 'POST',
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });

const instructionOf = (headers: Record<string, string>): SessionInstruction =>
  readSessionInstruction(new Headers(headers), recordingLogger());

const errorOf = (action: () => unknown): Error => {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error('例外が投げられなかった');
};

describe('テストの前提', () => {
  test.each([CLIENT_TOKEN, ADMIN_TOKEN, ISSUED_TOKEN])(
    '識別子%sは43文字である',
    (token) => {
      expect(token).toHaveLength(43);
    },
  );
});

describe('readSessionToken', () => {
  test('自分のCookieの値が識別子の形式に合えば返す', () => {
    const request = requestWithCookie(`${CLIENT_COOKIE}=${CLIENT_TOKEN}`);

    expect(readSessionToken(request, CLIENT_COOKIE)).toBe(CLIENT_TOKEN);
  });

  test('他のCookieと並んでいても自分のCookieの値を返す', () => {
    const request = requestWithCookie(
      `theme=dark;${CLIENT_COOKIE}=${CLIENT_TOKEN} ;  other=1`,
    );

    expect(readSessionToken(request, CLIENT_COOKIE)).toBe(CLIENT_TOKEN);
  });

  test('Cookieヘッダーが無ければundefinedを返す', () => {
    expect(
      readSessionToken(requestWithCookie(undefined), CLIENT_COOKIE),
    ).toBeUndefined();
  });

  test('自分のCookieが無ければundefinedを返す', () => {
    expect(
      readSessionToken(requestWithCookie('theme=dark'), CLIENT_COOKIE),
    ).toBeUndefined();
  });

  test.each([
    ['42文字', 'A'.repeat(42)],
    ['44文字', 'A'.repeat(44)],
    ['パディング付き', `${'A'.repeat(42)}=`],
    ['base64の記号', `${'A'.repeat(42)}+`],
    ['引用符付き', `"${'A'.repeat(43)}"`],
    ['URLエンコード', `${'A'.repeat(40)}%3D`],
    ['空', ''],
  ])('値が%sで形式に合わなければundefinedを返す', (_label, value) => {
    const request = requestWithCookie(`${CLIENT_COOKIE}=${value}`);

    expect(readSessionToken(request, CLIENT_COOKIE)).toBeUndefined();
  });

  test('名前が完全に一致するCookieだけを読む', () => {
    const request = requestWithCookie(
      `${CLIENT_COOKIE}_old=${CLIENT_TOKEN}; x${CLIENT_COOKIE}=${CLIENT_TOKEN}; ${CLIENT_COOKIE.toLowerCase()}=${CLIENT_TOKEN}`,
    );

    expect(readSessionToken(request, CLIENT_COOKIE)).toBeUndefined();
  });

  test('同じ名前のCookieが複数あれば最初の値だけを使う', () => {
    const valid = requestWithCookie(
      `${CLIENT_COOKIE}=${CLIENT_TOKEN}; ${CLIENT_COOKIE}=invalid`,
    );
    const invalidFirst = requestWithCookie(
      `${CLIENT_COOKIE}=invalid; ${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
    );

    expect(readSessionToken(valid, CLIENT_COOKIE)).toBe(CLIENT_TOKEN);
    expect(readSessionToken(invalidFirst, CLIENT_COOKIE)).toBeUndefined();
  });

  test('利用者側と管理者側のCookieが両方あってもそれぞれ自分のCookieだけを読む', () => {
    const request = requestWithCookie(
      `${ADMIN_COOKIE}=${ADMIN_TOKEN}; ${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
    );

    expect(readSessionToken(request, CLIENT_COOKIE)).toBe(CLIENT_TOKEN);
    expect(readSessionToken(request, ADMIN_COOKIE)).toBe(ADMIN_TOKEN);
  });

  test('相手側のCookieしか無ければ引き継がない', () => {
    const adminOnly = requestWithCookie(`${ADMIN_COOKIE}=${ADMIN_TOKEN}`);
    const clientOnly = requestWithCookie(`${CLIENT_COOKIE}=${CLIENT_TOKEN}`);

    expect(readSessionToken(adminOnly, CLIENT_COOKIE)).toBeUndefined();
    expect(readSessionToken(clientOnly, ADMIN_COOKIE)).toBeUndefined();
  });
});

describe('readSessionInstruction', () => {
  test('指示の項目が無ければnoneを返す', () => {
    expect(instructionOf({ 'content-type': 'application/json' })).toEqual({
      kind: 'none',
    });
  });

  test('発行の指示を識別子と有効期間に解釈する', () => {
    expect(
      instructionOf({
        'x-session-issue': ISSUED_TOKEN,
        'x-session-max-age': '2592000',
      }),
    ).toEqual({ kind: 'issue', token: ISSUED_TOKEN, maxAgeSeconds: 2592000 });
  });

  test.each(['1', '34560000'])('有効期間%s秒の発行を受け付ける', (maxAge) => {
    expect(
      instructionOf({
        'x-session-issue': ISSUED_TOKEN,
        'x-session-max-age': maxAge,
      }),
    ).toEqual({
      kind: 'issue',
      token: ISSUED_TOKEN,
      maxAgeSeconds: Number(maxAge),
    });
  });

  test('値が1の削除の指示をclearに解釈する', () => {
    expect(instructionOf({ 'x-session-clear': '1' })).toEqual({
      kind: 'clear',
    });
  });

  test('有効期間だけの項目はnoneとして扱い警告しない', () => {
    const logger = recordingLogger();

    expect(
      readSessionInstruction(
        new Headers({ 'x-session-max-age': '3600' }),
        logger,
      ),
    ).toEqual({ kind: 'none' });
    expect(logger.warnings).toEqual([]);
  });

  test.each([
    ['42文字', 'A'.repeat(42)],
    ['base64の記号', `${'A'.repeat(42)}/`],
    ['Cookieの属性の注入', `${'A'.repeat(43)}; Domain=evil.example`],
    ['複数の値の結合', `${ISSUED_TOKEN}, ${ISSUED_TOKEN}`],
    ['空', ''],
  ])(
    '識別子が%sで形式に合わない発行の指示は無視して値を含めずに警告する',
    (_label, token) => {
      const logger = recordingLogger();

      const instruction = readSessionInstruction(
        new Headers({ 'x-session-issue': token, 'x-session-max-age': '3600' }),
        logger,
      );

      expect(instruction).toEqual({ kind: 'none' });
      expect(logger.warnings).toEqual([
        {
          message: 'セッションの発行の指示の形式が不正なため無視しました',
          properties: { reason: 'invalid_token' },
        },
      ]);
    },
  );

  test.each([
    ['無い', undefined],
    ['0', '0'],
    ['負', '-1'],
    ['小数', '3600.5'],
    ['指数表記', '1e3'],
    ['先頭の0', '03600'],
    ['16進', '0x10'],
    ['符号付き', '+3600'],
    ['上限を超える', '34560001'],
    ['数でない', 'forever'],
    ['空', ''],
  ])(
    '有効期間が%sの発行の指示は無視して値を含めずに警告する',
    (_label, maxAge) => {
      const logger = recordingLogger();
      const headers = new Headers({ 'x-session-issue': ISSUED_TOKEN });
      if (maxAge !== undefined) {
        headers.set('x-session-max-age', maxAge);
      }

      expect(readSessionInstruction(headers, logger)).toEqual({ kind: 'none' });
      expect(logger.warnings).toEqual([
        {
          message: 'セッションの発行の指示の形式が不正なため無視しました',
          properties: { reason: 'invalid_max_age' },
        },
      ]);
    },
  );

  test.each(['0', 'true', '', '1, 1'])(
    '値が%pの削除の指示は無視して警告する',
    (value) => {
      const logger = recordingLogger();

      expect(
        readSessionInstruction(
          new Headers({ 'x-session-clear': value }),
          logger,
        ),
      ).toEqual({ kind: 'none' });
      expect(logger.warnings).toEqual([
        {
          message: 'セッションの削除の指示の形式が不正なため無視しました',
          properties: { reason: 'invalid_clear' },
        },
      ]);
    },
  );

  test('発行と削除の指示が同時に付けば削除を選び、値を含めずに警告する', () => {
    const logger = recordingLogger();

    const instruction = readSessionInstruction(
      new Headers({
        'x-session-issue': ISSUED_TOKEN,
        'x-session-max-age': '3600',
        'x-session-clear': '1',
      }),
      logger,
    );

    expect(instruction).toEqual({ kind: 'clear' });
    expect(logger.warnings).toEqual([
      {
        message:
          'セッションの発行と削除の指示が同時に付いていたため削除しました',
        properties: { reason: 'conflicting_instructions' },
      },
    ]);
  });

  test('警告のメッセージと属性に識別子・有効期間の値が含まれない', () => {
    const logger = recordingLogger();
    const leakedToken = `${'L'.repeat(42)}!`;

    readSessionInstruction(
      new Headers({
        'x-session-issue': leakedToken,
        'x-session-max-age': '987654',
      }),
      logger,
    );
    readSessionInstruction(
      new Headers({
        'x-session-issue': ISSUED_TOKEN,
        'x-session-max-age': '99999999999',
      }),
      logger,
    );

    const serialized = JSON.stringify(logger.warnings);
    expect(logger.warnings).toHaveLength(2);
    expect(serialized).not.toContain(leakedToken);
    expect(serialized).not.toContain(ISSUED_TOKEN);
    expect(serialized).not.toContain('987654');
    expect(serialized).not.toContain('99999999999');
  });
});

describe('buildSessionSetCookie', () => {
  test('発行は__Host-の名前・識別子・有効期間・Secure・HttpOnly・SameSite=Lax・Path=/のCookieになる', () => {
    expect(
      buildSessionSetCookie(CLIENT_COOKIE, {
        kind: 'issue',
        token: ISSUED_TOKEN,
        maxAgeSeconds: 3600,
      }),
    ).toBe(
      `__Host-test_session=${ISSUED_TOKEN}; Max-Age=3600; ${COOKIE_ATTRIBUTES}`,
    );
  });

  test('削除は空の値とMax-Age=0のCookieになる', () => {
    expect(buildSessionSetCookie(CLIENT_COOKIE, { kind: 'clear' })).toBe(
      `__Host-test_session=; Max-Age=0; ${COOKIE_ATTRIBUTES}`,
    );
  });

  test('指示が無ければundefinedを返す', () => {
    expect(
      buildSessionSetCookie(CLIENT_COOKIE, { kind: 'none' }),
    ).toBeUndefined();
  });

  test.each([
    ['発行', { kind: 'issue', token: ISSUED_TOKEN, maxAgeSeconds: 3600 }],
    ['削除', { kind: 'clear' }],
  ] as const)(
    '%sのCookieにDomain・Expiresを付けない',
    (_label, instruction) => {
      const cookie = buildSessionSetCookie(ADMIN_COOKIE, instruction);

      expect(cookie).toStartWith(`${ADMIN_COOKIE}=`);
      expect(cookie?.toLowerCase()).not.toContain('domain');
      expect(cookie?.toLowerCase()).not.toContain('expires');
    },
  );

  test.each([
    ['形式に合わない識別子', `${'A'.repeat(42)};`, 3600],
    ['0秒', ISSUED_TOKEN, 0],
    ['小数', ISSUED_TOKEN, 1.5],
    ['上限を超える有効期間', ISSUED_TOKEN, 34560001],
    ['非数', ISSUED_TOKEN, Number.NaN],
  ])(
    '%sの発行は値を含めずにRangeErrorを投げる',
    (_label, token, maxAgeSeconds) => {
      const error = errorOf(() =>
        buildSessionSetCookie(CLIENT_COOKIE, {
          kind: 'issue',
          token,
          maxAgeSeconds,
        }),
      );

      expect(error).toBeInstanceOf(RangeError);
      expect(error.message).not.toContain(token);
      expect(error.message).not.toContain(String(maxAgeSeconds));
    },
  );
});

describe('toBrowserResponse', () => {
  const upstreamWith = (
    headers: [string, string][],
    init: ResponseInit = {},
  ): Response =>
    new Response('{"data":{"ok":true}}', {
      status: 200,
      ...init,
      headers: [['content-type', 'application/json'], ...headers],
    });

  test('状態コード・状態の文言・本文・Retry-Afterと他の項目を変えずに返す', async () => {
    const upstream = new Response('{"error":{"code":"rate_limit_exceeded"}}', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'content-type': 'application/json',
        'retry-after': '7',
        'cache-control': 'no-store',
      },
    });

    const response = toBrowserResponse(
      upstream,
      CLIENT_COOKIE,
      recordingLogger(),
    );

    expect(response.status).toBe(429);
    expect(response.statusText).toBe('Too Many Requests');
    expect(response.headers.get('retry-after')).toBe('7');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(
      '{"error":{"code":"rate_limit_exceeded"}}',
    );
  });

  test('発行の指示で自分の名前のCookieを付け、指示の項目を除く', () => {
    const response = toBrowserResponse(
      upstreamWith([
        ['x-session-issue', ISSUED_TOKEN],
        ['x-session-max-age', '3600'],
      ]),
      CLIENT_COOKIE,
      recordingLogger(),
    );

    expect(response.headers.getSetCookie()).toEqual([
      `${CLIENT_COOKIE}=${ISSUED_TOKEN}; Max-Age=3600; ${COOKIE_ATTRIBUTES}`,
    ]);
    expect(response.headers.has('x-session-issue')).toBe(false);
    expect(response.headers.has('x-session-max-age')).toBe(false);
    expect(response.headers.has('x-session-clear')).toBe(false);
  });

  test('削除の指示で自分の名前のCookieを削除し、指示の項目を除く', () => {
    const response = toBrowserResponse(
      upstreamWith([['x-session-clear', '1']], { status: 401 }),
      ADMIN_COOKIE,
      recordingLogger(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([
      `${ADMIN_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`,
    ]);
    expect(response.headers.has('x-session-clear')).toBe(false);
  });

  test('利用者側の指示は管理者側のCookieに触れず、管理者側の指示は利用者側のCookieに触れない', () => {
    const issue: [string, string][] = [
      ['x-session-issue', ISSUED_TOKEN],
      ['x-session-max-age', '3600'],
    ];

    const client = toBrowserResponse(
      upstreamWith(issue),
      CLIENT_COOKIE,
      recordingLogger(),
    ).headers.getSetCookie();
    const admin = toBrowserResponse(
      upstreamWith([['x-session-clear', '1']]),
      ADMIN_COOKIE,
      recordingLogger(),
    ).headers.getSetCookie();

    expect(client).toHaveLength(1);
    expect(client[0]).toStartWith(`${CLIENT_COOKIE}=`);
    expect(admin).toHaveLength(1);
    expect(admin[0]).toStartWith(`${ADMIN_COOKIE}=`);
  });

  test('上流のSet-Cookieをすべて除き、指示が無ければCookieを付けない', () => {
    const response = toBrowserResponse(
      upstreamWith([
        ['set-cookie', `${CLIENT_COOKIE}=${ISSUED_TOKEN}; Path=/`],
        ['set-cookie', 'tracker=1; Domain=app.example'],
      ]),
      CLIENT_COOKIE,
      recordingLogger(),
    );

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  test('上流のSet-Cookieを除いたうえで指示に応じたCookieだけを付ける', () => {
    const response = toBrowserResponse(
      upstreamWith([
        ['set-cookie', 'tracker=1'],
        ['x-session-clear', '1'],
      ]),
      CLIENT_COOKIE,
      recordingLogger(),
    );

    expect(response.headers.getSetCookie()).toEqual([
      `${CLIENT_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`,
    ]);
  });

  test('形式不正の発行の指示はCookieを付けずに指示の項目を除き、警告する', () => {
    const logger = recordingLogger();

    const response = toBrowserResponse(
      upstreamWith([
        ['x-session-issue', 'short'],
        ['x-session-max-age', '3600'],
      ]),
      CLIENT_COOKIE,
      logger,
    );

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.has('x-session-issue')).toBe(false);
    expect(response.headers.has('x-session-max-age')).toBe(false);
    expect(logger.warnings).toHaveLength(1);
  });

  test('本文の無い応答もそのまま返す', async () => {
    const response = toBrowserResponse(
      new Response(null, {
        status: 415,
        headers: { 'x-session-max-age': '3600' },
      }),
      CLIENT_COOKIE,
      recordingLogger(),
    );

    expect(response.status).toBe(415);
    expect(response.headers.has('x-session-max-age')).toBe(false);
    expect(await response.text()).toBe('');
  });

  test('上流の応答を書き換えずに新しい応答を返す', () => {
    const upstream = Response.json(
      { data: null },
      { headers: { 'x-session-clear': '1', 'set-cookie': 'tracker=1' } },
    );

    const response = toBrowserResponse(
      upstream,
      CLIENT_COOKIE,
      recordingLogger(),
    );

    expect(response).not.toBe(upstream);
    expect(upstream.headers.get('x-session-clear')).toBe('1');
    expect(upstream.headers.getSetCookie()).toEqual(['tracker=1']);
    expect(response.headers.getSetCookie()).toEqual([
      `${CLIENT_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`,
    ]);
  });
});

import { describe, expect, test } from 'bun:test';

import {
  interpretSiteverify,
  MAX_TOKEN_LENGTH,
  type SiteverifyOutcome,
  type VerificationExpectations,
} from './siteverify-result.ts';

const HOSTNAME = 'launch-stadium.example';
const CHALLENGE_TS = '2026-10-25T03:00:00.000Z';

const expectations: VerificationExpectations = {
  action: 'signup',
  hostnames: [HOSTNAME, 'www.launch-stadium.example'],
};
const noExpectations: VerificationExpectations = { hostnames: [] };

function respond(json: unknown, status = 200): SiteverifyOutcome {
  return { kind: 'response', status, json };
}

function successBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    challenge_ts: CHALLENGE_TS,
    hostname: HOSTNAME,
    'error-codes': [],
    action: 'signup',
    cdata: '',
    ...overrides,
  };
}

function failureBody(errorCodes: readonly string[]): unknown {
  return { success: false, 'error-codes': errorCodes };
}

describe('MAX_TOKEN_LENGTH', () => {
  test('トークンの最大長は2048文字である', () => {
    expect(MAX_TOKEN_LENGTH).toBe(2048);
  });
});

describe('interpretSiteverify: 成功応答', () => {
  test('操作名とホスト名が期待どおりなら成功し、ホスト名・操作名・判定時刻を返す', () => {
    const result = interpretSiteverify(respond(successBody()), expectations);

    expect(result).toEqual({
      ok: true,
      hostname: HOSTNAME,
      action: 'signup',
      challengeTs: CHALLENGE_TS,
    });
  });

  test('期待するホスト名が複数あれば、どれか1つと一致すれば成功する', () => {
    const result = interpretSiteverify(
      respond(successBody({ hostname: 'www.launch-stadium.example' })),
      expectations,
    );

    expect(result.ok).toBe(true);
  });

  test('期待値が無ければ操作名とホスト名を照合しない', () => {
    const result = interpretSiteverify(
      respond(successBody({ hostname: 'other.example', action: 'login' })),
      noExpectations,
    );

    expect(result).toEqual({
      ok: true,
      hostname: 'other.example',
      action: 'login',
      challengeTs: CHALLENGE_TS,
    });
  });

  test('応答に操作名が無ければ操作名をundefinedにする', () => {
    const withoutAction = {
      success: true,
      challenge_ts: CHALLENGE_TS,
      hostname: HOSTNAME,
      'error-codes': [],
    };

    const result = interpretSiteverify(respond(withoutAction), noExpectations);

    expect(result).toEqual({
      ok: true,
      hostname: HOSTNAME,
      action: undefined,
      challengeTs: CHALLENGE_TS,
    });
  });

  test('2xxの範囲なら200以外の状態コードでも応答を分類する', () => {
    const result = interpretSiteverify(
      respond(successBody(), 299),
      expectations,
    );

    expect(result.ok).toBe(true);
  });
});

describe('interpretSiteverify: 操作名・ホスト名の不一致', () => {
  test('操作名が期待と異なればaction-mismatchで失敗する', () => {
    const result = interpretSiteverify(
      respond(successBody({ action: 'login' })),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'action-mismatch',
      errorCodes: [],
    });
  });

  test('操作名を期待しているのに応答に操作名が無ければaction-mismatchで失敗する', () => {
    const result = interpretSiteverify(
      respond(successBody({ action: undefined })),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'action-mismatch',
      errorCodes: [],
    });
  });

  test('ホスト名が期待のどれとも一致しなければhostname-mismatchで失敗する', () => {
    const result = interpretSiteverify(
      respond(successBody({ hostname: 'evil.example' })),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'hostname-mismatch',
      errorCodes: [],
    });
  });

  test('ホスト名だけを期待していれば操作名は照合しない', () => {
    const result = interpretSiteverify(
      respond(successBody({ action: 'anything' })),
      { hostnames: [HOSTNAME] },
    );

    expect(result.ok).toBe(true);
  });

  test('操作名だけを期待していればホスト名は照合しない', () => {
    const result = interpretSiteverify(
      respond(successBody({ hostname: 'other.example' })),
      { action: 'signup', hostnames: [] },
    );

    expect(result.ok).toBe(true);
  });

  test('ホスト名の一部だけが一致しても一致とみなさない', () => {
    const result = interpretSiteverify(
      respond(successBody({ hostname: `sub.${HOSTNAME}` })),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'hostname-mismatch',
      errorCodes: [],
    });
  });
});

describe('interpretSiteverify: エラーコードの分類', () => {
  test.each([
    ['missing-input-response', 'invalid-token'],
    ['invalid-input-response', 'invalid-token'],
    ['timeout-or-duplicate', 'expired-or-duplicate'],
    ['missing-input-secret', 'misconfigured'],
    ['invalid-input-secret', 'misconfigured'],
    ['bad-request', 'misconfigured'],
    ['internal-error', 'unavailable'],
  ] as const)('%sは%sに分類する', (errorCode, failure) => {
    const result = interpretSiteverify(
      respond(failureBody([errorCode])),
      expectations,
    );

    expect(result).toEqual({ ok: false, failure, errorCodes: [errorCode] });
  });

  test('複数のエラーコードがあれば設定の誤りを最優先にする', () => {
    const result = interpretSiteverify(
      respond(
        failureBody([
          'invalid-input-response',
          'internal-error',
          'invalid-input-secret',
        ]),
      ),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'misconfigured',
      errorCodes: [
        'invalid-input-response',
        'internal-error',
        'invalid-input-secret',
      ],
    });
  });

  test('一時的な障害は期限切れ・使用済みと無効より優先する', () => {
    const result = interpretSiteverify(
      respond(
        failureBody([
          'invalid-input-response',
          'timeout-or-duplicate',
          'internal-error',
        ]),
      ),
      expectations,
    );

    expect(result).toMatchObject({ ok: false, failure: 'unavailable' });
  });

  test('期限切れ・使用済みは無効より優先する', () => {
    const result = interpretSiteverify(
      respond(failureBody(['invalid-input-response', 'timeout-or-duplicate'])),
      expectations,
    );

    expect(result).toMatchObject({
      ok: false,
      failure: 'expired-or-duplicate',
    });
  });

  test('未知のエラーコードだけの失敗は無効なトークンとして拒否する', () => {
    const result = interpretSiteverify(
      respond(failureBody(['unknown-future-code'])),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'invalid-token',
      errorCodes: ['unknown-future-code'],
    });
  });

  test('オブジェクトの組み込みのプロパティ名と同じエラーコードも未知のコードとして扱う', () => {
    const result = interpretSiteverify(
      respond(failureBody(['constructor', 'toString', '__proto__'])),
      expectations,
    );

    expect(result).toMatchObject({ ok: false, failure: 'invalid-token' });
  });

  test('エラーコードが無い失敗は無効なトークンとして拒否する', () => {
    const result = interpretSiteverify(
      respond({ success: false }),
      expectations,
    );

    expect(result).toEqual({
      ok: false,
      failure: 'invalid-token',
      errorCodes: [],
    });
  });
});

describe('interpretSiteverify: 一時的な障害', () => {
  test('ネットワークの失敗はunavailableにする', () => {
    const result = interpretSiteverify({ kind: 'network-error' }, expectations);

    expect(result).toEqual({
      ok: false,
      failure: 'unavailable',
      errorCodes: [],
    });
  });

  test('時間切れはunavailableにする', () => {
    const result = interpretSiteverify({ kind: 'timeout' }, expectations);

    expect(result).toEqual({
      ok: false,
      failure: 'unavailable',
      errorCodes: [],
    });
  });

  test.each([199, 300, 400, 429, 500, 503])(
    '状態コード%iは本文が成功でもunavailableにする',
    (status) => {
      const result = interpretSiteverify(
        respond(successBody(), status),
        expectations,
      );

      expect(result).toEqual({
        ok: false,
        failure: 'unavailable',
        errorCodes: [],
      });
    },
  );

  test('2xx以外は本文のエラーコードにかかわらずunavailableにする', () => {
    const result = interpretSiteverify(
      respond(failureBody(['invalid-input-secret']), 400),
      expectations,
    );

    expect(result).toMatchObject({ ok: false, failure: 'unavailable' });
  });

  test.each([
    ['JSONとして読めなかった本文', undefined],
    ['null', null],
    ['文字列', 'OK'],
    ['数値', 1],
    ['配列', [true]],
  ])('本文が%sならunavailableにする', (_label, json) => {
    const result = interpretSiteverify(respond(json), expectations);

    expect(result).toEqual({
      ok: false,
      failure: 'unavailable',
      errorCodes: [],
    });
  });

  test.each([
    [
      'successが真偽値でない',
      { ...(successBody() as object), success: 'true' },
    ],
    ['successが無い', { hostname: HOSTNAME, challenge_ts: CHALLENGE_TS }],
    ['成功なのにhostnameが無い', successBody({ hostname: undefined })],
    ['成功なのにchallenge_tsが無い', successBody({ challenge_ts: undefined })],
    ['成功なのにactionが文字列でない', successBody({ action: 1 })],
    ['error-codesが配列でない', { success: false, 'error-codes': 'bad' }],
    [
      'error-codesに文字列でない要素がある',
      { success: false, 'error-codes': [1] },
    ],
  ])('応答の形が想定と異なる(%s)ならunavailableにする', (_label, json) => {
    const result = interpretSiteverify(respond(json), expectations);

    expect(result).toEqual({
      ok: false,
      failure: 'unavailable',
      errorCodes: [],
    });
  });
});

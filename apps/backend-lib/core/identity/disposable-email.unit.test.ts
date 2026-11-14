import { describe, expect, test } from 'bun:test';

import {
  classifyDisifyOutcome,
  DISPOSABLE_CHECK_LOCAL_PART,
  type DisifyOutcome,
  toDisposableCheckAddress,
} from './disposable-email.ts';

function respond(json: unknown, status = 200): DisifyOutcome {
  return { kind: 'response', status, json };
}

function judgedBody(disposable: unknown): Record<string, unknown> {
  return { format: true, domain: 'mail.example', disposable, dns: true };
}

describe('DISPOSABLE_CHECK_LOCAL_PART', () => {
  test('判定サービスへ送るローカル部のダミーはdummyである', () => {
    expect(DISPOSABLE_CHECK_LOCAL_PART).toBe('dummy');
  });
});

describe('toDisposableCheckAddress', () => {
  test('ローカル部をダミーに置き換え、ドメイン部をそのまま残す', () => {
    expect(toDisposableCheckAddress('taro.yamada@mail.example')).toBe(
      'dummy@mail.example',
    );
  });

  test('ローカル部に@を含む引用形式でも、最後の@より後をドメイン部とする', () => {
    expect(toDisposableCheckAddress('"a@b"@mail.example')).toBe(
      'dummy@mail.example',
    );
  });

  test('@を含まない値は、ローカル部を送らないようドメイン部を空にする', () => {
    expect(toDisposableCheckAddress('taro.yamada')).toBe('dummy@');
  });
});

describe('classifyDisifyOutcome: 判定できた応答', () => {
  test('状態コード200でdisposableがtrueならdisposableを返す', () => {
    expect(classifyDisifyOutcome(respond(judgedBody(true)))).toBe('disposable');
  });

  test('状態コード200でdisposableがfalseならregularを返す', () => {
    expect(classifyDisifyOutcome(respond(judgedBody(false)))).toBe('regular');
  });

  test('判定に使わない項目が欠けていても、formatとdisposableがあれば判定する', () => {
    expect(
      classifyDisifyOutcome(respond({ format: true, disposable: false })),
    ).toBe('regular');
  });
});

describe('classifyDisifyOutcome: 判定できない応答', () => {
  test.each<[string, DisifyOutcome]>([
    ['形式の不正(format: false)', respond({ format: false })],
    [
      'formatがfalseでdisposableがある',
      respond({ format: false, disposable: true }),
    ],
    ['formatが文字列', respond({ format: 'true', disposable: true })],
    ['disposableの欠落', respond({ format: true, domain: 'mail.example' })],
    ['disposableが文字列', respond(judgedBody('true'))],
    ['disposableがnull', respond(judgedBody(null))],
    ['本文が配列', respond([true])],
    ['本文がnull', respond(null)],
    ['HTMLなどJSONでない本文', respond(undefined)],
    ['状態コード401', respond({ message: 'Unauthorized' }, 401)],
    ['状態コード403', respond({ message: 'Forbidden' }, 403)],
    ['状態コード422', respond({ message: 'Unprocessable' }, 422)],
    ['状態コード429', respond({ message: 'Too Many Requests' }, 429)],
    ['状態コード503', respond(undefined, 503)],
    ['状態コード503で判定結果の形の本文', respond(judgedBody(true), 503)],
    ['200以外の2xxで判定結果の形の本文', respond(judgedBody(true), 202)],
    ['通信の失敗', { kind: 'network-error' }],
    ['時間切れ', { kind: 'timeout' }],
  ])('%sはundeterminedを返す', (_, outcome) => {
    expect(classifyDisifyOutcome(outcome)).toBe('undetermined');
  });
});

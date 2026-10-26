import { describe, expect, test } from 'bun:test';

import { SESSION_TOKEN_PATTERN, SESSION_TYPES } from './session-verifier.ts';

const SESSION_TOKEN_BYTE_LENGTH = 32;

function createSessionToken(): string {
  return crypto
    .getRandomValues(new Uint8Array(SESSION_TOKEN_BYTE_LENGTH))
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

describe('SESSION_TOKEN_PATTERN', () => {
  test('32バイトの乱数をパディング無しのbase64urlにした43文字の値に合う', () => {
    const tokens = Array.from({ length: 100 }, createSessionToken);

    expect(tokens.every((token) => token.length === 43)).toBe(true);
    expect(tokens.every((token) => SESSION_TOKEN_PATTERN.test(token))).toBe(
      true,
    );
  });

  test.each([
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq',
    'rstuvwxyz0123456789_-ABCDEFGHIJKLMNOPQRSTUV',
  ])('base64urlの文字だけからなる43文字の値%sに合う', (token) => {
    expect(SESSION_TOKEN_PATTERN.test(token)).toBe(true);
  });

  test.each([
    ['空文字', ''],
    ['42文字', 'a'.repeat(42)],
    ['44文字', 'a'.repeat(44)],
    ['パディング付き', `${'a'.repeat(43)}=`],
    ['base64の+を含む', `${'a'.repeat(42)}+`],
    ['base64の/を含む', `${'a'.repeat(42)}/`],
    ['先頭に空白', ` ${'a'.repeat(43)}`],
    ['末尾に改行', `${'a'.repeat(43)}\n`],
    ['非ASCII文字を含む', `${'a'.repeat(42)}あ`],
    ['ドットを含む', `${'a'.repeat(42)}.`],
  ])('%sの値には合わない', (_label, value) => {
    expect(SESSION_TOKEN_PATTERN.test(value)).toBe(false);
  });
});

describe('SESSION_TYPES', () => {
  test('検証のポートの識別子はグローバルなシンボルで、実行時に書き換えられない', () => {
    expect<symbol>(SESSION_TYPES.SessionVerifier).toBe(
      Symbol.for('session.SessionVerifier'),
    );
    expect(Object.isFrozen(SESSION_TYPES)).toBe(true);
  });
});

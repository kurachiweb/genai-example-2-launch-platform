import { describe, expect, test } from 'bun:test';

import { checkPasswordRules } from './password-rules.ts';

const KEY_EMOJI = '🔑';

describe('checkPasswordRules', () => {
  test.each([
    { length: 7, expected: 'too-short' },
    { length: 8, expected: undefined },
    { length: 128, expected: undefined },
    { length: 129, expected: 'too-long' },
  ])('長さ$length文字は$expectedになる', ({ length, expected }) => {
    expect(checkPasswordRules('a'.repeat(length), {})).toBe(expected);
  });

  test('長さを補助面の文字も1文字としてコードポイントで数える', () => {
    expect(checkPasswordRules(KEY_EMOJI.repeat(8), {})).toBeUndefined();
    expect(checkPasswordRules(KEY_EMOJI.repeat(7), {})).toBe('too-short');
    expect(checkPasswordRules(KEY_EMOJI.repeat(129), {})).toBe('too-long');
  });

  test('大文字・数字・記号などの文字種の組み合わせを求めない', () => {
    expect(
      checkPasswordRules('すべてひらがなのぱすわーど', {}),
    ).toBeUndefined();
    expect(checkPasswordRules('abcdefgh', {})).toBeUndefined();
  });

  test('ハンドルと大文字小文字を区別せずに一致すると拒否する', () => {
    expect(checkPasswordRules('LAUNCH_TARO', { handle: 'launch_taro' })).toBe(
      'matches-identity',
    );
  });

  test('ニックネームと大文字小文字を区別せずに一致すると拒否する', () => {
    expect(checkPasswordRules('taro yamada', { nickname: 'Taro Yamada' })).toBe(
      'matches-identity',
    );
  });

  test('ニックネームは保存する値と同じく前後の空白を除いてから比べる', () => {
    expect(
      checkPasswordRules('taro yamada', { nickname: '　Taro Yamada\t' }),
    ).toBe('matches-identity');
  });

  test('メールアドレスのローカル部と大文字小文字を区別せずに一致すると拒否する', () => {
    expect(
      checkPasswordRules('stadium.user', {
        email: 'Stadium.User@mail.example',
      }),
    ).toBe('matches-identity');
  });

  test('ローカル部は最後の@より前を取り出す', () => {
    expect(
      checkPasswordRules('"stadium@user"', {
        email: '"stadium@user"@mail.example',
      }),
    ).toBe('matches-identity');
  });

  test('メールアドレス全体との一致はローカル部との一致ではないため受け付ける', () => {
    expect(
      checkPasswordRules('stadium.user@mail.example', {
        email: 'stadium.user@mail.example',
      }),
    ).toBeUndefined();
  });

  test('@を含まない値はローカル部を取り出せないため比べない', () => {
    expect(
      checkPasswordRules('stadium.user', { email: 'stadium.user' }),
    ).toBeUndefined();
  });

  test('識別子を含むだけの部分一致は受け付ける', () => {
    expect(
      checkPasswordRules('launch_taro_2026', {
        handle: 'launch_taro',
        nickname: 'launch_taro',
        email: 'launch_taro@mail.example',
      }),
    ).toBeUndefined();
  });

  test('パスワード自体の前後の空白は除かずに比べる', () => {
    expect(
      checkPasswordRules(' launch_taro', { handle: 'launch_taro' }),
    ).toBeUndefined();
  });

  test('識別子が無ければ長さだけで判定する', () => {
    expect(
      checkPasswordRules('launch_taro', {
        handle: undefined,
        nickname: undefined,
        email: undefined,
      }),
    ).toBeUndefined();
  });

  test('長さの違反を識別子との一致より先に返す', () => {
    expect(checkPasswordRules('SHORT', { handle: 'short' })).toBe('too-short');
  });
});

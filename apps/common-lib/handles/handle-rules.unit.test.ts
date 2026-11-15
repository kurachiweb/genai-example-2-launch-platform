import { describe, expect, test } from 'bun:test';

import {
  checkHandleFormat,
  HANDLE_PATTERN,
  IMPERSONATION_RESERVED_HANDLES,
  isReservedHandle,
  isSameHandle,
  toHandleKey,
} from './handle-rules.ts';

const RULE = { maxLength: 25 };

describe('checkHandleFormat', () => {
  test.each([
    ['1文字', 'a'],
    ['数字1文字', '7'],
    ['25文字', 'a'.repeat(25)],
    ['大文字を含む', 'LaunchFan'],
    ['ハイフンとアンダースコアを含む', 'a-b_c'],
    ['先頭が数字', '1abc'],
    ['末尾がハイフン', 'abc-'],
  ])('%sを受け付ける', (_, value) => {
    expect(checkHandleFormat(value, RULE)).toBe('ok');
  });

  test('空文字列をemptyと判定する', () => {
    expect(checkHandleFormat('', RULE)).toBe('empty');
  });

  test('26文字をtoo-longと判定する', () => {
    expect(checkHandleFormat('a'.repeat(26), RULE)).toBe('too-long');
  });

  test('上限を超え、かつ文字種も違反する値は文字数の違反を先に示す', () => {
    expect(checkHandleFormat(`!${'a'.repeat(30)}`, RULE)).toBe('too-long');
  });

  test('上限は引数の規則に従う', () => {
    expect(checkHandleFormat('abcd', { maxLength: 3 })).toBe('too-long');
    expect(checkHandleFormat('abc', { maxLength: 3 })).toBe('ok');
  });

  test.each([
    ['先頭のハイフン', '-abc'],
    ['先頭のアンダースコア', '_abc'],
    ['前の空白', ' abc'],
    ['後ろの空白', 'abc '],
    ['途中の空白', 'a bc'],
    ['全角英数字', 'ａｂｃ'],
    ['全角空白', 'a　b'],
    ['アクセント付きの文字', 'café'],
    ['日本語', 'ローンチ'],
    ['ドット', 'a.b'],
    ['アットマーク付き', '@abc'],
    ['末尾の改行', 'abc\n'],
    ['絵文字', 'a😀'],
  ])('%sをinvalid-charactersと判定する', (_, value) => {
    expect(checkHandleFormat(value, RULE)).toBe('invalid-characters');
  });
});

describe('HANDLE_PATTERN', () => {
  test('英数字で始まり英数字・ハイフン・アンダースコアだけで構成された値に一致する', () => {
    expect(HANDLE_PATTERN.test('a-b_C9')).toBe(true);
    expect(HANDLE_PATTERN.test('-a')).toBe(false);
  });
});

describe('toHandleKey', () => {
  test('ASCIIの英字だけを小文字にする', () => {
    expect(toHandleKey('LaunchFan-ABC_09')).toBe('launchfan-abc_09');
  });

  test('ASCII以外の文字は小文字にしない', () => {
    expect(toHandleKey('ÀＡİ')).toBe('ÀＡİ');
  });

  test('空文字列はそのまま返す', () => {
    expect(toHandleKey('')).toBe('');
  });
});

describe('isSameHandle', () => {
  test('大文字小文字だけが違うハンドルを同じと判定する', () => {
    expect(isSameHandle('LaunchFan', 'launchfan')).toBe(true);
  });

  test('文字が違うハンドルを異なると判定する', () => {
    expect(isSameHandle('launchfan', 'launchfan2')).toBe(false);
  });

  test('ASCII以外の大文字小文字は同一視しない', () => {
    expect(isSameHandle('É', 'é')).toBe(false);
  });
});

describe('IMPERSONATION_RESERVED_HANDLES', () => {
  test('ページ配置の14語と完全に一致する', () => {
    expect([...IMPERSONATION_RESERVED_HANDLES]).toEqual([
      'admin',
      'administrator',
      'root',
      'superuser',
      'staff',
      'moderator',
      'mod',
      'official',
      'support',
      'security',
      'team',
      'launchstadium',
      'launch-stadium',
      'launch_stadium',
    ]);
    expect(IMPERSONATION_RESERVED_HANDLES).toHaveLength(14);
  });

  test('全ての語が小文字でハンドルの形式を満たす', () => {
    for (const word of IMPERSONATION_RESERVED_HANDLES) {
      expect(toHandleKey(word)).toBe(word);
      expect(checkHandleFormat(word, RULE)).toBe('ok');
    }
  });
});

describe('isReservedHandle', () => {
  const rule = { reservedWords: IMPERSONATION_RESERVED_HANDLES };

  test.each(IMPERSONATION_RESERVED_HANDLES)('%sを予約語と判定する', (word) => {
    expect(isReservedHandle(word, rule)).toBe(true);
  });

  test.each([
    'ADMIN',
    'Admin',
    'LaunchStadium',
    'LAUNCH-STADIUM',
    'Launch_Stadium',
  ])('大文字小文字を区別せず%sを予約語と判定する', (value) => {
    expect(isReservedHandle(value, rule)).toBe(true);
  });

  test.each([
    'admin1',
    'myadmin',
    'admin-',
    'administrators',
    'ad',
    'launch',
    '',
  ])('完全一致でない%sは予約語と判定しない', (value) => {
    expect(isReservedHandle(value, rule)).toBe(false);
  });

  test('引数の予約語の一覧に従い、一覧の語の大文字小文字も区別しない', () => {
    expect(isReservedHandle('Foo', { reservedWords: ['FOO'] })).toBe(true);
    expect(isReservedHandle('admin', { reservedWords: ['foo'] })).toBe(false);
  });
});

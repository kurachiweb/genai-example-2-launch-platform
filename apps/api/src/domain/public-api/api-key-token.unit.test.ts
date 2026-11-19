import { describe, expect, test } from 'bun:test';

import {
  API_KEY_TOKEN_PATTERN,
  API_KEY_TOKEN_PREFIX,
  isWellFormedApiKey,
  parseBearerAuthorization,
} from './api-key-token.ts';

const BODY_43 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop_';
const WELL_FORMED_KEY = `lsk_${BODY_43}`;

describe('API_KEY_TOKEN_PREFIX・API_KEY_TOKEN_PATTERN', () => {
  test('平文の接頭辞はlsk_である', () => {
    expect(API_KEY_TOKEN_PREFIX).toBe('lsk_');
  });

  test('平文の形式はlsk_と43文字のbase64urlの連結である', () => {
    expect(API_KEY_TOKEN_PATTERN.source).toBe('^lsk_[A-Za-z0-9_-]{43}$');
    expect(API_KEY_TOKEN_PATTERN.flags).toBe('');
  });
});

describe('parseBearerAuthorization', () => {
  test('ヘッダーが無ければmissingを返す', () => {
    expect(parseBearerAuthorization(undefined)).toEqual({ kind: 'missing' });
  });

  test('空のヘッダーはmalformedを返す', () => {
    expect(parseBearerAuthorization('')).toEqual({ kind: 'malformed' });
  });

  test.each([
    { header: 'Bearer' },
    { header: 'Bearer ' },
    { header: 'Bearer   ' },
  ])('トークンの無い「$header」はmalformedを返す', ({ header }) => {
    expect(parseBearerAuthorization(header)).toEqual({ kind: 'malformed' });
  });

  test.each([
    { header: `Bearer ${WELL_FORMED_KEY}` },
    { header: `bearer ${WELL_FORMED_KEY}` },
    { header: `BEARER ${WELL_FORMED_KEY}` },
    { header: `bEaReR ${WELL_FORMED_KEY}` },
  ])(
    '方式名は大文字小文字を区別せずトークンを取り出す($header)',
    ({ header }) => {
      expect(parseBearerAuthorization(header)).toEqual({
        kind: 'token',
        token: WELL_FORMED_KEY,
      });
    },
  );

  test('方式名とトークンの間の複数の空白を受け付ける', () => {
    expect(parseBearerAuthorization(`Bearer   ${WELL_FORMED_KEY}`)).toEqual({
      kind: 'token',
      token: WELL_FORMED_KEY,
    });
  });

  test('形式に合わないトークンもそのまま取り出し、形式の判定は別に行う', () => {
    expect(parseBearerAuthorization('Bearer not-a-key')).toEqual({
      kind: 'token',
      token: 'not-a-key',
    });
  });

  test.each([
    { header: `Basic ${WELL_FORMED_KEY}` },
    { header: 'Basic dXNlcjpwYXNz' },
    { header: `Token ${WELL_FORMED_KEY}` },
    { header: `Bearertoken ${WELL_FORMED_KEY}` },
    { header: WELL_FORMED_KEY },
    { header: `Bearer:${WELL_FORMED_KEY}` },
  ])('別の方式や方式名の無い「$header」はmalformedを返す', ({ header }) => {
    expect(parseBearerAuthorization(header)).toEqual({ kind: 'malformed' });
  });

  test.each([
    { header: `Bearer ${WELL_FORMED_KEY} extra` },
    { header: `Bearer\t${WELL_FORMED_KEY}` },
    { header: ` Bearer ${WELL_FORMED_KEY}` },
    { header: `Bearer ${WELL_FORMED_KEY} ` },
  ])('空白の位置が形式に合わない「$header」はmalformedを返す', ({ header }) => {
    expect(parseBearerAuthorization(header)).toEqual({ kind: 'malformed' });
  });
});

describe('isWellFormedApiKey', () => {
  test('lsk_と43文字のbase64urlの連結を受け付ける', () => {
    expect(isWellFormedApiKey(WELL_FORMED_KEY)).toBe(true);
  });

  test('base64urlの記号の-と_を含む本体を受け付ける', () => {
    expect(isWellFormedApiKey(`lsk_${'-_'.repeat(21)}a`)).toBe(true);
  });

  test.each([
    { label: '接頭辞が無い', token: BODY_43 },
    { label: '接頭辞が大文字', token: `LSK_${BODY_43}` },
    { label: '接頭辞が別の文字列', token: `lsx_${BODY_43}` },
    { label: '接頭辞の区切りが-', token: `lsk-${BODY_43}` },
  ])('$labelトークンを拒否する', ({ token }) => {
    expect(isWellFormedApiKey(token)).toBe(false);
  });

  test.each([
    { label: '本体が42文字', token: `lsk_${BODY_43.slice(0, 42)}` },
    { label: '本体が44文字', token: `lsk_${BODY_43}a` },
    { label: '本体が空', token: 'lsk_' },
    { label: '空文字', token: '' },
  ])('$labelのトークンを拒否する', ({ token }) => {
    expect(isWellFormedApiKey(token)).toBe(false);
  });

  test.each([
    { label: '+', token: `lsk_${BODY_43.slice(0, 42)}+` },
    { label: '/', token: `lsk_${BODY_43.slice(0, 42)}/` },
    { label: '=', token: `lsk_${BODY_43.slice(0, 42)}=` },
    { label: '空白', token: `lsk_${BODY_43.slice(0, 42)} ` },
    { label: '全角の文字', token: `lsk_${BODY_43.slice(0, 42)}あ` },
  ])('base64urlに無い文字($label)を含むトークンを拒否する', ({ token }) => {
    expect(isWellFormedApiKey(token)).toBe(false);
  });

  test('前後に改行の付いたトークンを拒否する', () => {
    expect(isWellFormedApiKey(`${WELL_FORMED_KEY}\n`)).toBe(false);
    expect(isWellFormedApiKey(`\n${WELL_FORMED_KEY}`)).toBe(false);
  });
});

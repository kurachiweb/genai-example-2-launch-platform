import { describe, expect, test } from 'bun:test';

import {
  ALLOWED_EXTRA_HEADERS,
  type ExtraHeaders,
  MAX_EXTRA_HEADER_VALUE_BYTES,
  MAX_EXTRA_HEADERS_TOTAL_BYTES,
  validateExtraHeaders,
} from './email-headers.ts';

const UNSUBSCRIBE_URL = '<https://app.example/unsubscribe?token=abc123>';
const ONE_CLICK = 'List-Unsubscribe=One-Click';

describe('ALLOWED_EXTRA_HEADERS', () => {
  test('配信停止系・一覧の識別・自動送信の表示のヘッダーだけを許可する', () => {
    expect(ALLOWED_EXTRA_HEADERS).toEqual([
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
      'List-Id',
      'Auto-Submitted',
      'Precedence',
    ]);
    expect(Object.isFrozen(ALLOWED_EXTRA_HEADERS)).toBe(true);
  });
});

describe('validateExtraHeaders', () => {
  test('ヘッダーが無ければ受け付ける', () => {
    expect(validateExtraHeaders({})).toEqual({ ok: true });
  });

  test('許可された全てのヘッダーを正しい値で受け付ける', () => {
    const headers: ExtraHeaders = {
      'List-Unsubscribe': `${UNSUBSCRIBE_URL}, <mailto:unsubscribe@mail.example>`,
      'List-Unsubscribe-Post': ONE_CLICK,
      'List-Id': 'お知らせ <notifications.app.example>',
      'Auto-Submitted': 'auto-generated',
      Precedence: 'bulk',
    };

    expect(validateExtraHeaders(headers)).toEqual({ ok: true });
  });

  test('ヘッダー名は大文字小文字を区別せずに許可リストと照合する', () => {
    expect(
      validateExtraHeaders({
        'list-unsubscribe': UNSUBSCRIBE_URL,
        'LIST-UNSUBSCRIBE-POST': ONE_CLICK,
      }),
    ).toEqual({ ok: true });
  });

  test.each([
    'X-Campaign',
    'Reply-To',
    'From',
    'To',
    'Cc',
    'Bcc',
    'Subject',
    'Content-Type',
    'In-Reply-To',
    'List-Unsubscribe ',
    'List-Id\r\nBcc',
    '',
  ])('許可リストに無いヘッダー%pを拒否する', (name) => {
    expect(validateExtraHeaders({ [name]: 'value' })).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
  });

  test('大文字小文字だけが異なる同じヘッダーの重複を拒否する', () => {
    expect(
      validateExtraHeaders({ 'List-Id': 'a.example', 'list-id': 'b.example' }),
    ).toEqual({ ok: false, reason: 'too-many' });
  });

  test.each([
    ['List-Id', 'a.example\r\nBcc: victim@mail.example'],
    ['List-Id', 'a.example\nBcc: victim@mail.example'],
    ['List-Id', 'a.example\rBcc: victim@mail.example'],
    ['Precedence', 'bulk\r\n'],
    ['List-Unsubscribe', `${UNSUBSCRIBE_URL}\r\nBcc: victim@mail.example`],
  ])('%pの値に改行を含むものを拒否する', (name, value) => {
    expect(validateExtraHeaders({ [name]: value })).toEqual({
      ok: false,
      reason: 'invalid-value',
    });
  });

  test.each(['', '   '])('空の値%pを拒否する', (value) => {
    expect(validateExtraHeaders({ 'Auto-Submitted': value })).toEqual({
      ok: false,
      reason: 'invalid-value',
    });
  });

  test.each([
    '<http://app.example/unsubscribe?token=abc123>',
    `<http://app.example/unsubscribe>, ${UNSUBSCRIBE_URL}`,
    '<mailto:unsubscribe@mail.example>',
    'https://app.example/unsubscribe?token=abc123',
    '<https://app.example/unsubscribe token=abc123>',
    '<https://>',
    '<ftp://app.example/unsubscribe>',
    `${UNSUBSCRIBE_URL},`,
    `${UNSUBSCRIBE_URL} <mailto:unsubscribe@mail.example>`,
  ])('HTTPSのURIを山括弧で含まない配信停止ヘッダー%pを拒否する', (value) => {
    expect(validateExtraHeaders({ 'List-Unsubscribe': value })).toEqual({
      ok: false,
      reason: 'invalid-value',
    });
  });

  test.each([
    'List-Unsubscribe=one-click',
    'List-Unsubscribe=One-Click ',
    'One-Click',
  ])('ワンクリックの定型以外の値%pを拒否する', (value) => {
    expect(
      validateExtraHeaders({
        'List-Unsubscribe': UNSUBSCRIBE_URL,
        'List-Unsubscribe-Post': value,
      }),
    ).toEqual({ ok: false, reason: 'invalid-value' });
  });

  test('配信停止のURIが無いワンクリックの指定を拒否する', () => {
    expect(
      validateExtraHeaders({ 'List-Unsubscribe-Post': ONE_CLICK }),
    ).toEqual({ ok: false, reason: 'invalid-value' });
  });

  test('1値が上限の2048バイトちょうどなら受け付ける', () => {
    expect(
      validateExtraHeaders({
        'List-Id': 'a'.repeat(MAX_EXTRA_HEADER_VALUE_BYTES),
      }),
    ).toEqual({ ok: true });
  });

  test('1値が上限の2048バイトを超えるものを拒否する', () => {
    expect(
      validateExtraHeaders({
        'List-Id': 'a'.repeat(MAX_EXTRA_HEADER_VALUE_BYTES + 1),
      }),
    ).toEqual({ ok: false, reason: 'too-large' });
  });

  test('1値の大きさは文字数でなくUTF-8のバイト数で数える', () => {
    const value = 'あ'.repeat(683);

    expect(value.length).toBeLessThan(MAX_EXTRA_HEADER_VALUE_BYTES);
    expect(validateExtraHeaders({ 'List-Id': value })).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  test('許可された全てのヘッダーを1値の上限で並べても合計の上限に収まる', () => {
    const totalBytes = ALLOWED_EXTRA_HEADERS.reduce(
      (sum, name) => sum + name.length + 2 + MAX_EXTRA_HEADER_VALUE_BYTES + 2,
      0,
    );

    expect(totalBytes).toBeLessThanOrEqual(MAX_EXTRA_HEADERS_TOTAL_BYTES);
    expect(
      validateExtraHeaders({
        'List-Id': 'a'.repeat(MAX_EXTRA_HEADER_VALUE_BYTES),
        'Auto-Submitted': 'b'.repeat(MAX_EXTRA_HEADER_VALUE_BYTES),
        Precedence: 'c'.repeat(MAX_EXTRA_HEADER_VALUE_BYTES),
      }),
    ).toEqual({ ok: true });
  });
});

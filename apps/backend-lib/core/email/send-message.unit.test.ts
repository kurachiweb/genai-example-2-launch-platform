import { describe, expect, test } from 'bun:test';

import {
  EMAIL_SEND_MESSAGE,
  type EmailSendBody,
  isWithinEmailSendBodyLimit,
  MAX_EMAIL_SEND_BODY_BYTES,
} from './send-message.ts';

const BODY: EmailSendBody = {
  kind: 'email-delivery.smoke',
  to: 'User@Mail.Example',
  input: { requestedAt: '2026-10-27T07:40:00.000Z' },
};

const JSON_OVERHEAD_BYTES = new TextEncoder().encode(
  JSON.stringify({ ...BODY, input: { text: '' } }),
).byteLength;

function bodyOfBytes(bytes: number): EmailSendBody {
  return {
    ...BODY,
    input: { text: 'a'.repeat(bytes - JSON_OVERHEAD_BYTES) },
  };
}

describe('EMAIL_SEND_MESSAGE', () => {
  test('種別email.sendの凍結済みの契約である', () => {
    expect(EMAIL_SEND_MESSAGE.type).toBe('email.send');
    expect(Object.isFrozen(EMAIL_SEND_MESSAGE)).toBe(true);
  });

  test('種別・宛先・入力だけの本文を受け付け、宛先をそのまま保つ', () => {
    expect(EMAIL_SEND_MESSAGE.schema.safeParse(BODY)).toEqual({
      success: true,
      data: BODY,
    });
  });

  test('任意の送信期限と追加ヘッダーを引き継ぐ', () => {
    const body: EmailSendBody = {
      ...BODY,
      deadline: '2026-10-27T08:10:00.000Z',
      headers: {
        'List-Unsubscribe': '<https://app.example/unsubscribe?token=abc123>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };

    expect(EMAIL_SEND_MESSAGE.schema.safeParse(body)).toEqual({
      success: true,
      data: body,
    });
  });

  test('検証の結果をもう一度検証しても同じ値になる', () => {
    const body = {
      ...BODY,
      deadline: '2026-10-27T08:10:00Z',
      headers: { Precedence: 'bulk' },
      extra: 'ignored',
    };
    const first = EMAIL_SEND_MESSAGE.schema.parse(body);

    expect(first).not.toHaveProperty('extra');
    expect(EMAIL_SEND_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['種別の欠落', { to: BODY.to, input: BODY.input }],
    ['空の種別', { ...BODY, kind: '' }],
    ['宛先の欠落', { kind: BODY.kind, input: BODY.input }],
    ['入力の欠落', { kind: BODY.kind, to: BODY.to }],
    [
      '255文字の宛先',
      {
        ...BODY,
        to: `${'a'.repeat(255 - '@mail.example'.length)}@mail.example`,
      },
    ],
    ['形式の不正な宛先', { ...BODY, to: 'User <user@mail.example>' }],
    ['複数の宛先の文字列', { ...BODY, to: 'a@mail.example,b@mail.example' }],
    ['配列の宛先', { ...BODY, to: ['a@mail.example', 'b@mail.example'] }],
    ['日時でない送信期限', { ...BODY, deadline: '明日' }],
    ['UTCでない送信期限', { ...BODY, deadline: '2026-10-27T17:10:00+09:00' }],
    ['数値の送信期限', { ...BODY, deadline: 1_793_000_000_000 }],
    ['許可外のヘッダー', { ...BODY, headers: { Bcc: 'victim@mail.example' } }],
    [
      '改行入りのヘッダー',
      {
        ...BODY,
        headers: { 'List-Id': 'a.example\r\nBcc: victim@mail.example' },
      },
    ],
    [
      'HTTPの配信停止URI',
      { ...BODY, headers: { 'List-Unsubscribe': '<http://app.example/u>' } },
    ],
    ['文字列でないヘッダーの値', { ...BODY, headers: { Precedence: 1 } }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(EMAIL_SEND_MESSAGE.schema.safeParse(body).success).toBe(false);
  });

  test('JSONで64KiBちょうどの本文を受け付ける', () => {
    expect(
      EMAIL_SEND_MESSAGE.schema.safeParse(
        bodyOfBytes(MAX_EMAIL_SEND_BODY_BYTES),
      ).success,
    ).toBe(true);
  });

  test('JSONで64KiBを超える本文を拒否する', () => {
    expect(
      EMAIL_SEND_MESSAGE.schema.safeParse(
        bodyOfBytes(MAX_EMAIL_SEND_BODY_BYTES + 1),
      ).success,
    ).toBe(false);
  });
});

describe('isWithinEmailSendBodyLimit', () => {
  test('本文の上限は64KiBである', () => {
    expect(MAX_EMAIL_SEND_BODY_BYTES).toBe(65_536);
  });

  test('JSONにしたUTF-8のバイト数が上限以下なら真を返す', () => {
    expect(
      isWithinEmailSendBodyLimit(bodyOfBytes(MAX_EMAIL_SEND_BODY_BYTES)),
    ).toBe(true);
  });

  test('JSONにしたUTF-8のバイト数が上限を超えれば偽を返す', () => {
    expect(
      isWithinEmailSendBodyLimit(bodyOfBytes(MAX_EMAIL_SEND_BODY_BYTES + 1)),
    ).toBe(false);
  });

  test('文字数でなくUTF-8のバイト数で数える', () => {
    const body: EmailSendBody = {
      ...BODY,
      input: { text: 'あ'.repeat(22_000) },
    };

    expect(JSON.stringify(body).length).toBeLessThan(MAX_EMAIL_SEND_BODY_BYTES);
    expect(isWithinEmailSendBodyLimit(body)).toBe(false);
  });

  test('JSONにできない入力を含む本文は偽を返す', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(isWithinEmailSendBodyLimit({ ...BODY, input: 1n })).toBe(false);
    expect(isWithinEmailSendBodyLimit({ ...BODY, input: circular })).toBe(
      false,
    );
  });
});

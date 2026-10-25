import { describe, expect, test } from 'bun:test';

import {
  type DeadLetterNotice,
  type DeadLetterReason,
  isDeadLetterNotice,
  parseEnvelope,
  type QueueEnvelope,
} from './envelope.ts';

const MESSAGE_ID = '01JBZ8Q4N6V2W3X5Y7Z9A0B1C2';
const SENT_AT = '2026-10-25T08:00:00.000Z';

const validEnvelope = (): QueueEnvelope => ({
  v: 1,
  type: 'email.send',
  id: MESSAGE_ID,
  sentAt: SENT_AT,
  body: { to: 'user@mail.example' },
});

const validNotice = (): DeadLetterNotice => ({
  v: 1,
  kind: 'dead-letter-notice',
  messageId: MESSAGE_ID,
  type: 'email.send',
  attempts: 5,
  reason: 'handler-failed',
  errorName: 'TypeError',
  failedAt: SENT_AT,
});

describe('parseEnvelope', () => {
  test('正しい封筒は解析した封筒を返す', () => {
    const raw = validEnvelope();

    const result = parseEnvelope(raw);

    expect(result).toEqual({ ok: true, envelope: validEnvelope() });
  });

  test('本文は検証せずにそのまま渡し、封筒に無い項目は取り除く', () => {
    const body = { nested: [1, 'two', null] };
    const raw = { ...validEnvelope(), body, extra: 'ignored' };

    const result = parseEnvelope(raw);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.body).toBe(body);
      expect(result.envelope).not.toHaveProperty('extra');
    }
  });

  test('本文がnullの封筒も正しい封筒として扱う', () => {
    const raw = { ...validEnvelope(), body: null };

    const result = parseEnvelope(raw);

    expect(result).toEqual({ ok: true, envelope: { ...raw, body: null } });
  });

  test.each<[string, unknown]>([
    ['null', null],
    ['文字列', 'email.send'],
    ['配列', [validEnvelope()]],
    ['版が2', { ...validEnvelope(), v: 2 }],
    ['版が文字列', { ...validEnvelope(), v: '1' }],
    ['種別が空', { ...validEnvelope(), type: '' }],
    ['種別が文字列でない', { ...validEnvelope(), type: 1 }],
    ['IDがULIDでない', { ...validEnvelope(), id: 'not-a-ulid' }],
    ['送信日時がISO 8601でない', { ...validEnvelope(), sentAt: '2026/10/25' }],
    [
      '送信日時がUTCでない',
      { ...validEnvelope(), sentAt: '2026-10-25T00:00:00.000-08:00' },
    ],
    [
      '本文が無い',
      {
        v: 1,
        type: 'email.send',
        id: MESSAGE_ID,
        sentAt: SENT_AT,
      },
    ],
  ])('%sの封筒は不正な封筒として扱う', (_label, raw) => {
    const result = parseEnvelope(raw);

    expect(result).toEqual({ ok: false, reason: 'invalid-envelope' });
  });
});

describe('isDeadLetterNotice', () => {
  test('正しいデッドレター通知を判定する', () => {
    expect(isDeadLetterNotice(validNotice())).toBe(true);
  });

  test.each<DeadLetterReason>([
    'invalid-envelope',
    'unknown-type',
    'invalid-body',
    'handler-failed',
    'auto-moved',
  ])('理由%pの通知を判定する', (reason) => {
    expect(isDeadLetterNotice({ ...validNotice(), reason })).toBe(true);
  });

  test('判明していないIDと種別と例外名は省略できる', () => {
    const notice = {
      v: 1,
      kind: 'dead-letter-notice',
      attempts: 1,
      reason: 'invalid-envelope',
      failedAt: SENT_AT,
    };

    expect(isDeadLetterNotice(notice)).toBe(true);
    expect(
      isDeadLetterNotice({
        ...notice,
        messageId: undefined,
        type: undefined,
        errorName: undefined,
      }),
    ).toBe(true);
  });

  test.each<[string, unknown]>([
    ['null', null],
    ['封筒', validEnvelope()],
    ['版が2', { ...validNotice(), v: 2 }],
    ['種類が異なる', { ...validNotice(), kind: 'notice' }],
    ['未知の理由', { ...validNotice(), reason: 'timeout' }],
    ['試行回数が負', { ...validNotice(), attempts: -1 }],
    ['試行回数が整数でない', { ...validNotice(), attempts: 1.5 }],
    ['IDが文字列でない', { ...validNotice(), messageId: 1 }],
    ['例外名が文字列でない', { ...validNotice(), errorName: {} }],
    ['失敗日時がISO 8601でない', { ...validNotice(), failedAt: 'yesterday' }],
  ])('%sはデッドレター通知と判定しない', (_label, raw) => {
    expect(isDeadLetterNotice(raw)).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

import {
  BOUNCED_EVENT_SAMPLE,
  COMPLAINED_EVENT_SAMPLE,
  DEFERRED_EVENT_SAMPLE,
  DELIVERED_EVENT_SAMPLE,
  FAILED_EVENT_SAMPLE,
  REJECTED_EVENT_SAMPLE,
  SAMPLE_EVENT_TIMESTAMP,
  SAMPLE_RECIPIENT,
} from './delivery-event.fixtures.ts';
import {
  parseDeliveryEvent,
  UNKNOWN_DELIVERY_EVENT_REASON,
} from './delivery-event.ts';

const RECEIVED_AT = new Date('2026-06-01T03:00:00.000Z');

function withPayload(
  sample: { readonly payload: object },
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return { ...sample, payload: { ...sample.payload, ...payload } };
}

function withoutPayloadKey(
  sample: { readonly payload: object },
  key: string,
): Record<string, unknown> {
  const payload = Object.fromEntries(
    Object.entries(sample.payload).filter(([name]) => name !== key),
  );
  return { ...sample, payload };
}

describe('parseDeliveryEvent(文書の標本の正規化)', () => {
  test('恒久バウンスの標本をhard-bounceにする', () => {
    expect(parseDeliveryEvent(BOUNCED_EVENT_SAMPLE, RECEIVED_AT)).toEqual({
      ok: true,
      event: {
        kind: 'hard-bounce',
        eventId: BOUNCED_EVENT_SAMPLE.payload.eventId,
        recipient: SAMPLE_RECIPIENT,
        occurredAt: SAMPLE_EVENT_TIMESTAMP,
      },
    });
  });

  test('苦情の標本をcomplaintにする', () => {
    expect(parseDeliveryEvent(COMPLAINED_EVENT_SAMPLE, RECEIVED_AT)).toEqual({
      ok: true,
      event: {
        kind: 'complaint',
        eventId: COMPLAINED_EVENT_SAMPLE.payload.eventId,
        recipient: SAMPLE_RECIPIENT,
        occurredAt: SAMPLE_EVENT_TIMESTAMP,
      },
    });
  });

  test('受信者側の拒否の標本をpartyがrecipientのrejectedにする', () => {
    expect(parseDeliveryEvent(REJECTED_EVENT_SAMPLE, RECEIVED_AT)).toEqual({
      ok: true,
      event: {
        kind: 'rejected',
        party: 'recipient',
        reason: 'suppressed',
        eventId: REJECTED_EVENT_SAMPLE.payload.eventId,
        recipient: SAMPLE_RECIPIENT,
        occurredAt: SAMPLE_EVENT_TIMESTAMP,
      },
    });
  });

  test('配送失敗の標本を理由付きのfailedにする', () => {
    expect(parseDeliveryEvent(FAILED_EVENT_SAMPLE, RECEIVED_AT)).toEqual({
      ok: true,
      event: {
        kind: 'failed',
        reason: 'delivery_failed',
        eventId: FAILED_EVENT_SAMPLE.payload.eventId,
        recipient: SAMPLE_RECIPIENT,
        occurredAt: SAMPLE_EVENT_TIMESTAMP,
      },
    });
  });

  test('配信成功の標本を無視するものにする', () => {
    expect(parseDeliveryEvent(DELIVERED_EVENT_SAMPLE, RECEIVED_AT)).toEqual({
      ok: true,
      event: {
        kind: 'ignored',
        type: 'delivered',
        eventId: DELIVERED_EVENT_SAMPLE.payload.eventId,
        recipient: SAMPLE_RECIPIENT,
        occurredAt: SAMPLE_EVENT_TIMESTAMP,
      },
    });
  });

  test('再試行中の標本を無視するものにする', () => {
    expect(parseDeliveryEvent(DEFERRED_EVENT_SAMPLE, RECEIVED_AT)).toEqual({
      ok: true,
      event: {
        kind: 'ignored',
        type: 'deferred',
        eventId: DEFERRED_EVENT_SAMPLE.payload.eventId,
        recipient: SAMPLE_RECIPIENT,
        occurredAt: SAMPLE_EVENT_TIMESTAMP,
      },
    });
  });

  test.each([
    DELIVERED_EVENT_SAMPLE,
    DEFERRED_EVENT_SAMPLE,
    BOUNCED_EVENT_SAMPLE,
    FAILED_EVENT_SAMPLE,
    REJECTED_EVENT_SAMPLE,
    COMPLAINED_EVENT_SAMPLE,
  ])('$type の正規化後の値に件名と配送サーバーの応答を含めない', (sample) => {
    const serialized = JSON.stringify(parseDeliveryEvent(sample, RECEIVED_AT));

    expect(serialized).not.toContain('subject');
    expect(serialized).not.toContain('Welcome');
    expect(serialized).not.toContain('Your receipt');
    expect(serialized).not.toContain('smtp');
    expect(serialized).not.toContain('550 5.1.1');
    expect(serialized).not.toContain('451 4.2.0');
    expect(serialized).not.toContain('Recipient is suppressed');
    expect(serialized).not.toContain('send.mail.example');
  });
});

describe('parseDeliveryEvent(種類ごとの判別)', () => {
  test('bounce.typeがsoftのバウンスをsoft-bounceにする', () => {
    const raw = withPayload(BOUNCED_EVENT_SAMPLE, {
      bounce: { type: 'soft', classification: 'temporary_failure' },
    });

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { kind: 'soft-bounce' },
    });
  });

  test('bounceの無いバウンスをsoft-bounceにする', () => {
    const raw = withoutPayloadKey(BOUNCED_EVENT_SAMPLE, 'bounce');

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { kind: 'soft-bounce' },
    });
  });

  test('bounce.typeが未知の値のバウンスをsoft-bounceにする', () => {
    const raw = withPayload(BOUNCED_EVENT_SAMPLE, {
      bounce: { type: 'undetermined' },
    });

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { kind: 'soft-bounce' },
    });
  });

  test.each(['sender', 'system', 'Recipient'])(
    'partyが%pの拒否をpartyがotherのrejectedにする',
    (party) => {
      const raw = withPayload(REJECTED_EVENT_SAMPLE, {
        rejection: { reason: 'spam', party },
      });

      expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
        ok: true,
        event: { kind: 'rejected', party: 'other', reason: 'spam' },
      });
    },
  );

  test('rejectionの無い拒否を理由の分からないpartyがotherのrejectedにする', () => {
    const raw = withoutPayloadKey(REJECTED_EVENT_SAMPLE, 'rejection');

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: {
        kind: 'rejected',
        party: 'other',
        reason: UNKNOWN_DELIVERY_EVENT_REASON,
      },
    });
  });

  test('failureの無い配送失敗を理由の分からないfailedにする', () => {
    const raw = withoutPayloadKey(FAILED_EVENT_SAMPLE, 'failure');

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { kind: 'failed', reason: UNKNOWN_DELIVERY_EVENT_REASON },
    });
  });

  test.each([
    'Recipient is suppressed',
    'user@recipient.example',
    'x'.repeat(65),
    '',
  ])('識別子の形でない理由%pを理由の分からない値に置き換える', (reason) => {
    const raw = withPayload(FAILED_EVENT_SAMPLE, { failure: { reason } });

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { kind: 'failed', reason: UNKNOWN_DELIVERY_EVENT_REASON },
    });
  });

  test('64文字の識別子の形の理由はそのまま残す', () => {
    const reason = `delivery.failed:${'x'.repeat(48)}`;
    const raw = withPayload(FAILED_EVENT_SAMPLE, { failure: { reason } });

    expect(reason).toHaveLength(64);
    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { kind: 'failed', reason },
    });
  });
});

describe('parseDeliveryEvent(共通の項目)', () => {
  test('宛先を前後の空白を除いた小文字の照合キーにする', () => {
    const raw = withPayload(COMPLAINED_EVENT_SAMPLE, {
      recipient: '  User@Recipient.Example ',
    });

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { recipient: SAMPLE_RECIPIENT },
    });
  });

  test('発生日時が無ければ受信時刻を発生日時にする', () => {
    const raw = {
      ...COMPLAINED_EVENT_SAMPLE,
      metadata: { eventSchemaVersion: 1 },
    };

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { occurredAt: RECEIVED_AT },
    });
  });

  test('時差付きの発生日時をUTCの時刻として読む', () => {
    const raw = {
      ...COMPLAINED_EVENT_SAMPLE,
      metadata: {
        eventSchemaVersion: 1,
        eventTimestamp: '2026-06-01T11:48:57.132+09:00',
      },
    };

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toMatchObject({
      ok: true,
      event: { occurredAt: SAMPLE_EVENT_TIMESTAMP },
    });
  });
});

describe('parseDeliveryEvent(失敗)', () => {
  test.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'text'],
    ['数値', 1],
    ['配列', []],
    ['空のオブジェクト', {}],
    ['数値の種類', { type: 1 }],
  ])('種類の分からない値(%s)を種類なしの形式の不正にする', (_label, raw) => {
    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toEqual({
      ok: false,
      reason: 'invalid-format',
      type: undefined,
    });
  });

  test.each([2, 0, '1', undefined])(
    '版が%pのイベントを形式の不正にする',
    (eventSchemaVersion) => {
      const raw = {
        ...BOUNCED_EVENT_SAMPLE,
        metadata: { ...BOUNCED_EVENT_SAMPLE.metadata, eventSchemaVersion },
      };

      expect(parseDeliveryEvent(raw, RECEIVED_AT)).toEqual({
        ok: false,
        reason: 'invalid-format',
        type: BOUNCED_EVENT_SAMPLE.type,
      });
    },
  );

  test('metadataの無いイベントを形式の不正にする', () => {
    const raw = { type: BOUNCED_EVENT_SAMPLE.type, payload: {} };

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toEqual({
      ok: false,
      reason: 'invalid-format',
      type: BOUNCED_EVENT_SAMPLE.type,
    });
  });

  test.each([
    'cf.email.sending.message.opened',
    'cf.email.sending.message.',
    'cf.email.routing.message.bounced',
    'cf.kv.namespace.created',
    'message.bounced',
  ])('未知の種類%pを種類付きの未知の種類にする', (type) => {
    const raw = { ...BOUNCED_EVENT_SAMPLE, type };

    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toEqual({
      ok: false,
      reason: 'unknown-type',
      type,
    });
  });

  test.each([
    ['eventIdの欠落', withoutPayloadKey(BOUNCED_EVENT_SAMPLE, 'eventId')],
    ['空のeventId', withPayload(BOUNCED_EVENT_SAMPLE, { eventId: '' })],
    ['宛先の欠落', withoutPayloadKey(BOUNCED_EVENT_SAMPLE, 'recipient')],
    [
      'メールアドレスでない宛先',
      withPayload(BOUNCED_EVENT_SAMPLE, { recipient: 'not-an-address' }),
    ],
    [
      '255文字の宛先',
      withPayload(BOUNCED_EVENT_SAMPLE, {
        recipient: `${'a'.repeat(237)}@recipient.example`,
      }),
    ],
    [
      'オブジェクトでないbounce',
      withPayload(BOUNCED_EVENT_SAMPLE, { bounce: 'hard' }),
    ],
    ['payloadの欠落', { ...BOUNCED_EVENT_SAMPLE, payload: undefined }],
    [
      '日時でない発生日時',
      {
        ...BOUNCED_EVENT_SAMPLE,
        metadata: { eventSchemaVersion: 1, eventTimestamp: 'yesterday' },
      },
    ],
  ])('%sのイベントを種類付きの形式の不正にする', (_label, raw) => {
    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toEqual({
      ok: false,
      reason: 'invalid-format',
      type: BOUNCED_EVENT_SAMPLE.type,
    });
  });

  test.each([
    [
      'オブジェクトでないrejection',
      withPayload(REJECTED_EVENT_SAMPLE, { rejection: 'suppressed' }),
      REJECTED_EVENT_SAMPLE.type,
    ],
    [
      '文字列でないparty',
      withPayload(REJECTED_EVENT_SAMPLE, { rejection: { party: 1 } }),
      REJECTED_EVENT_SAMPLE.type,
    ],
    [
      'オブジェクトでないfailure',
      withPayload(FAILED_EVENT_SAMPLE, { failure: 'delivery_failed' }),
      FAILED_EVENT_SAMPLE.type,
    ],
  ])('%sのイベントを種類付きの形式の不正にする', (_label, raw, type) => {
    expect(parseDeliveryEvent(raw, RECEIVED_AT)).toEqual({
      ok: false,
      reason: 'invalid-format',
      type,
    });
  });
});

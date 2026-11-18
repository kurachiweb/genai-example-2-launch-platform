import { describe, expect, test } from 'bun:test';

import {
  SPONSORSHIP_DISPATCH_NOTICES_MESSAGE,
  SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE,
} from './sponsorship.ts';

const REQUESTED_AT = '2026-11-18T08:07:00.000Z';

const CONTRACTS = [
  ['sponsorship.dispatch-notices', SPONSORSHIP_DISPATCH_NOTICES_MESSAGE],
  ['sponsorship.settle-period-end', SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE],
] as const;

describe.each(CONTRACTS)('メッセージの契約%s', (type, contract) => {
  test('種別の名前を持つ凍結済みの契約である', () => {
    expect(contract.type).toBe(type);
    expect(Object.isFrozen(contract)).toBe(true);
  });

  test('依頼の時刻だけの本文を受け付ける', () => {
    expect(contract.schema.safeParse({ requestedAt: REQUESTED_AT })).toEqual({
      success: true,
      data: { requestedAt: REQUESTED_AT },
    });
  });

  test('本文に申込や利用者の情報を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = contract.schema.parse({
      requestedAt: REQUESTED_AT,
      sponsorshipId: '01JD0SP0NS000000000000000A',
      productName: 'Sample Product',
      recipientEmail: 'maker@launch.example',
    });

    expect(first).toEqual({ requestedAt: REQUESTED_AT });
    expect(contract.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['依頼の時刻の欠落', {}],
    ['空の依頼の時刻', { requestedAt: '' }],
    ['日付だけの依頼の時刻', { requestedAt: '2026-11-18' }],
    ['時差付きの依頼の時刻', { requestedAt: '2026-11-18T00:07:00-08:00' }],
    ['数値の依頼の時刻', { requestedAt: 1_763_453_220_000 }],
    ['Dateの依頼の時刻', { requestedAt: new Date(REQUESTED_AT) }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(contract.schema.safeParse(body).success).toBe(false);
  });
});

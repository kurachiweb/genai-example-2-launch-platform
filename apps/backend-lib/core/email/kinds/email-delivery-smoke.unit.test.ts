import { describe, expect, test } from 'bun:test';

import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';

describe('EMAIL_DELIVERY_SMOKE_KIND', () => {
  test('疎通確認用のトランザクションメールの種別である', () => {
    expect(EMAIL_DELIVERY_SMOKE_KIND.name).toBe('email-delivery.smoke');
    expect(EMAIL_DELIVERY_SMOKE_KIND.category).toBe('transactional');
    expect(Object.isFrozen(EMAIL_DELIVERY_SMOKE_KIND)).toBe(true);
  });

  test('UTCのISO 8601形式の受付日時を入力として受け付ける', () => {
    const result = EMAIL_DELIVERY_SMOKE_KIND.inputSchema.safeParse({
      requestedAt: '2026-10-27T07:40:00.000Z',
    });

    expect(result).toEqual({
      success: true,
      data: { requestedAt: '2026-10-27T07:40:00.000Z' },
    });
  });

  test('受付日時以外の項目は入力から取り除く', () => {
    const result = EMAIL_DELIVERY_SMOKE_KIND.inputSchema.safeParse({
      requestedAt: '2026-10-27T07:40:00Z',
      to: 'someone@mail.example',
    });

    expect(result.data).toEqual({ requestedAt: '2026-10-27T07:40:00Z' });
  });

  test.each([
    undefined,
    null,
    {},
    { requestedAt: '' },
    { requestedAt: '2026-10-27' },
    { requestedAt: '2026-10-27T16:40:00+09:00' },
    { requestedAt: '2026-13-01T00:00:00Z' },
    { requestedAt: '今日' },
    { requestedAt: 1_793_000_000_000 },
    { requestedAt: new Date('2026-10-27T07:40:00Z') },
  ])('受付日時がUTCのISO 8601形式でない入力%pを拒否する', (input) => {
    expect(EMAIL_DELIVERY_SMOKE_KIND.inputSchema.safeParse(input).success).toBe(
      false,
    );
  });
});

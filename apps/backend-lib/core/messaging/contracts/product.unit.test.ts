import { describe, expect, test } from 'bun:test';

import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from './product.ts';

const ULID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';

describe('RUN_PRODUCT_LIFECYCLE_MESSAGE', () => {
  test('種別product.run-product-lifecycleの凍結済みの契約である', () => {
    expect(RUN_PRODUCT_LIFECYCLE_MESSAGE.type).toBe(
      'product.run-product-lifecycle',
    );
    expect(Object.isFrozen(RUN_PRODUCT_LIFECYCLE_MESSAGE)).toBe(true);
  });

  test('イベントのIDだけの本文を受け付ける', () => {
    expect(
      RUN_PRODUCT_LIFECYCLE_MESSAGE.schema.safeParse({ eventId: ULID }),
    ).toEqual({ success: true, data: { eventId: ULID } });
  });

  test('本文にプロダクトの名前やハンドルを持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = RUN_PRODUCT_LIFECYCLE_MESSAGE.schema.parse({
      eventId: ULID,
      productId: ULID,
      name: 'Sample Product',
      handle: 'sample-product',
    });

    expect(first).toEqual({ eventId: ULID });
    expect(RUN_PRODUCT_LIFECYCLE_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['イベントのIDの欠落', {}],
    ['空のイベントのID', { eventId: '' }],
    ['ULIDでないイベントのID', { eventId: 'event-1' }],
    ['数値のイベントのID', { eventId: 1 }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(RUN_PRODUCT_LIFECYCLE_MESSAGE.schema.safeParse(body).success).toBe(
      false,
    );
  });
});

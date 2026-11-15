import { describe, expect, test } from 'bun:test';

import {
  CHECKOUT_INTEGRATION_IDENTIFIER,
  STRIPE_API_VERSION,
} from './stripe-api-version.ts';

describe('STRIPE_API_VERSION', () => {
  test('Webhook endpointと同じ固定のAPI版である', () => {
    expect(STRIPE_API_VERSION).toBe('2026-10-28.endive');
  });
});

describe('CHECKOUT_INTEGRATION_IDENTIFIER', () => {
  test('決済の導線の名前の末尾に8文字の英小文字を付ける', () => {
    expect(CHECKOUT_INTEGRATION_IDENTIFIER).toMatch(
      /^checkout-elements-[a-z]{8}$/,
    );
  });
});

import { describe, expect, test } from 'bun:test';

import {
  CHECKOUT_CONSENT_TEXT,
  CHECKOUT_CONSENT_VERSION,
} from './checkout-consent.ts';

describe('CHECKOUT_CONSENT_VERSION', () => {
  test('同意の文言の版が2026-10-23になる', () => {
    expect(CHECKOUT_CONSENT_VERSION).toBe('2026-10-23');
  });
});

describe('CHECKOUT_CONSENT_TEXT', () => {
  test('役務の即時提供への同意を求める', () => {
    expect(CHECKOUT_CONSENT_TEXT).toContain(
      'すぐに役務の提供が始まることに同意',
    );
  });

  test('提供の開始によりEU・英国の消費者の14日間の撤回権を失う旨の了知を求める', () => {
    expect(CHECKOUT_CONSENT_TEXT).toContain('EU・英国の消費者');
    expect(CHECKOUT_CONSENT_TEXT).toContain('14日間の撤回権を失う');
  });

  test('文言の全体が版2026-10-23の文言と一致する', () => {
    expect(CHECKOUT_CONSENT_TEXT).toBe(
      '購入の確定後すぐに役務の提供が始まることに同意し、提供の開始により、EU・英国の消費者に認められる14日間の撤回権を失うことを了承します。',
    );
  });
});

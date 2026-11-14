import { describe, expect, test } from 'bun:test';

import {
  ULTRAS_PROMOTION_FLAG_DEFAULT,
  ULTRAS_PROMOTION_FLAG_KEY,
} from './promotion-flag.ts';

describe('ULTRAS_PROMOTION_FLAG_KEY', () => {
  test('有料プランへの導線の機能フラグの鍵はultras_promotionになる', () => {
    expect(ULTRAS_PROMOTION_FLAG_KEY).toBe('ultras_promotion');
  });
});

describe('ULTRAS_PROMOTION_FLAG_DEFAULT', () => {
  test('一度も設定されていない機能フラグはオフとして扱う', () => {
    expect(ULTRAS_PROMOTION_FLAG_DEFAULT).toBe(false);
  });
});

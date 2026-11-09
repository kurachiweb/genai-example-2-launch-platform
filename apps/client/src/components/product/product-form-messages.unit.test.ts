import { describe, expect, test } from 'bun:test';

import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { productRegisteredMessageOf } from './product-form-messages.ts';

const TOKYO_JA: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

describe('productRegisteredMessageOf', () => {
  test('キックオフの日時を利用者のタイムゾーンで示し、相対表現を添える(今年は年を省く)', () => {
    expect(
      productRegisteredMessageOf(
        '2026-09-15T07:00:00.000Z',
        TOKYO_JA,
        new Date('2026-09-13T07:00:00.000Z'),
      ),
    ).toBe(
      'プロダクトを登録しました。キックオフは9月15日(火) 16:00(あと2日)です。',
    );
  });

  test('今年でないキックオフは年を付ける', () => {
    expect(
      productRegisteredMessageOf(
        '2027-01-05T08:00:00.000Z',
        TOKYO_JA,
        new Date('2026-12-30T08:00:00.000Z'),
      ),
    ).toBe(
      'プロダクトを登録しました。キックオフは2027年1月5日(火) 17:00(あと6日)です。',
    );
  });
});

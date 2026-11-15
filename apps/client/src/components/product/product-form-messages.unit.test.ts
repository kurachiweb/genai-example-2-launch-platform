import { describe, expect, test } from 'bun:test';

import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  previousProductHandleGuidanceOf,
  productRegisteredMessageOf,
  screenshotAltOf,
  screenshotRemoveLabelOf,
  screenshotTotalsOf,
} from './product-form-messages.ts';

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

describe('previousProductHandleGuidanceOf', () => {
  test('以前のハンドルを含め、転送が続く条件を示す', () => {
    expect(previousProductHandleGuidanceOf('old-notes')).toBe(
      '以前のハンドルold-notesは、次にハンドルを変更するか他のプロダクトが同じハンドルを設定するまで、新しいURLへ転送されます。',
    );
  });
});

describe('スクリーンショットの文言', () => {
  test('代替テキストは位置の番号を付け、取り除くボタンの名前はその後に「を取り除く」を続ける', () => {
    expect(screenshotAltOf(2)).toBe('スクリーンショット2');
    expect(screenshotRemoveLabelOf(3)).toBe('スクリーンショット3を取り除く');
  });

  test('枚数と合計の容量を、それぞれの上限とともに示す', () => {
    expect(screenshotTotalsOf(3, 4_500_000)).toBe('3/20枚・4.3MB/10MB');
  });
});

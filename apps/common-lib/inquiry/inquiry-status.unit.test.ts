import { describe, expect, test } from 'bun:test';

import { INQUIRY_STATUS_LABELS, INQUIRY_STATUSES } from './inquiry-status.ts';

describe('対応ステータス', () => {
  test('未対応・対応中・対応済・却下の順に並ぶ', () => {
    expect(INQUIRY_STATUSES).toEqual([
      'open',
      'in_progress',
      'resolved',
      'rejected',
    ]);
  });

  test('一覧を書き換えられない', () => {
    expect(Object.isFrozen(INQUIRY_STATUSES)).toBe(true);
  });

  test('4種のステータスの表示名を持つ', () => {
    expect(INQUIRY_STATUS_LABELS).toEqual({
      open: '未対応',
      in_progress: '対応中',
      resolved: '対応済',
      rejected: '却下',
    });
    expect(Object.isFrozen(INQUIRY_STATUS_LABELS)).toBe(true);
  });
});

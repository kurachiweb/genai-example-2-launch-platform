import { describe, expect, test } from 'bun:test';

import type { LaunchDateWindowView } from '../../graphql/my-products.ts';
import { unavailableReasonOn } from './launch-date-calendar.ts';

const WINDOW: LaunchDateWindowView = {
  earliest: '2026-11-16',
  latest: '2027-02-07',
  unavailable: [
    { from: '2026-11-09', to: '2026-11-10', reason: 'pairing_deadline' },
    { from: '2026-11-11', to: '2026-11-15', reason: 'relaunch_interval' },
    { from: '2027-02-08', to: '2027-02-08', reason: 'out_of_range' },
  ],
  relaunchIntervalDays: 7,
};

describe('unavailableReasonOn', () => {
  test('選べない範囲(両端を含む)の日は、その範囲の理由を返す', () => {
    expect(unavailableReasonOn(WINDOW, '2026-11-09')).toBe('pairing_deadline');
    expect(unavailableReasonOn(WINDOW, '2026-11-10')).toBe('pairing_deadline');
    expect(unavailableReasonOn(WINDOW, '2026-11-11')).toBe('relaunch_interval');
    expect(unavailableReasonOn(WINDOW, '2026-11-15')).toBe('relaunch_interval');
    expect(unavailableReasonOn(WINDOW, '2027-02-08')).toBe('out_of_range');
  });

  test('最も早い日から最も遅い日までの範囲外の日は、前ならペアリングの締め切り、後なら選べる期間の外とする', () => {
    expect(unavailableReasonOn(WINDOW, '2026-11-01')).toBe('pairing_deadline');
    expect(unavailableReasonOn(WINDOW, '2027-03-01')).toBe('out_of_range');
  });

  test('選べる日はundefinedを返す', () => {
    expect(unavailableReasonOn(WINDOW, '2026-11-16')).toBeUndefined();
    expect(unavailableReasonOn(WINDOW, '2027-02-07')).toBeUndefined();
  });
});

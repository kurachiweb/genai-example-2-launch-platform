import { describe, expect, test } from 'bun:test';

import { MATCH_EVENT_STATUSES, MATCH_EVENT_TYPES } from './match-events.ts';

describe('マッチイベントの値の一覧', () => {
  test('種類は予定・開始・確定の3つで、変更できない', () => {
    expect([...MATCH_EVENT_TYPES]).toEqual(['scheduled', 'started', 'decided']);
    expect(Object.isFrozen(MATCH_EVENT_TYPES)).toBe(true);
  });

  test('状態は未完了と完了の2つで、変更できない', () => {
    expect([...MATCH_EVENT_STATUSES]).toEqual(['pending', 'completed']);
    expect(Object.isFrozen(MATCH_EVENT_STATUSES)).toBe(true);
  });
});

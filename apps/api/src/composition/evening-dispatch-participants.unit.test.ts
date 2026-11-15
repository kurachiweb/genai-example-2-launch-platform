import { describe, expect, test } from 'bun:test';

import { assertEveningDispatchParticipants } from '../../lib/core/notifications/evening-dispatch.ts';
import { EVENING_DISPATCH_PARTICIPANTS } from './evening-dispatch-participants.ts';

describe('夜の枠の送り出しの前提の登録口', () => {
  test('初版の登録口は空である', () => {
    expect(EVENING_DISPATCH_PARTICIPANTS).toStrictEqual([]);
  });

  test('登録は<spec名>.<名詞句>の名前で重複しない', () => {
    expect(() => {
      assertEveningDispatchParticipants(EVENING_DISPATCH_PARTICIPANTS);
    }).not.toThrow();
  });
});

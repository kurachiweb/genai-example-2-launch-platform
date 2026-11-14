import { describe, expect, test } from 'bun:test';

import { EVENT_INQUIRY_TYPES } from './event-inquiry-types.ts';

describe('EVENT_INQUIRY_TYPES', () => {
  test('識別子はグローバルのシンボル登録簿のinquiry.event.<名前>である', () => {
    expect(Object.keys(EVENT_INQUIRY_TYPES)).toEqual([
      'MemberInquiryPurgeStore',
      'MemberInquiryPurgeHandler',
    ]);
    for (const [name, identifier] of Object.entries(EVENT_INQUIRY_TYPES)) {
      expect<symbol>(identifier).toBe(Symbol.for(`inquiry.event.${name}`));
    }
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(EVENT_INQUIRY_TYPES)).toBe(true);
  });
});

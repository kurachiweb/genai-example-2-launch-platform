import { describe, expect, test } from 'bun:test';

import { MAIL_SEND_POLICY } from './mail-send-policy.ts';

describe('MAIL_SEND_POLICY', () => {
  test('1時間に宛先ごと3回・IPアドレスごと5回までとする', () => {
    expect(MAIL_SEND_POLICY).toEqual({
      windowSeconds: 3600,
      limitPerAddress: 3,
      limitPerIp: 5,
    });
    expect(Object.isFrozen(MAIL_SEND_POLICY)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';

import { EMAIL_SEND_MESSAGE } from '../../email/send-message.ts';
import { MESSAGE_CONTRACTS } from './index.ts';

describe('MESSAGE_CONTRACTS', () => {
  test('集約した契約に種別の重複が無い', () => {
    const types = MESSAGE_CONTRACTS.map((contract) => contract.type);
    const duplicatedTypes = types.filter(
      (type, index) => types.indexOf(type) !== index,
    );

    expect(duplicatedTypes).toEqual([]);
  });

  test('メール送信の契約email.sendを集約している', () => {
    expect(MESSAGE_CONTRACTS).toContain(EMAIL_SEND_MESSAGE);
  });

  test('集約点は凍結されていて実行時に契約を追加できない', () => {
    expect(Object.isFrozen(MESSAGE_CONTRACTS)).toBe(true);
  });
});

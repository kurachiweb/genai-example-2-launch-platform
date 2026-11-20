import { describe, expect, test } from 'bun:test';

import { createModerationWriteParticipants } from '../infrastructure/moderation/moderation-write-participant.ts';
import { MODERATION_WRITE_PARTICIPANTS } from './moderation-write-participants.ts';

describe('措置の書き込みの参加者の登録口', () => {
  test('初版は参加者を登録しない', () => {
    expect(MODERATION_WRITE_PARTICIPANTS).toStrictEqual([]);
  });

  test('登録は<spec名>.<名詞句>の種類で重複せず、解決の部品を組み立てられる', () => {
    expect(() =>
      createModerationWriteParticipants(MODERATION_WRITE_PARTICIPANTS, () => {
        throw new Error('登録の検証だけを確かめるため、参加者は解決しない');
      }),
    ).not.toThrow();
  });
});

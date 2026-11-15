import { describe, expect, test } from 'bun:test';

import { VOTER_ID, voterOf } from './testing/upvote-fakes.ts';
import { upvoteViewerOf } from './upvote-viewer.ts';

describe('upvoteViewerOf', () => {
  test('未ログインの閲覧者はnullにする', () => {
    expect(upvoteViewerOf(undefined)).toBeNull();
  });

  test('有効で確認済みの利用者は、書き込めて確認済みの閲覧者にする', () => {
    expect(upvoteViewerOf(voterOf())).toEqual({
      userId: VOTER_ID,
      emailVerified: true,
      writable: true,
    });
  });

  test('メールアドレスが未確認なら、確認済みでない閲覧者にする', () => {
    expect(upvoteViewerOf(voterOf({ emailVerifiedAt: null }))).toEqual({
      userId: VOTER_ID,
      emailVerified: false,
      writable: true,
    });
  });

  test.each([
    ['停止中', { status: 'suspended' as const }],
    ['退会済み', { deletedAt: new Date('2027-03-02T00:00:00.000Z') }],
  ])('%sの利用者は書き込めない閲覧者にする', (_label, overrides) => {
    expect(upvoteViewerOf(voterOf(overrides))?.writable).toBe(false);
  });
});

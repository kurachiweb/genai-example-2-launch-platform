import { describe, expect, test } from 'bun:test';

import type { MatchPhase } from '../../../lib/core/match/match-model.ts';
import { decideUpvote, viewerRestriction } from './upvote-plan.ts';

describe('decideUpvote', () => {
  test('有効なUpvoteが無ければ対象の側への追加になる', () => {
    expect(
      decideUpvote({ currentEntryId: null, targetEntryId: 'entry-a' }),
    ).toEqual({ kind: 'insert', entryId: 'entry-a' });
  });

  test('もう一方の側にUpvote済みなら新しい側への付け替えになる', () => {
    expect(
      decideUpvote({ currentEntryId: 'entry-a', targetEntryId: 'entry-b' }),
    ).toEqual({ kind: 'switch', fromEntryId: 'entry-a', toEntryId: 'entry-b' });
  });

  test('既に同じ側にUpvote済みなら変更なしになり重複を記録しない', () => {
    expect(
      decideUpvote({ currentEntryId: 'entry-a', targetEntryId: 'entry-a' }),
    ).toEqual({ kind: 'none' });
  });
});

const VIEWER = { userId: 'user-1', emailVerified: true, writable: true };

const restrictionOf = (input: {
  readonly viewer?: typeof VIEWER | null;
  readonly phase?: MatchPhase;
  readonly ownerUserIds?: readonly (string | null)[];
}) =>
  viewerRestriction({
    viewer: input.viewer === undefined ? VIEWER : input.viewer,
    phase: input.phase ?? 'live',
    ownerUserIds: input.ownerUserIds ?? ['owner-1', 'owner-2'],
  });

describe('viewerRestriction の制限なし', () => {
  test('マッチ中に確認済みで書き込める他人のマッチの閲覧者には制限が無い', () => {
    expect(restrictionOf({})).toBeNull();
  });

  test('紐付けを解除した側の投稿者が無くても他人のマッチとして扱う', () => {
    expect(restrictionOf({ ownerUserIds: [null, 'owner-2'] })).toBeNull();
  });
});

describe('viewerRestriction の各制限', () => {
  test.each(['scheduled', 'tallying', 'finished'] as const)(
    '段階が%sならUpvoteを受け付けていない',
    (phase) => {
      expect(restrictionOf({ phase })).toBe('not_accepting');
    },
  );

  test('ログインしていなければ未ログイン', () => {
    expect(restrictionOf({ viewer: null })).toBe('guest');
  });

  test('停止中・退会済みで書き込めなければ利用者の状態による制限', () => {
    expect(restrictionOf({ viewer: { ...VIEWER, writable: false } })).toBe(
      'account_unavailable',
    );
  });

  test('メールアドレスを確認していなければ未確認', () => {
    expect(restrictionOf({ viewer: { ...VIEWER, emailVerified: false } })).toBe(
      'email_not_verified',
    );
  });

  test.each([
    ['一方の側', ['user-1', 'owner-2']],
    ['もう一方の側', ['owner-1', 'user-1']],
    ['両方の側', ['user-1', 'user-1']],
    ['唯一の側', ['user-1']],
  ] as const)('閲覧者が%sの投稿者なら自分のマッチ', (_label, ownerUserIds) => {
    expect(restrictionOf({ ownerUserIds })).toBe('own_match');
  });
});

describe('viewerRestriction の判定の順', () => {
  const NO_ACCOUNT = {
    userId: 'user-1',
    emailVerified: false,
    writable: false,
  };

  test('受け付け中でなければ未ログインより先に受け付けていないと判定する', () => {
    expect(restrictionOf({ viewer: null, phase: 'tallying' })).toBe(
      'not_accepting',
    );
  });

  test('受け付け中でなければ利用者の状態と自分のマッチより先に判定する', () => {
    expect(
      restrictionOf({
        viewer: NO_ACCOUNT,
        phase: 'finished',
        ownerUserIds: ['user-1', 'owner-2'],
      }),
    ).toBe('not_accepting');
  });

  test('停止中は未確認と自分のマッチより先に判定する', () => {
    expect(
      restrictionOf({
        viewer: NO_ACCOUNT,
        ownerUserIds: ['user-1', 'owner-2'],
      }),
    ).toBe('account_unavailable');
  });

  test('未確認は自分のマッチより先に判定する', () => {
    expect(
      restrictionOf({
        viewer: { ...VIEWER, emailVerified: false },
        ownerUserIds: ['user-1', 'owner-2'],
      }),
    ).toBe('email_not_verified');
  });
});

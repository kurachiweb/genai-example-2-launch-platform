import { describe, expect, test } from 'bun:test';

import type { AdminModerationMatchView } from '../../../graphql/admin-moderation-products.ts';
import {
  matchKindLabel,
  matchOpponentLabel,
  matchResultLabel,
  matchRoundLabel,
  matchUpvoteLabel,
} from './match-result-labels.ts';

const matchOf = (
  overrides: Partial<AdminModerationMatchView> = {},
): AdminModerationMatchView => ({
  id: '01KA0MATCH0000000000000001',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: '2026-11-10',
  upvoteCount: 1234,
  result: 'won',
  phase: 'finished',
  decision: 'votes',
  opponentName: 'Tactics Board',
  ...overrides,
});

describe('種別', () => {
  test.each([
    ['qualifier', '予選'],
    ['week', 'Weekトーナメント'],
    ['year', 'Yearトーナメント'],
    ['exhibition', 'exhibition'],
  ])('%sは「%s」と示す', (kind, expected) => {
    expect(matchKindLabel(kind)).toBe(expected);
  });
});

describe('ラウンド', () => {
  test('予選はラウンドを持たないため「—」と示す', () => {
    expect(matchRoundLabel(matchOf({ round: 1 }))).toBe('—');
  });

  test.each([
    [{ round: 1, stage: null }, '1回戦'],
    [{ round: 2, stage: null }, '2回戦'],
    [{ round: 3, stage: 'quarterfinal' }, '準々決勝'],
    [{ round: 4, stage: 'semifinal' }, '準決勝'],
    [{ round: 5, stage: 'final' }, '決勝'],
    [{ round: null, stage: null }, '—'],
    [{ round: 2, stage: 'unknown' }, '2回戦'],
  ])('トーナメントの%oは「%s」と示す', (round, expected) => {
    expect(matchRoundLabel(matchOf({ kind: 'week', ...round }))).toBe(expected);
  });
});

describe('対戦相手とUpvote数', () => {
  test('相手のいるマッチは相手の名称とUpvote数を3桁区切りで示す', () => {
    const match = matchOf();
    expect(matchOpponentLabel(match)).toBe('Tactics Board');
    expect(matchUpvoteLabel(match)).toBe('1,234');
  });

  test('表示できない相手は「非公開のプロダクト」と示す', () => {
    expect(matchOpponentLabel(matchOf({ opponentName: null }))).toBe(
      '非公開のプロダクト',
    );
  });

  test('相手のいない不戦勝は対戦相手とUpvote数を「—」と示す', () => {
    const match = matchOf({ result: 'bye', opponentName: null });
    expect(matchOpponentLabel(match)).toBe('—');
    expect(matchUpvoteLabel(match)).toBe('—');
  });
});

describe('勝敗', () => {
  test.each([
    ['won', 'votes', '勝利'],
    ['won', 'last_upvote', '勝利'],
    ['lost', 'votes', '敗北'],
    ['lost', 'last_upvote', '敗北'],
    ['lost', 'walkover', '敗北'],
    ['lost', 'no_votes', '両者敗北'],
    ['lost', 'both_forfeited', '両者敗北'],
    ['bye', 'bye', '不戦勝'],
    ['walkover', 'walkover', '不戦勝'],
    ['draw', 'votes', 'draw'],
  ])('%sの結果で決着が%sなら「%s」と示す', (result, decision, expected) => {
    expect(matchResultLabel(matchOf({ result, decision }))).toBe(expected);
  });

  test.each([
    ['scheduled', '予定'],
    ['live', 'マッチ中'],
    ['tallying', 'マッチ中'],
  ])(
    '確定していないマッチは、進み具合が%sなら「%s」と示す',
    (phase, expected) => {
      expect(
        matchResultLabel(matchOf({ result: null, decision: null, phase })),
      ).toBe(expected);
    },
  );
});

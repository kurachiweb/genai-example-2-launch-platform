import { describe, expect, test } from 'bun:test';

import {
  HIDDEN_PRODUCT_NAME,
  TALLYING_LABEL,
  matchResultLabel,
  matchStageLabel,
  voteBarLabel,
} from './match-labels.ts';

describe('matchStageLabel', () => {
  test('予選は「予選」にする', () => {
    expect(
      matchStageLabel({ kind: 'QUALIFIER', round: null, stage: null }),
    ).toBe('予選');
  });

  test.each([
    ['WEEK', 3, 'FINAL', 'Week 決勝'],
    ['WEEK', 2, 'SEMIFINAL', 'Week 準決勝'],
    ['YEAR', 4, 'QUARTERFINAL', 'Year 準々決勝'],
  ] as const)(
    '段階の名前を持つ%sのラウンドは種別名と段階の名前を半角スペースで区切る(%s・%s)',
    (kind, round, stage, expected) => {
      expect(matchStageLabel({ kind, round, stage })).toBe(expected);
    },
  );

  test.each([
    ['WEEK', 1, 'Week 1回戦'],
    ['YEAR', 2, 'Year 2回戦'],
  ] as const)(
    '段階の名前を持たない%sのラウンドは「<数>回戦」にする(%s)',
    (kind, round, expected) => {
      expect(matchStageLabel({ kind, round, stage: null })).toBe(expected);
    },
  );

  test('トーナメントでラウンドが分からないときは種別名だけにする', () => {
    expect(matchStageLabel({ kind: 'YEAR', round: null, stage: null })).toBe(
      'Year',
    );
  });
});

describe('matchResultLabel', () => {
  test('Upvote数で決まった勝利は勝者のUpvote数を先に置く', () => {
    expect(
      matchResultLabel({
        decision: 'VOTES',
        winnerName: 'Pitch Notes',
        winnerVotes: 12,
        loserVotes: 9,
      }),
    ).toBe('フルタイム！12対9でPitch Notesの勝利');
  });

  test('最終Upvote時間で決まった勝利は注記を続ける', () => {
    expect(
      matchResultLabel({
        decision: 'LAST_UPVOTE',
        winnerName: 'Pitch Notes',
        winnerVotes: 7,
        loserVotes: 7,
      }),
    ).toBe('フルタイム！7対7でPitch Notesの勝利(最終Upvote時刻が早いため)');
  });

  test('0対0は両者敗北にする', () => {
    expect(matchResultLabel({ decision: 'NO_VOTES' })).toBe(
      'フルタイム。0対0で両者敗北',
    );
  });
});

describe('voteBarLabel', () => {
  test('左の側から順に各側の名称とUpvote数を示す', () => {
    expect(
      voteBarLabel({
        leftName: 'Pitch Notes',
        leftVotes: 12,
        rightName: 'Tactics Board',
        rightVotes: 9,
      }),
    ).toBe('Pitch Notes12票、Tactics Board9票');
  });

  test('0対0も同じ形で示す', () => {
    expect(
      voteBarLabel({
        leftName: HIDDEN_PRODUCT_NAME,
        leftVotes: 0,
        rightName: 'Tactics Board',
        rightVotes: 0,
      }),
    ).toBe('非公開のプロダクト0票、Tactics Board0票');
  });
});

describe('文言の定数', () => {
  test('集計中と表示できないプロダクトの文言を持つ', () => {
    expect(TALLYING_LABEL).toBe('結果を集計しています');
    expect(HIDDEN_PRODUCT_NAME).toBe('非公開のプロダクト');
  });
});

import { describe, expect, test } from 'bun:test';

import {
  finishedWinnerOf,
  matchHeadlineOf,
  siteRelOf,
  upvoteDisabledReasonOf,
} from './match-card-model.ts';
import { entryOf, matchOf } from './match-fixtures.ts';

const OWN_REASON = '自身のプロダクトとその対戦相手にはUpvoteできません。';
const NOT_ACCEPTING_REASON = 'このマッチはUpvoteを受け付けていません。';
const EMAIL_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';
const ACCOUNT_REASON =
  'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。';

describe('siteRelOf', () => {
  test('予選は未審査のプロダクトのため、外部Webサイトへのリンクにugcを付ける', () => {
    expect(siteRelOf('QUALIFIER')).toBe('noopener ugc');
  });

  test.each(['WEEK', 'YEAR'] as const)(
    '%sトーナメントはugcを付けない',
    (kind) => {
      expect(siteRelOf(kind)).toBe('noopener');
    },
  );
});

describe('upvoteDisabledReasonOf', () => {
  test.each([
    ['OWN_MATCH', OWN_REASON],
    ['NOT_ACCEPTING', NOT_ACCEPTING_REASON],
    ['EMAIL_NOT_VERIFIED', EMAIL_REASON],
    ['ACCOUNT_UNAVAILABLE', ACCOUNT_REASON],
  ] as const)('%sはボタンを無効にする理由を返す', (restriction, reason) => {
    expect(upvoteDisabledReasonOf(restriction)).toBe(reason);
  });

  test('制限が無い閲覧者と、押下でログインへ誘導する未ログインの閲覧者には理由を返さない', () => {
    expect(upvoteDisabledReasonOf(null)).toBeNull();
    expect(upvoteDisabledReasonOf('GUEST')).toBeNull();
  });
});

describe('finishedWinnerOf', () => {
  test('確定の前は勝者を決めない', () => {
    expect(finishedWinnerOf(matchOf({ phase: 'LIVE' }))).toBeNull();
    expect(finishedWinnerOf(matchOf({ phase: 'TALLYING' }))).toBeNull();
  });

  test('確定の後は勝利した側を返す', () => {
    const match = matchOf({
      phase: 'FINISHED',
      decision: 'VOTES',
      entries: [
        entryOf('left', { upvoteCount: 9, result: 'LOST' }),
        entryOf('right', { upvoteCount: 12, result: 'WON' }),
      ],
    });

    expect(finishedWinnerOf(match)).toBe('right');
  });

  test('両者敗北は勝者なしを返す', () => {
    const match = matchOf({
      phase: 'FINISHED',
      decision: 'NO_VOTES',
      entries: [
        entryOf('left', { upvoteCount: 0, result: 'LOST' }),
        entryOf('right', { upvoteCount: 0, result: 'LOST' }),
      ],
    });

    expect(finishedWinnerOf(match)).toBe('none');
  });
});

describe('matchHeadlineOf', () => {
  test('マッチ中は呼び出し元の補足を示す', () => {
    expect(matchHeadlineOf(matchOf({ phase: 'LIVE' }))).toStrictEqual({
      kind: 'caption',
    });
  });

  test('終了の時刻を過ぎて確定を待つ間は集計中を示す', () => {
    expect(matchHeadlineOf(matchOf({ phase: 'TALLYING' }))).toStrictEqual({
      kind: 'text',
      text: '結果を集計しています',
    });
  });

  test('Upvote数で決まった結果は、勝者のUpvote数を先に置いて勝者の名称を示す', () => {
    const match = matchOf({
      phase: 'FINISHED',
      decision: 'VOTES',
      entries: [
        entryOf('left', { upvoteCount: 9, result: 'LOST' }),
        entryOf('right', { upvoteCount: 12, result: 'WON' }),
      ],
    });

    expect(matchHeadlineOf(match)).toStrictEqual({
      kind: 'text',
      text: 'フルタイム！12対9でTactics Boardの勝利',
    });
  });

  test('最終Upvote時間で決まった結果には注記を添える', () => {
    const match = matchOf({
      phase: 'FINISHED',
      decision: 'LAST_UPVOTE',
      entries: [
        entryOf('left', { upvoteCount: 7, result: 'WON' }),
        entryOf('right', { upvoteCount: 7, result: 'LOST' }),
      ],
    });

    expect(matchHeadlineOf(match)).toStrictEqual({
      kind: 'text',
      text: 'フルタイム！7対7でPitch Notesの勝利(最終Upvote時刻が早いため)',
    });
  });

  test('0対0は両者敗北を示す', () => {
    const match = matchOf({
      phase: 'FINISHED',
      decision: 'NO_VOTES',
      entries: [
        entryOf('left', { upvoteCount: 0, result: 'LOST' }),
        entryOf('right', { upvoteCount: 0, result: 'LOST' }),
      ],
    });

    expect(matchHeadlineOf(match)).toStrictEqual({
      kind: 'text',
      text: 'フルタイム。0対0で両者敗北',
    });
  });

  test('表示できない側の勝利は、名称の代わりに「非公開のプロダクト」を示す', () => {
    const match = matchOf({
      phase: 'FINISHED',
      decision: 'VOTES',
      entries: [
        entryOf('left', { upvoteCount: 3, result: 'WON', product: null }),
        entryOf('right', { upvoteCount: 1, result: 'LOST' }),
      ],
    });

    expect(matchHeadlineOf(match)).toStrictEqual({
      kind: 'text',
      text: 'フルタイム！3対1で非公開のプロダクトの勝利',
    });
  });

  test.each(['BYE', 'WALKOVER', 'BOTH_FORFEITED'] as const)(
    '対戦カードにしない決着(%s)と開始前は何も示さない',
    (decision) => {
      expect(
        matchHeadlineOf(matchOf({ phase: 'FINISHED', decision })),
      ).toStrictEqual({ kind: 'none' });
      expect(matchHeadlineOf(matchOf({ phase: 'SCHEDULED' }))).toStrictEqual({
        kind: 'none',
      });
    },
  );
});

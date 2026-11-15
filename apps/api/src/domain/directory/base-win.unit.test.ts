import { describe, expect, test } from 'bun:test';

import type { EntryResult } from '../../../lib/core/match/match-model.ts';
import type {
  MatchEntryRecord,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { classifyBaseWin } from './base-win.ts';

const LAUNCH_ID = 'launch-1';

const entry = (
  overrides: Partial<MatchEntryRecord> = {},
): MatchEntryRecord => ({
  entryId: 'entry-1',
  slot: 1,
  launchId: LAUNCH_ID,
  productId: 'product-1',
  ownerUserId: 'owner-1',
  upvoteCount: 12,
  lastUpvotedAt: null,
  lastUpvoteElapsedMs: null,
  forfeited: false,
  result: 'won',
  ...overrides,
});

const opponent = (result: EntryResult | null): MatchEntryRecord =>
  entry({
    entryId: 'entry-2',
    slot: 2,
    launchId: 'launch-2',
    productId: 'product-2',
    ownerUserId: 'owner-2',
    upvoteCount: 3,
    result,
  });

const match = (overrides: Partial<MatchRecord> = {}): MatchRecord => ({
  matchId: 'match-1',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: parseBusinessDate('2026-09-15'),
  decision: 'votes',
  endedEarly: false,
  phase: 'finished',
  startsAt: new Date('2026-09-14T15:00:00.000Z'),
  endsAt: new Date('2026-09-15T14:40:00.000Z'),
  startedAt: new Date('2026-09-14T15:00:00.000Z'),
  decidedAt: new Date('2026-09-15T14:40:00.000Z'),
  entries: [entry(), opponent('lost')],
  ...overrides,
});

describe('classifyBaseWin', () => {
  test('Upvote数で勝った予選は勝利にする', () => {
    expect(classifyBaseWin(match(), LAUNCH_ID)).toBe('victory');
  });

  test('最終Upvote時間で勝った予選も勝利にする', () => {
    expect(classifyBaseWin(match({ decision: 'last_upvote' }), LAUNCH_ID)).toBe(
      'victory',
    );
  });

  test('対戦相手のいない不戦勝は不戦勝にする', () => {
    expect(
      classifyBaseWin(
        match({ decision: 'bye', entries: [entry({ result: 'bye' })] }),
        LAUNCH_ID,
      ),
    ).toBe('bye');
  });

  test('開始時点の相手の退会等による勝利は対戦相手のいない不戦勝にする', () => {
    expect(
      classifyBaseWin(
        match({
          decision: 'walkover',
          startedAt: null,
          entries: [
            entry({ result: 'walkover', upvoteCount: 0 }),
            opponent('lost'),
          ],
        }),
        LAUNCH_ID,
      ),
    ).toBe('bye');
  });

  test('マッチ中の相手の退会等による勝利は早期の不戦勝にする', () => {
    expect(
      classifyBaseWin(
        match({
          decision: 'walkover',
          endedEarly: true,
          entries: [entry({ result: 'walkover' }), opponent('lost')],
        }),
        LAUNCH_ID,
      ),
    ).toBe('early');
  });

  test('側の番号に依らずローンチのIDで自分の側を選ぶ', () => {
    expect(
      classifyBaseWin(
        match({
          decision: 'walkover',
          endedEarly: true,
          entries: [opponent('lost'), entry({ slot: 2, result: 'walkover' })],
        }),
        LAUNCH_ID,
      ),
    ).toBe('early');
  });

  test('マッチを読めなければ記録の数をそのまま出せる勝利にする', () => {
    expect(classifyBaseWin(undefined, LAUNCH_ID)).toBe('victory');
  });

  test('ローンチの側が無いマッチは勝利にする', () => {
    expect(classifyBaseWin(match(), 'launch-unknown')).toBe('victory');
  });

  test.each([['lost'], [null]] as const)(
    '自分の側の結果が勝ちでない(%s)マッチは基準勝利にできず例外にする',
    (result) => {
      expect(() =>
        classifyBaseWin(match({ entries: [entry({ result })] }), LAUNCH_ID),
      ).toThrow(RangeError);
    },
  );
});

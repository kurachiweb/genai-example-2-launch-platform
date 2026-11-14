import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import {
  LIVE_MATCH_ENDS_AT,
  liveMatchOf,
  productLiveMatchOf,
  type ProductLiveMatchView,
} from './live-match-fixtures.ts';
import { historyLaunchOf } from './match-history-fixtures.ts';
import {
  canLiveMatchChange,
  hasLiveMatchAutoUpdates,
  heldLiveMatchOf,
  isLiveMatchFollowUpExhausted,
  liveMatchBoundariesOf,
  liveMatchRefetchIntervalOf,
} from './live-match-refresh.ts';

const LIVE = productLiveMatchOf();

const TALLYING = productLiveMatchOf({
  awaitingChange: true,
  match: liveMatchOf({ phase: 'TALLYING' }),
});

const AWAITING_KICKOFF = productLiveMatchOf({
  awaitingChange: true,
  match: null,
});

const NO_MATCH = productLiveMatchOf({ match: null });

const intervalOf = (
  liveMatch: ProductLiveMatchView | null | undefined,
  autoRefresh: boolean,
  updatesSinceBaseline = 0,
) =>
  liveMatchRefetchIntervalOf({ liveMatch, autoRefresh, updatesSinceBaseline });

describe('liveMatchRefetchIntervalOf', () => {
  test.each([
    ['マッチ中', LIVE],
    ['集計中', TALLYING],
    ['マッチの開始待ち', AWAITING_KICKOFF],
  ])(
    '自動更新がオンで%sなら、回数によらず定期再取得の間隔を返す',
    (_label, liveMatch) => {
      expect(intervalOf(liveMatch, true, FOLLOW_UP_REFETCH_LIMIT * 3)).toBe(
        LIVE_REFRESH_INTERVAL_MS,
      );
    },
  );

  test('自動更新がオフなら、マッチ中で変化を待たない間は止める', () => {
    expect(intervalOf(LIVE, false)).toBe(false);
  });

  test.each([
    ['集計中', TALLYING],
    ['マッチの開始待ち', AWAITING_KICKOFF],
  ])(
    '自動更新がオフでも%sなら、基準の時点からの更新が上限に達するまで間隔を返し、達したら止める',
    (_label, liveMatch) => {
      expect(intervalOf(liveMatch, false, 0)).toBe(LIVE_REFRESH_INTERVAL_MS);
      expect(intervalOf(liveMatch, false, FOLLOW_UP_REFETCH_LIMIT - 1)).toBe(
        LIVE_REFRESH_INTERVAL_MS,
      );
      expect(intervalOf(liveMatch, false, FOLLOW_UP_REFETCH_LIMIT)).toBe(false);
    },
  );

  test.each([
    ['開催中のマッチも変化を待つ状態も無い', NO_MATCH],
    ['表示できないプロダクト', null],
    ['取得した値が無い', undefined],
  ])('%s時は自動更新がオンでも止める', (_label, liveMatch) => {
    expect(intervalOf(liveMatch, true)).toBe(false);
  });
});

describe('isLiveMatchFollowUpExhausted', () => {
  test('自動更新がオフで変化を待ったまま上限に達した時だけ真にする', () => {
    const of = (
      liveMatch: ProductLiveMatchView | null | undefined,
      autoRefresh: boolean,
      updatesSinceBaseline: number,
    ) =>
      isLiveMatchFollowUpExhausted({
        liveMatch,
        autoRefresh,
        updatesSinceBaseline,
      });

    expect(of(TALLYING, false, FOLLOW_UP_REFETCH_LIMIT)).toBe(true);
    expect(of(AWAITING_KICKOFF, false, FOLLOW_UP_REFETCH_LIMIT + 3)).toBe(true);
    expect(of(TALLYING, false, FOLLOW_UP_REFETCH_LIMIT - 1)).toBe(false);
    expect(of(TALLYING, true, FOLLOW_UP_REFETCH_LIMIT * 2)).toBe(false);
    expect(of(LIVE, false, FOLLOW_UP_REFETCH_LIMIT)).toBe(false);
    expect(of(undefined, false, FOLLOW_UP_REFETCH_LIMIT)).toBe(false);
  });
});

describe('canLiveMatchChange', () => {
  test('マッチ中か変化を待つ状態の時だけ真にする', () => {
    expect(canLiveMatchChange(LIVE)).toBe(true);
    expect(canLiveMatchChange(TALLYING)).toBe(true);
    expect(canLiveMatchChange(AWAITING_KICKOFF)).toBe(true);
    expect(
      canLiveMatchChange(
        productLiveMatchOf({ match: liveMatchOf({ phase: 'TALLYING' }) }),
      ),
    ).toBe(false);
    expect(canLiveMatchChange(NO_MATCH)).toBe(false);
    expect(canLiveMatchChange(null)).toBe(false);
    expect(canLiveMatchChange(undefined)).toBe(false);
  });
});

describe('heldLiveMatchOf', () => {
  test('マッチ中と集計中のマッチを返し、確定したマッチと無いマッチはnullにする', () => {
    expect(heldLiveMatchOf(LIVE)).toBe(LIVE.match);
    expect(heldLiveMatchOf(TALLYING)).toBe(TALLYING.match);
    expect(
      heldLiveMatchOf(
        productLiveMatchOf({ match: liveMatchOf({ phase: 'FINISHED' }) }),
      ),
    ).toBeNull();
    expect(heldLiveMatchOf(NO_MATCH)).toBeNull();
    expect(heldLiveMatchOf(null)).toBeNull();
  });
});

describe('hasLiveMatchAutoUpdates', () => {
  test('開催中のマッチがあるか変化を待つ状態の間だけ真にする', () => {
    expect(hasLiveMatchAutoUpdates(LIVE)).toBe(true);
    expect(hasLiveMatchAutoUpdates(TALLYING)).toBe(true);
    expect(hasLiveMatchAutoUpdates(AWAITING_KICKOFF)).toBe(true);
    expect(hasLiveMatchAutoUpdates(NO_MATCH)).toBe(false);
    expect(hasLiveMatchAutoUpdates(null)).toBe(false);
  });
});

describe('liveMatchBoundariesOf', () => {
  test('開催中のマッチの終了の時刻と、キックオフ前の予約済みのローンチのキックオフの時刻を返す', () => {
    const launches = [
      historyLaunchOf({
        id: 'launch-3',
        kickoffAt: '2026-11-20T15:00:00.000Z',
        kickedOff: false,
        status: 'SCHEDULED',
      }),
      historyLaunchOf({
        id: 'launch-2',
        kickoffAt: '2026-11-12T15:00:00.000Z',
        kickedOff: false,
        status: 'PAIRED',
      }),
      historyLaunchOf({
        id: 'launch-canceled',
        kickoffAt: '2026-11-11T15:00:00.000Z',
        kickedOff: false,
        status: 'CANCELED',
      }),
      historyLaunchOf({
        id: 'launch-1',
        kickoffAt: '2026-11-09T15:00:00.000Z',
        kickedOff: true,
        status: 'IN_PROGRESS',
      }),
    ];

    expect(liveMatchBoundariesOf(LIVE, launches)).toStrictEqual([
      LIVE_MATCH_ENDS_AT,
      '2026-11-20T15:00:00.000Z',
      '2026-11-12T15:00:00.000Z',
    ]);
    expect(liveMatchBoundariesOf(NO_MATCH, launches)).toStrictEqual([
      '2026-11-20T15:00:00.000Z',
      '2026-11-12T15:00:00.000Z',
    ]);
    expect(liveMatchBoundariesOf(undefined, [])).toStrictEqual([]);
  });
});

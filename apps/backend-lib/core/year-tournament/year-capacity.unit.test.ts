import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import { bracketLayout, type SlotFeed } from '../tournament/bracket-layout.ts';
import {
  type BracketDrawResult,
  type DrawCandidate,
  drawBracket,
} from '../tournament/bracket-draw-rules.ts';
import {
  type LaunchOrderingKey,
  launchNonSeedOrder,
  launchSeedOrder,
} from '../tournament/launch-ordering.ts';
import { dailyRoundPolicy } from '../tournament/round-schedule.ts';
import { selectWithinCapacity } from './year-capacity.ts';
import {
  YEAR_MAX_PARTICIPANTS,
  yearFirstRoundDate,
  yearScheduleFor,
} from './year-schedule.ts';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const ORDER = { seed: launchSeedOrder, nonSeed: launchNonSeedOrder } as const;
const FIRST_AWARDED_AT = Date.parse('2025-05-25T14:40:00.000Z');

interface CapacityEntry {
  readonly ref: string;
  readonly awardedAt: Date;
  readonly tieBreaker: string;
}

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function entryIdOf(index: number): string {
  return `01JD0YE0E00000000000000${String(index).padStart(3, '0')}`;
}

function weekTournamentIdOf(index: number): string {
  return `01JD0WT0T00000000000000${String(index).padStart(3, '0')}`;
}

function launchIdOf(index: number): string {
  return `01JD0PR0D00000000000000${String(index).padStart(3, '0')}`;
}

// 番号が大きいほどWeek優勝の日時が新しい
function weeklyEntry(index: number): CapacityEntry {
  return {
    ref: entryIdOf(index),
    awardedAt: new Date(FIRST_AWARDED_AT + index * 7 * MILLISECONDS_PER_DAY),
    tieBreaker: weekTournamentIdOf(index),
  };
}

function weeklyEntries(count: number): readonly CapacityEntry[] {
  return Array.from({ length: count }, (_, index) => weeklyEntry(index + 1));
}

function refsOf(entries: readonly CapacityEntry[]): readonly string[] {
  return entries.map(({ ref }) => ref);
}

describe('selectWithinCapacity', () => {
  test('上限ちょうどの64件はすべて残し、超過は無い', () => {
    const entries = weeklyEntries(YEAR_MAX_PARTICIPANTS);

    const result = selectWithinCapacity(entries, YEAR_MAX_PARTICIPANTS);

    expect(result.kept).toHaveLength(64);
    expect(new Set(refsOf(result.kept))).toEqual(new Set(refsOf(entries)));
    expect(result.overflow).toEqual([]);
  });

  test('65件ではWeek優勝の日時が最も古い1件だけが外れる', () => {
    const entries = weeklyEntries(YEAR_MAX_PARTICIPANTS + 1);

    const result = selectWithinCapacity(entries, YEAR_MAX_PARTICIPANTS);

    expect(result.kept).toHaveLength(64);
    expect(refsOf(result.overflow)).toEqual([entryIdOf(1)]);
    expect(refsOf(result.kept)).not.toContain(entryIdOf(1));
  });

  test('残す枠はWeek優勝の日時の新しい順、外れる枠も同じ順に並ぶ', () => {
    const result = selectWithinCapacity(weeklyEntries(5), 3);

    expect(refsOf(result.kept)).toEqual([
      entryIdOf(5),
      entryIdOf(4),
      entryIdOf(3),
    ]);
    expect(refsOf(result.overflow)).toEqual([entryIdOf(2), entryIdOf(1)]);
  });

  test('境界の枠が同時刻なら識別子(tieBreaker)の昇順で先の枠を残す', () => {
    const newer = weeklyEntries(YEAR_MAX_PARTICIPANTS - 1).map((entry) => ({
      ...entry,
      awardedAt: new Date(entry.awardedAt.getTime() + MILLISECONDS_PER_DAY),
    }));
    const tiedAt = new Date(FIRST_AWARDED_AT);
    // tieBreakerの順とrefの順を逆にし、refで決めた場合と区別する
    const laterTieBreaker = {
      ref: 'a-tie',
      awardedAt: tiedAt,
      tieBreaker: 'B',
    };
    const earlierTieBreaker = {
      ref: 'z-tie',
      awardedAt: tiedAt,
      tieBreaker: 'A',
    };

    const result = selectWithinCapacity(
      [laterTieBreaker, ...newer, earlierTieBreaker],
      YEAR_MAX_PARTICIPANTS,
    );

    expect(refsOf(result.overflow)).toEqual(['a-tie']);
    expect(refsOf(result.kept).at(-1)).toBe('z-tie');
  });

  test('同時刻・同じtieBreakerなら入力の並びによらずrefの昇順で決める', () => {
    const tiedAt = new Date(FIRST_AWARDED_AT);
    const first = { ref: 'first', awardedAt: tiedAt, tieBreaker: 'same' };
    const second = { ref: 'second', awardedAt: tiedAt, tieBreaker: 'same' };

    const results = [
      selectWithinCapacity([second, first], 1),
      selectWithinCapacity([first, second], 1),
    ];

    for (const result of results) {
      expect(refsOf(result.kept)).toEqual(['first']);
      expect(refsOf(result.overflow)).toEqual(['second']);
    }
  });

  test('入力の並びによらず同じ枠を選ぶ', () => {
    const entries = weeklyEntries(YEAR_MAX_PARTICIPANTS + 3);

    const first = selectWithinCapacity(entries, YEAR_MAX_PARTICIPANTS);
    const reversed = selectWithinCapacity(
      [...entries].reverse(),
      YEAR_MAX_PARTICIPANTS,
    );

    expect(reversed).toEqual(first);
    expect(refsOf(first.overflow)).toEqual([
      entryIdOf(3),
      entryIdOf(2),
      entryIdOf(1),
    ]);
  });

  test('入力の配列を書き換えない', () => {
    const entries = weeklyEntries(4);
    const snapshot = [...entries];

    selectWithinCapacity([...entries].reverse(), 2);

    expect(entries).toEqual(snapshot);
  });

  test('空の入力は空を返す', () => {
    expect(selectWithinCapacity([], YEAR_MAX_PARTICIPANTS)).toEqual({
      kept: [],
      overflow: [],
    });
  });

  test.each([-1, 1.5, Number.NaN])(
    '上限が0以上の整数でなければ例外にする: %p',
    (max) => {
      expect(() => selectWithinCapacity(weeklyEntries(2), max)).toThrow(
        RangeError,
      );
    },
  );
});

function elapsed(clock: string): number {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return (hour * 60 + minute) * MILLISECONDS_PER_MINUTE;
}

function key(
  launchDate: string,
  upvoteCount: number,
  lastUpvote: string | null,
): LaunchOrderingKey {
  return {
    launchDate: date(launchDate),
    upvoteCount,
    lastUpvoteElapsedMs: lastUpvote === null ? null : elapsed(lastUpvote),
  };
}

function refsInNumberOrder(result: BracketDrawResult): readonly string[] {
  return result.participants.map(({ ref }) => ref);
}

function firstRoundPairs(
  result: BracketDrawResult,
): readonly (readonly [string, string])[] {
  const refByNo = new Map(
    result.participants.map(({ ref, participantNo }) => [participantNo, ref]),
  );
  return bracketLayout(result.shape)
    .filter(({ round }) => round === 1)
    .map(({ feeds }) =>
      feeds.map((feed) =>
        feed.kind === 'participant'
          ? (refByNo.get(feed.participantNo) ?? '')
          : '',
      ),
    )
    .map(([first = '', second = '']) => [first, second] as const);
}

function feedLabel(
  feed: SlotFeed,
  refByNo: ReadonlyMap<number, string>,
): string {
  if (feed.kind === 'participant') {
    return refByNo.get(feed.participantNo) ?? '';
  }
  return `R${String(feed.round)}M${String(feed.position)}勝者`;
}

function roundPairs(
  result: BracketDrawResult,
  round: number,
): readonly (readonly [string, string])[] {
  const refByNo = new Map(
    result.participants.map(({ ref, participantNo }) => [participantNo, ref]),
  );
  return bracketLayout(result.shape)
    .filter((node) => node.round === round)
    .map(
      ({ feeds: [first, second] }) =>
        [feedLabel(first, refByNo), feedLabel(second, refByNo)] as const,
    );
}

// Yearトーナメント規則の「組み合わせの例(N = 13)」の表
const YEAR_N13_ROWS = [
  ['P1', '2025-05-27', 18, '12:00'],
  ['P2', '2025-07-02', 55, '19:30'],
  ['P3', '2025-07-31', 24, '08:15'],
  ['P4', '2025-09-03', 31, '22:10'],
  ['P5', '2025-10-01', 31, '15:45'],
  ['P6', '2025-11-05', 9, '17:00'],
  ['P7', '2025-12-10', 44, '10:20'],
  ['P8', '2026-01-14', 12, '23:05'],
  ['P9', '2026-02-18', 27, '09:30'],
  ['P10', '2026-03-18', 6, '20:40'],
  ['P11', '2026-04-08', 39, '13:55'],
  ['P12', '2026-04-15', 15, '11:10'],
  ['P13', '2026-04-29', 21, '16:35'],
] as const;

const YEAR_N13_CANDIDATES: readonly DrawCandidate<LaunchOrderingKey>[] =
  YEAR_N13_ROWS.map(([ref, launchDate, upvoteCount, lastUpvote], index) => ({
    ref,
    tieBreaker: launchIdOf(index + 1),
    value: key(launchDate, upvoteCount, lastUpvote),
  }));

describe('Yearトーナメント規則の組み合わせの例(N = 13)', () => {
  test('上限の内なので13件すべてを組み合わせの対象にする', () => {
    const entries = YEAR_N13_ROWS.map(([ref], index) => ({
      ...weeklyEntry(index + 1),
      ref,
    }));

    const result = selectWithinCapacity(entries, YEAR_MAX_PARTICIPANTS);

    expect(result.kept).toHaveLength(13);
    expect(result.overflow).toEqual([]);
  });

  test('シードはP2・P7・P11で、1回戦はP1×P3・P4×P5・P6×P8・P9×P10・P12×P13になる', () => {
    const result = drawBracket(YEAR_N13_CANDIDATES, ORDER);

    expect(result.shape.seedCount).toBe(3);
    expect(result.shape.secondRoundSize).toBe(8);
    expect(refsInNumberOrder(result).slice(0, 3)).toEqual(['P2', 'P7', 'P11']);
    expect(firstRoundPairs(result)).toEqual([
      ['P1', 'P3'],
      ['P4', 'P5'],
      ['P6', 'P8'],
      ['P9', 'P10'],
      ['P12', 'P13'],
    ]);
  });

  test('準々決勝はP2×M5勝者・M1勝者×M2勝者・P7×M4勝者・P11×M3勝者になる', () => {
    const result = drawBracket(YEAR_N13_CANDIDATES, ORDER);

    expect(roundPairs(result, 2)).toEqual([
      ['P2', 'R1M5勝者'],
      ['R1M1勝者', 'R1M2勝者'],
      ['P7', 'R1M4勝者'],
      ['P11', 'R1M3勝者'],
    ]);
    expect(roundPairs(result, 3)).toEqual([
      ['R2M1勝者', 'R2M2勝者'],
      ['R2M3勝者', 'R2M4勝者'],
    ]);
    expect(roundPairs(result, 4)).toEqual([['R3M1勝者', 'R3M2勝者']]);
  });

  test('決勝日2026-05-24なら組み合わせ決定は5月18日23:45、1回戦から決勝は5月21日〜24日になる', () => {
    const schedule = yearScheduleFor(2026, date('2026-05-24'));
    const firstRoundDate = yearFirstRoundDate(schedule.finalDate, 13);
    const policy = dailyRoundPolicy(
      firstRoundDate ?? schedule.finalDate,
      schedule.drawAt,
    );
    const quarterFinal = policy.nextRoundDate(
      policy.firstRoundDate,
      schedule.drawAt,
    );
    const semiFinal = policy.nextRoundDate(quarterFinal, schedule.drawAt);
    const final = policy.nextRoundDate(semiFinal, schedule.drawAt);

    expect(schedule.deadlineDate).toBe(date('2026-05-18'));
    expect(schedule.drawAt).toEqual(
      fromBusinessDateTime(date('2026-05-18'), { hour: 23, minute: 45 }),
    );
    expect([policy.firstRoundDate, quarterFinal, semiFinal, final]).toEqual([
      date('2026-05-21'),
      date('2026-05-22'),
      date('2026-05-23'),
      date('2026-05-24'),
    ]);
  });

  test('候補の並びによらず同じ組み合わせになる', () => {
    expect(drawBracket([...YEAR_N13_CANDIDATES].reverse(), ORDER)).toEqual(
      drawBracket(YEAR_N13_CANDIDATES, ORDER),
    );
  });
});

function candidate(
  ref: string,
  index: number,
  value: LaunchOrderingKey,
): DrawCandidate<LaunchOrderingKey> {
  return { ref, tieBreaker: launchIdOf(index), value };
}

describe('Yearトーナメントの組み合わせのタイブレーク', () => {
  test('非シードはローンチ日の早い順、同日ならUpvote数の多い順・最終Upvote時間の早い順・ローンチの識別子の昇順に並べる', () => {
    const result = drawBracket(
      [
        candidate('seed', 1, key('2025-06-04', 90, '10:00')),
        candidate('laterDay', 2, key('2025-08-07', 50, '09:00')),
        candidate('sameDayLateId', 7, key('2025-08-06', 10, '12:00')),
        candidate('sameDayEarlyId', 6, key('2025-08-06', 10, '12:00')),
        candidate('sameDayLaterUpvote', 3, key('2025-08-06', 10, '18:00')),
        candidate('sameDayMore', 4, key('2025-08-06', 11, '23:00')),
        candidate('earlierDay', 5, key('2025-07-02', 1, '23:59')),
      ],
      ORDER,
    );

    expect(result.shape.seedCount).toBe(1);
    expect(refsInNumberOrder(result)).toEqual([
      'seed',
      'earlierDay',
      'sameDayMore',
      'sameDayEarlyId',
      'sameDayLateId',
      'sameDayLaterUpvote',
      'laterDay',
    ]);
  });

  test('Upvote数0で最終Upvote時間が無い枠は、シードの選出で同数の末尾になる', () => {
    const result = drawBracket(
      [
        candidate('zeroEarly', 1, key('2025-06-04', 0, null)),
        candidate('zeroLater', 2, key('2025-09-10', 0, null)),
        candidate('zeroWithTime', 3, key('2025-09-17', 0, '23:59')),
        candidate('top', 4, key('2026-01-07', 3, '08:00')),
        candidate('one', 5, key('2025-09-11', 1, '00:01')),
      ],
      ORDER,
    );

    expect(result.shape.seedCount).toBe(3);
    expect(refsInNumberOrder(result)).toEqual([
      'top',
      'one',
      'zeroWithTime',
      'zeroEarly',
      'zeroLater',
    ]);
  });

  test('Upvote数0で最終Upvote時間が無い枠は、同日の非シードの末尾になり翌日の枠より前に並ぶ', () => {
    const result = drawBracket(
      [
        candidate('seed', 1, key('2025-06-04', 50, '10:00')),
        candidate('zeroSameDay', 2, key('2025-09-10', 0, null)),
        candidate('oneSameDay', 3, key('2025-09-10', 1, '23:59')),
        candidate('zeroWithTimeSameDay', 4, key('2025-09-10', 0, '08:00')),
        candidate('nextDay', 5, key('2025-09-11', 5, '00:01')),
        candidate('previousDay', 6, key('2025-09-09', 0, null)),
        candidate('laterDay', 7, key('2025-09-12', 2, '12:00')),
      ],
      ORDER,
    );

    expect(result.shape.seedCount).toBe(1);
    expect(refsInNumberOrder(result)).toEqual([
      'seed',
      'previousDay',
      'oneSameDay',
      'zeroWithTimeSameDay',
      'zeroSameDay',
      'nextDay',
      'laterDay',
    ]);
  });
});

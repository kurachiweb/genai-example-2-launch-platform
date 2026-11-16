import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LogObject } from '../../core/logging/log-record.ts';
import type {
  AdvanceResult,
  BracketProgression,
} from '../../core/tournament/ports.ts';
import type {
  WeekNotificationPublisher,
  WeekTournamentRecord,
} from '../../core/week-tournament/ports.ts';
import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  insertUser,
  productIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBrackets,
  insertParticipants,
} from '../tournament/testing/bracket-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  at,
  createProgression,
  DRAW_AT,
  FIRST_ROUND_ADVANCE_AT,
  FIRST_ROUND_DATE,
  POLICY,
  settle,
  unlink,
} from '../tournament/testing/progression-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_START,
  weekEntryIdOf,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';
import { WeekTournamentProgressionService } from './week-progression-service.ts';

const PROGRESSION_CATEGORY = 'api.week-tournament.progression';

const TOURNAMENT_ID = weekTournamentIdOf(1);

const PREVIOUS_WEEK_START = '2026-11-09';

const SERVICE_IDS = 101;

// 同じ番号のブラケットとトーナメントで、参加の枠と抽選番号を対応させる
interface SeededTournament {
  readonly index: number;
  readonly weekStart?: string;
  readonly entries: readonly number[];
  readonly firstMatchIds: number;
}

interface RoundCall {
  readonly decidedMatchIds: readonly string[];
  readonly previewMatchIds: readonly string[];
  readonly at: Date;
}

interface AwardCall {
  readonly weekStart: string;
  readonly productId: string;
  readonly at: Date;
}

// 実物の発行の口と同じく、受賞は週と受賞したプロダクトで重複を除いて記録する。指定した回数だけ発行を一時的に失敗させる
class RecordingWeekNotificationPublisher implements WeekNotificationPublisher {
  readonly rounds: RoundCall[] = [];
  readonly awards: AwardCall[] = [];
  private readonly recorded = new Map<string, AwardCall>();

  constructor(
    private roundFailures = 0,
    private awardFailures = 0,
  ) {}

  publishRound(input: RoundCall): Promise<void> {
    if (this.roundFailures > 0) {
      this.roundFailures -= 1;
      return Promise.reject(new Error('結果と予告の発行の一時的な失敗'));
    }
    this.rounds.push(input);
    return Promise.resolve();
  }

  publishAward(input: AwardCall): Promise<void> {
    if (this.awardFailures > 0) {
      this.awardFailures -= 1;
      return Promise.reject(new Error('受賞の発行の一時的な失敗'));
    }
    this.awards.push(input);
    const key = `${input.weekStart}/${input.productId}`;
    if (!this.recorded.has(key)) {
      this.recorded.set(key, input);
    }
    return Promise.resolve();
  }

  publishNight(): Promise<void> {
    return Promise.reject(new Error('進行の部品は夜の発行を呼びません'));
  }

  recordedAwards(): AwardCall[] {
    return [...this.recorded.values()];
  }
}

// 終了の記録をこの呼び出しで確定させた回数を数える
class CountingWeekTournamentStore extends D1WeekTournamentStore {
  recordedFinishes = 0;

  override async recordFinish(
    ...args: Parameters<D1WeekTournamentStore['recordFinish']>
  ): Promise<boolean> {
    const recorded = await super.recordFinish(...args);
    if (recorded) {
      this.recordedFinishes += 1;
    }
    return recorded;
  }
}

function failingFor(
  inner: BracketProgression,
  bracketId: string,
): BracketProgression {
  return {
    advance(target, policy, now): Promise<AdvanceResult> {
      return target === bracketId
        ? Promise.reject(new Error('一時的な失敗'))
        : inner.advance(target, policy, now);
    },
  };
}

function createService(
  options: {
    readonly failingBracketId?: string;
    readonly notifications?: RecordingWeekNotificationPublisher;
  } = {},
): {
  service: WeekTournamentProgressionService;
  notifications: RecordingWeekNotificationPublisher;
  store: D1WeekTournamentStore;
} {
  const store = new D1WeekTournamentStore(db);
  const notifications =
    options.notifications ?? new RecordingWeekNotificationPublisher();
  const { progression } = createProgression(SERVICE_IDS);
  return {
    store,
    notifications,
    service: new WeekTournamentProgressionService(
      store,
      options.failingBracketId === undefined
        ? progression
        : failingFor(progression, options.failingBracketId),
      notifications,
      'api',
    ),
  };
}

// 利用者1のプロダクトとローンチを参加の枠と同じ番号で作り、組み合わせ決定の後の進行中のトーナメントと1回戦の予定を用意する
async function seedTournament({
  index,
  weekStart,
  entries,
  firstMatchIds,
}: SeededTournament): Promise<string[]> {
  await insertProducts(entries, 1);
  await insertLaunches(
    entries.map((entry) => ({ index: entry, productIndex: entry })),
  );
  await insertBrackets([
    {
      index,
      participantCount: entries.length,
      columns: { firstRoundDate: FIRST_ROUND_DATE },
    },
  ]);
  await insertParticipants(
    entries.map((entry, offset) => ({
      index: entry,
      bracket: index,
      participantNo: offset + 1,
      entry,
      launch: entry,
      product: entry,
      owner: 1,
    })),
  );
  await insertWeekTournaments([
    {
      index,
      ...(weekStart === undefined ? {} : { weekStart }),
      columns: {
        status: 'in_progress',
        drawStartedAt: DRAW_AT,
        drawnAt: DRAW_AT,
        bracketId: bracketIdOf(index),
      },
    },
  ]);
  await insertWeekEntries(
    entries.map((entry) => ({
      index: entry,
      tournament: index,
      launch: entry,
      product: entry,
      owner: 1,
      columns: {
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: DRAW_AT,
        closedAt: DRAW_AT,
      },
    })),
  );
  const result = await createProgression(firstMatchIds).progression.advance(
    bracketIdOf(index),
    POLICY,
    DRAW_AT,
  );
  return result.kind === 'scheduled' ? [...result.previewMatchIds] : [];
}

async function tournamentOf(
  store: D1WeekTournamentStore,
  tournamentId: string,
): Promise<WeekTournamentRecord> {
  const record = await store.findTournament(tournamentId);
  if (record === undefined) {
    throw new Error(`トーナメントがありません: ${tournamentId}`);
  }
  return record;
}

async function advanceAndApply(
  service: WeekTournamentProgressionService,
  store: D1WeekTournamentStore,
  now: Date,
): Promise<AdvanceResult | undefined> {
  const tournament = await tournamentOf(store, TOURNAMENT_ID);
  const result = await service.advance(TOURNAMENT_ID, now);
  if (result !== undefined) {
    await service.applyResult(tournament, result, now);
  }
  return result;
}

let logs: LogObject[];

beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(1);
  logs = recordLogs();
});

afterEach(() => {
  resetObservability();
});

describe('WeekTournamentProgressionService.advance・applyResult(進行)', () => {
  test('ラウンドの全マッチが確定すると次ラウンドを予定し、確定したマッチの結果と次ラウンドの予告を発行する', async () => {
    const [first, second] = await seedTournament({
      index: 1,
      entries: [1, 2, 3, 4],
      firstMatchIds: 1,
    });
    if (first === undefined || second === undefined) {
      throw new Error('1回戦の予定がありません');
    }
    await settle(first, ['won', 'lost']);
    await settle(second, ['lost', 'won']);
    const { service, store, notifications } = createService();

    const result = await advanceAndApply(
      service,
      store,
      FIRST_ROUND_ADVANCE_AT,
    );

    const final = sequentialIdOf(SERVICE_IDS);
    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: bracketIdOf(1),
      round: 2,
      late: false,
      decidedMatchIds: [first, second],
      previewMatchIds: [final],
    });
    expect(notifications.rounds).toEqual([
      {
        decidedMatchIds: [first, second],
        previewMatchIds: [final],
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
    expect(notifications.recordedAwards()).toEqual([]);
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'in_progress',
      outcome: null,
      championEntryId: null,
    });
  });

  test('一部のマッチだけが確定していれば、確定したマッチの結果だけを発行する', async () => {
    const [first] = await seedTournament({
      index: 1,
      entries: [1, 2, 3, 4],
      firstMatchIds: 1,
    });
    if (first === undefined) {
      throw new Error('1回戦の予定がありません');
    }
    await settle(first, ['won', 'lost']);
    const { service, store, notifications } = createService();

    const result = await advanceAndApply(
      service,
      store,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toMatchObject({ kind: 'waiting', decidedMatchIds: [first] });
    expect(notifications.rounds).toEqual([
      {
        decidedMatchIds: [first],
        previewMatchIds: [],
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
  });

  test('0:00を過ぎてから進めると、次ラウンドを翌日に予定し予告を発行する', async () => {
    const [first, second] = await seedTournament({
      index: 1,
      entries: [1, 2, 3, 4],
      firstMatchIds: 1,
    });
    if (first === undefined || second === undefined) {
      throw new Error('1回戦の予定がありません');
    }
    await settle(first, ['won', 'lost']);
    await settle(second, ['lost', 'won']);
    const { service, store, notifications } = createService();
    const afterMidnight = at('2026-11-25', 0, 10);

    const result = await advanceAndApply(service, store, afterMidnight);

    expect(result).toMatchObject({ kind: 'scheduled', round: 2, late: true });
    expect(notifications.rounds).toEqual([
      {
        decidedMatchIds: [first, second],
        previewMatchIds: [sequentialIdOf(SERVICE_IDS)],
        at: afterMidnight,
      },
    ]);
  });

  test('進行中でないトーナメントは進めずにundefinedを返す', async () => {
    await insertWeekTournaments([
      { index: 1, columns: { status: 'drawing', drawStartedAt: DRAW_AT } },
    ]);
    const { service, notifications } = createService();

    expect(
      await service.advance(TOURNAMENT_ID, FIRST_ROUND_ADVANCE_AT),
    ).toBeUndefined();
    expect(
      await service.advance(weekTournamentIdOf(9), FIRST_ROUND_ADVANCE_AT),
    ).toBeUndefined();
    expect(notifications.rounds).toEqual([]);
  });
});

describe('WeekTournamentProgressionService.applyResult(終了と賞)', () => {
  test('決勝の勝者が確定すると受賞を1回だけ記録し、受賞と決勝の結果を発行する', async () => {
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(final, ['lost', 'won']);
    const { service, store, notifications } = createService();
    const tournament = await tournamentOf(store, TOURNAMENT_ID);

    const result = await service.advance(TOURNAMENT_ID, FIRST_ROUND_ADVANCE_AT);
    if (result === undefined) {
      throw new Error('進行の結果がありません');
    }
    await service.applyResult(tournament, result, FIRST_ROUND_ADVANCE_AT);
    await service.applyResult(tournament, result, at('2026-11-24', 23, 50));

    expect(result).toEqual({
      kind: 'finished',
      bracketId: bracketIdOf(1),
      championRef: weekEntryIdOf(2),
      newlyFinished: true,
      decidedMatchIds: [final],
    });
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(2),
      awardedAt: FIRST_ROUND_ADVANCE_AT,
    });
    expect(notifications.recordedAwards()).toEqual([
      {
        weekStart: WEEK_START,
        productId: productIdOf(2),
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
    expect(
      notifications.rounds.map(({ decidedMatchIds }) => decidedMatchIds),
    ).toEqual([[final], [final]]);
    expect(
      await service.advance(TOURNAMENT_ID, at('2026-11-25', 0, 0)),
    ).toBeUndefined();
  });

  test('同時に進めても受賞の記録は1回で、受賞の発行は重複を除いて1件になる', async () => {
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(final, ['won', 'lost']);
    const store = new CountingWeekTournamentStore(db);
    const notifications = new RecordingWeekNotificationPublisher();
    const service = new WeekTournamentProgressionService(
      store,
      createProgression(SERVICE_IDS).progression,
      notifications,
      'api',
    );
    const tournament = await tournamentOf(store, TOURNAMENT_ID);

    await Promise.all(
      [0, 1, 2].map(async () => {
        const result = await service.advance(
          TOURNAMENT_ID,
          FIRST_ROUND_ADVANCE_AT,
        );
        if (result !== undefined) {
          await service.applyResult(tournament, result, FIRST_ROUND_ADVANCE_AT);
        }
      }),
    );

    expect(store.recordedFinishes).toBe(1);
    expect(notifications.recordedAwards()).toEqual([
      {
        weekStart: WEEK_START,
        productId: productIdOf(1),
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(1),
    });
  });

  test('結果の発行に失敗すると週を進行中のまま残し、再試行で受賞の記録と発行に進む', async () => {
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(final, ['lost', 'won']);
    const notifications = new RecordingWeekNotificationPublisher(1, 0);
    const { service, store } = createService({ notifications });

    await expect(
      advanceAndApply(service, store, FIRST_ROUND_ADVANCE_AT),
    ).rejects.toThrow('結果と予告の発行の一時的な失敗');
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'in_progress',
      outcome: null,
    });

    const retriedAt = at('2026-11-24', 23, 50);
    await advanceAndApply(service, store, retriedAt);

    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(2),
      awardedAt: retriedAt,
    });
    expect(notifications.recordedAwards()).toEqual([
      { weekStart: WEEK_START, productId: productIdOf(2), at: retriedAt },
    ]);
    expect(notifications.rounds).toEqual([
      { decidedMatchIds: [final], previewMatchIds: [], at: retriedAt },
    ]);
  });

  test('受賞の発行に失敗すると受賞を記録せず週を進行中のまま残し、再試行で受賞の記録と発行がそろう', async () => {
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(final, ['lost', 'won']);
    const notifications = new RecordingWeekNotificationPublisher(0, 1);
    const { service, store } = createService({ notifications });

    await expect(
      advanceAndApply(service, store, FIRST_ROUND_ADVANCE_AT),
    ).rejects.toThrow('受賞の発行の一時的な失敗');
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'in_progress',
      outcome: null,
      awardedAt: null,
    });

    const retriedAt = at('2026-11-25', 0, 5);
    await advanceAndApply(service, store, retriedAt);

    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(2),
      awardedAt: retriedAt,
    });
    expect(notifications.recordedAwards()).toEqual([
      { weekStart: WEEK_START, productId: productIdOf(2), at: retriedAt },
    ]);
  });

  test('次ラウンドに残る参加者が1になると、残った枠の受賞を記録して発行する', async () => {
    const [first, second] = await seedTournament({
      index: 1,
      entries: [1, 2, 3, 4],
      firstMatchIds: 1,
    });
    if (first === undefined || second === undefined) {
      throw new Error('1回戦の予定がありません');
    }
    await settle(first, ['lost', 'lost'], 'no_votes');
    await settle(second, ['won', 'lost']);
    const { service, store, notifications } = createService();

    const result = await advanceAndApply(
      service,
      store,
      FIRST_ROUND_ADVANCE_AT,
    );

    expect(result).toMatchObject({
      kind: 'finished',
      championRef: weekEntryIdOf(3),
    });
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(3),
      awardedAt: FIRST_ROUND_ADVANCE_AT,
    });
    expect(notifications.recordedAwards()).toEqual([
      {
        weekStart: WEEK_START,
        productId: productIdOf(3),
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
    expect(notifications.rounds).toEqual([
      {
        decidedMatchIds: [first, second],
        previewMatchIds: [],
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
  });

  test('決勝が両者敗北なら受賞なしで記録し、受賞を発行せず結果だけを発行する', async () => {
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(final, ['lost', 'lost'], 'no_votes');
    const { service, store, notifications } = createService();

    await advanceAndApply(service, store, FIRST_ROUND_ADVANCE_AT);

    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
    });
    expect(notifications.recordedAwards()).toEqual([]);
    expect(notifications.rounds).toEqual([
      {
        decidedMatchIds: [final],
        previewMatchIds: [],
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
  });

  test('決勝の確定の後に紐付けを解除した優勝は受賞を記録し、受賞を発行しない', async () => {
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(final, ['lost', 'won']);
    await unlink([2]);
    const { service, store, notifications } = createService();
    await store.unlinkOrDeleteByProduct(productIdOf(2));

    await advanceAndApply(service, store, FIRST_ROUND_ADVANCE_AT);

    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(2),
    });
    expect(notifications.recordedAwards()).toEqual([]);
    expect(notifications.rounds).toHaveLength(1);
    expect(
      logs.filter(({ category }) => category === PROGRESSION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        tournamentId: TOURNAMENT_ID,
        entryId: weekEntryIdOf(2),
      }),
    ]);
  });
});

describe('WeekTournamentProgressionService.advanceAll', () => {
  let events: Event[];

  beforeEach(() => {
    events = installRecordingSentry();
  });

  test('進行中の全トーナメントを進め、1つの失敗で他を止めずに失敗の一覧を返す', async () => {
    const [previousFinal] = await seedTournament({
      index: 2,
      weekStart: PREVIOUS_WEEK_START,
      entries: [3, 4],
      firstMatchIds: 51,
    });
    const [final] = await seedTournament({
      index: 1,
      entries: [1, 2],
      firstMatchIds: 1,
    });
    if (final === undefined || previousFinal === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(previousFinal, ['won', 'lost']);
    await settle(final, ['lost', 'won']);
    await insertWeekTournaments([
      {
        index: 3,
        weekStart: '2026-11-02',
        columns: { status: 'finished', outcome: 'no_award' },
      },
    ]);
    const { service, store, notifications } = createService({
      failingBracketId: bracketIdOf(2),
    });

    const result = await service.advanceAll(FIRST_ROUND_ADVANCE_AT);

    expect(result).toEqual({
      advanced: 1,
      failed: [weekTournamentIdOf(2)],
    });
    expect(await tournamentOf(store, TOURNAMENT_ID)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(2),
    });
    expect(await tournamentOf(store, weekTournamentIdOf(2))).toMatchObject({
      status: 'in_progress',
    });
    expect(notifications.recordedAwards()).toEqual([
      {
        weekStart: WEEK_START,
        productId: productIdOf(2),
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
    expect(notifications.rounds).toEqual([
      {
        decidedMatchIds: [final],
        previewMatchIds: [],
        at: FIRST_ROUND_ADVANCE_AT,
      },
    ]);
    expect(
      logs.filter(({ category }) => category === PROGRESSION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'error',
        tournamentId: weekTournamentIdOf(2),
      }),
    ]);
    expect(events.map(({ tags }) => tags?.tournament_id)).toEqual([
      weekTournamentIdOf(2),
    ]);
  });

  test('進行中のトーナメントが無ければ何もしない', async () => {
    const { service, notifications } = createService();

    expect(await service.advanceAll(FIRST_ROUND_ADVANCE_AT)).toEqual({
      advanced: 0,
      failed: [],
    });
    expect(notifications.rounds).toEqual([]);
  });
});

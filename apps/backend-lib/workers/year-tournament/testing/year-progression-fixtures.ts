import type {
  AdvanceResult,
  BracketProgression,
} from '../../../core/tournament/ports.ts';
import { dailyRoundPolicy } from '../../../core/tournament/round-schedule.ts';
import type {
  YearNotificationPublisher,
  YearTournamentRecord,
} from '../../../core/year-tournament/ports.ts';
import { yearFirstRoundDate } from '../../../core/year-tournament/year-schedule.ts';
import {
  db,
  insertLaunches,
  insertProducts,
} from '../../product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBrackets,
  insertParticipants,
} from '../../tournament/testing/bracket-fixtures.ts';
import { createProgression } from '../../tournament/testing/progression-fixtures.ts';
import { D1YearEntryStore } from '../d1-year-entry-store.ts';
import { D1YearTournamentStore } from '../d1-year-tournament-store.ts';
import { YearTournamentProgressionService } from '../year-progression-service.ts';
import {
  defaultScheduleOf,
  insertYearEntries,
  insertYearTournaments,
  YEAR,
  yearEntryIdOf,
  yearTournamentIdOf,
} from './year-tournament-fixtures.ts';

export const PROGRESSION_CATEGORY = 'api.year-tournament.progression';

export const YEAR_TOURNAMENT_ID = yearTournamentIdOf(1);

export const SERVICE_IDS = 101;

// 同じ番号のブラケットと年で、参加の枠と抽選番号を対応させる
export interface SeededYear {
  readonly index: number;
  readonly year?: number;
  readonly entries: readonly number[];
  readonly firstMatchIds: number;
}

export interface RoundCall {
  readonly decidedMatchIds: readonly string[];
  readonly previewMatchIds: readonly string[];
  readonly at: Date;
}

export interface AwardCall {
  readonly year: number;
  readonly productId: string;
  readonly at: Date;
}

// 実物の発行の口と同じく、受賞は対象年と受賞したプロダクトで重複を除いて記録する。
// 指定した回数だけ発行を一時的に失敗させ、受賞の発行の時点の年の状態を記録する
export class RecordingYearNotificationPublisher implements YearNotificationPublisher {
  readonly rounds: RoundCall[] = [];
  readonly awards: AwardCall[] = [];
  readonly statusesAtAward: (string | undefined)[] = [];
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

  async publishAward(input: AwardCall): Promise<void> {
    const tournament = await new D1YearTournamentStore(db).findById(
      YEAR_TOURNAMENT_ID,
    );
    this.statusesAtAward.push(tournament?.status);
    if (this.awardFailures > 0) {
      this.awardFailures -= 1;
      throw new Error('受賞の発行の一時的な失敗');
    }
    this.awards.push(input);
    const key = `${String(input.year)}/${input.productId}`;
    if (!this.recorded.has(key)) {
      this.recorded.set(key, input);
    }
  }

  publishEvening(): Promise<void> {
    return Promise.reject(new Error('進行の部品は夜の発行を呼びません'));
  }

  recordedAwards(): AwardCall[] {
    return [...this.recorded.values()];
  }
}

// 終了の記録をこの呼び出しで確定させた回数を数える
export class CountingYearTournamentStore extends D1YearTournamentStore {
  recordedFinishes = 0;

  override async recordFinish(
    ...args: Parameters<D1YearTournamentStore['recordFinish']>
  ): Promise<boolean> {
    const recorded = await super.recordFinish(...args);
    if (recorded) {
      this.recordedFinishes += 1;
    }
    return recorded;
  }
}

export interface ProgressionHarness {
  readonly service: YearTournamentProgressionService;
  readonly notifications: RecordingYearNotificationPublisher;
  readonly store: CountingYearTournamentStore;
  readonly entries: D1YearEntryStore;
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

export function createService(
  options: {
    readonly idStart?: number;
    readonly failingBracketId?: string;
    readonly notifications?: RecordingYearNotificationPublisher;
  } = {},
): ProgressionHarness {
  const store = new CountingYearTournamentStore(db);
  const entries = new D1YearEntryStore(db);
  const notifications =
    options.notifications ?? new RecordingYearNotificationPublisher();
  const { progression } = createProgression(options.idStart ?? SERVICE_IDS);
  return {
    store,
    entries,
    notifications,
    service: new YearTournamentProgressionService(
      store,
      entries,
      options.failingBracketId === undefined
        ? progression
        : failingFor(progression, options.failingBracketId),
      notifications,
      'api',
    ),
  };
}

export function firstRoundDateOf(year: number, participantCount: number) {
  const date = yearFirstRoundDate(
    defaultScheduleOf(year).finalDate,
    participantCount,
  );
  if (date === null) {
    throw new Error('1回戦の無い参加数です');
  }
  return date;
}

// 利用者1のプロダクトとローンチを参加の枠と同じ番号で作り、組み合わせ決定の後の進行中の年と1回戦の予定を用意する
export async function seedYear({
  index,
  year = YEAR,
  entries,
  firstMatchIds,
}: SeededYear): Promise<string[]> {
  const schedule = defaultScheduleOf(year);
  const firstRoundDate = firstRoundDateOf(year, entries.length);
  await insertProducts(entries, 1);
  await insertLaunches(
    entries.map((entry) => ({ index: entry, productIndex: entry })),
  );
  await insertBrackets([
    {
      index,
      kind: 'year',
      participantCount: entries.length,
      columns: { firstRoundDate, tournamentId: yearTournamentIdOf(index) },
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
      columns: { entryRef: yearEntryIdOf(entry) },
    })),
  );
  await insertYearTournaments([
    {
      index,
      year,
      columns: {
        status: 'in_progress',
        drawStartedAt: schedule.drawAt,
        drawnAt: schedule.drawAt,
        bracketId: bracketIdOf(index),
        firstRoundDate,
        participantCount: entries.length,
      },
    },
  ]);
  await insertYearEntries(
    entries.map((entry) => ({
      index: entry,
      launch: entry,
      product: entry,
      owner: 1,
      columns: {
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: schedule.drawAt,
        closedAt: schedule.drawAt,
        classifiedYear: year,
      },
    })),
  );
  const result = await createProgression(firstMatchIds).progression.advance(
    bracketIdOf(index),
    dailyRoundPolicy(firstRoundDate, schedule.drawAt),
    schedule.drawAt,
  );
  return result.kind === 'scheduled' ? [...result.previewMatchIds] : [];
}

export async function yearOf(
  store: D1YearTournamentStore,
  yearTournamentId: string = YEAR_TOURNAMENT_ID,
): Promise<YearTournamentRecord> {
  const record = await store.findById(yearTournamentId);
  if (record === undefined) {
    throw new Error(`年のトーナメントがありません: ${yearTournamentId}`);
  }
  return record;
}

export async function advanceAndApply(
  { service, store }: Pick<ProgressionHarness, 'service' | 'store'>,
  now: Date,
): Promise<AdvanceResult | undefined> {
  const tournament = await yearOf(store);
  const result = await service.advance(YEAR_TOURNAMENT_ID, now);
  if (result !== undefined) {
    await service.applyResult(tournament, result, now);
  }
  return result;
}

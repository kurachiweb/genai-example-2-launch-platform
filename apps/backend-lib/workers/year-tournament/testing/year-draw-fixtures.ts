import { eq } from 'drizzle-orm';

import type { Database } from '../../../../db/client.ts';
import { yearTournamentEntries } from '../../../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../../../db/schema/tournament/year-tournaments.ts';
import type { BusinessDate } from '../../../core/time/business-time.ts';
import type {
  YearEntryClassification,
  YearEntryRecord,
  YearEntryRegistrar,
} from '../../../core/year-tournament/ports.ts';
import { D1ProductDirectory } from '../../product/d1-product-directory.ts';
import { db } from '../../product/testing/product-fixtures.ts';
import {
  createEntitlements,
  type FakeEntitlements,
} from '../../week-tournament/testing/draw-service-fixtures.ts';
import { D1YearEntryStore } from '../d1-year-entry-store.ts';
import { D1YearTournamentStore } from '../d1-year-tournament-store.ts';
import { YearTournamentDrawService } from '../year-draw-service.ts';
import {
  type ChampionFixture,
  createRegistrarHarness,
} from './year-entry-registrar-fixtures.ts';
import {
  YEAR_SCHEDULE,
  yearEntryIdOf,
  type YearEntryFixture,
  yearTournamentIdOf,
} from './year-tournament-fixtures.ts';

export const DRAW_CATEGORY = 'api.year-tournament.draw';

export const YEAR_TOURNAMENT_ID = yearTournamentIdOf(1);

// 2027年の決済期限(5/24の23:35)と組み合わせ決定の時刻(23:45)
export const DEADLINE_AT = YEAR_SCHEDULE.deadlineAt;

export const DRAW_AT = YEAR_SCHEDULE.drawAt;

export type DrawCall =
  | 'syncChampions'
  | 'freeze'
  | 'listCandidates'
  | 'classify'
  | 'listDrawn'
  | 'excludeOverCapacity';

export interface ObservedTournamentHooks {
  // 一覧で読んだ後、凍結の前に別の実行が凍結した状態を作る
  readonly beforeFreeze?: () => Promise<void>;
  // 凍結の直後に同時の書き込みを差し込む
  readonly afterFreeze?: () => Promise<void>;
}

// 呼び出しの順と凍結の結果を記録し、凍結の前後に同時の書き込みを差し込めるストア
export class ObservedYearTournamentStore extends D1YearTournamentStore {
  readonly freezeOutcomes: ('frozen' | 'already')[] = [];

  constructor(
    database: Database,
    private readonly calls: DrawCall[],
    private readonly hooks: ObservedTournamentHooks = {},
  ) {
    super(database);
  }

  override async freeze(
    yearTournamentId: string,
    at: Date,
  ): Promise<'frozen' | 'already'> {
    this.calls.push('freeze');
    await this.hooks.beforeFreeze?.();
    const outcome = await super.freeze(yearTournamentId, at);
    this.freezeOutcomes.push(outcome);
    await this.hooks.afterFreeze?.();
    return outcome;
  }
}

// 呼び出しの順と分類・上限の入力を記録するストア
export class ObservedYearEntryStore extends D1YearEntryStore {
  readonly candidatePageSizes: number[] = [];
  readonly classified: YearEntryClassification[] = [];
  readonly overCapacity: string[][] = [];

  constructor(
    database: Database,
    private readonly calls: DrawCall[],
  ) {
    super(database);
  }

  override async listCandidates(
    deadlineDate: BusinessDate,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly YearEntryRecord[]> {
    this.calls.push('listCandidates');
    const entries = await super.listCandidates(
      deadlineDate,
      afterEntryId,
      limit,
    );
    this.candidatePageSizes.push(entries.length);
    return entries;
  }

  override async classify(
    year: number,
    updates: readonly YearEntryClassification[],
    at: Date,
  ): Promise<void> {
    this.calls.push('classify');
    this.classified.push(...updates);
    await super.classify(year, updates, at);
  }

  override listDrawn(year: number): Promise<readonly YearEntryRecord[]> {
    this.calls.push('listDrawn');
    return super.listDrawn(year);
  }

  override async excludeOverCapacity(
    year: number,
    entryIds: readonly string[],
    at: Date,
  ): Promise<void> {
    this.calls.push('excludeOverCapacity');
    this.overCapacity.push([...entryIds]);
    await super.excludeOverCapacity(year, entryIds, at);
  }
}

export interface DrawServiceOptions extends ObservedTournamentHooks {
  // 組み合わせ決定の補完が読むWeek優勝(既定は無し)
  readonly champions?: readonly ChampionFixture[];
  readonly entitlements?: FakeEntitlements;
}

export function createDrawService(options: DrawServiceOptions = {}) {
  const calls: DrawCall[] = [];
  const tournaments = new ObservedYearTournamentStore(db, calls, options);
  const entries = new ObservedYearEntryStore(db, calls);
  const fake = options.entitlements ?? createEntitlements();
  const harness = createRegistrarHarness({
    champions: options.champions ?? [],
  });
  const syncInputs: Parameters<YearEntryRegistrar['syncChampions']>[0][] = [];
  const registrar: YearEntryRegistrar = {
    syncChampions: (input) => {
      calls.push('syncChampions');
      syncInputs.push(input);
      return harness.registrar.syncChampions(input);
    },
  };
  const service = new YearTournamentDrawService({
    appName: 'api',
    tournaments,
    entries,
    registrar,
    products: new D1ProductDirectory(db),
    entitlements: fake.entitlements,
  });
  return {
    service,
    calls,
    tournaments,
    entries,
    syncInputs,
    queries: fake.queries,
  };
}

// 同じ番号のローンチとプロダクトで2027年の枠を作る
export function entryOf(
  index: number,
  owner: number,
  columns: YearEntryFixture['columns'] = {},
): YearEntryFixture {
  return { index, launch: index, product: index, owner, columns };
}

export async function readEntry(index: number) {
  return readEntryById(yearEntryIdOf(index));
}

export async function readEntryById(entryId: string) {
  const [row] = await db
    .select({
      status: yearTournamentEntries.status,
      closeReason: yearTournamentEntries.closeReason,
      entitlementSource: yearTournamentEntries.entitlementSource,
      purchaseId: yearTournamentEntries.purchaseId,
      entitledAt: yearTournamentEntries.entitledAt,
      closedAt: yearTournamentEntries.closedAt,
      classifiedYear: yearTournamentEntries.classifiedYear,
      refundStatus: yearTournamentEntries.refundStatus,
    })
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, entryId));
  return row;
}

export async function readTournament(index = 1) {
  const [row] = await db
    .select({
      status: yearTournaments.status,
      drawStartedAt: yearTournaments.drawStartedAt,
    })
    .from(yearTournaments)
    .where(eq(yearTournaments.id, yearTournamentIdOf(index)));
  return row;
}

// 別の実行が組み合わせ決定を始めた(凍結した)状態にする
export async function markFrozen(at: Date, index = 1): Promise<void> {
  await db
    .update(yearTournaments)
    .set({ status: 'drawing', drawStartedAt: at, updatedAt: at })
    .where(eq(yearTournaments.id, yearTournamentIdOf(index)));
}

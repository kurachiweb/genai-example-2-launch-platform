import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import type { WeekChampionDirectory } from '../../../lib/core/week-tournament/ports.ts';
import type {
  YearCalendar,
  YearCalendarEntry,
  YearEntryRecord,
  YearEntryStore,
} from '../../../lib/core/year-tournament/ports.ts';
import {
  resolveTargetYear,
  type TargetYearResolution,
} from '../../../lib/core/year-tournament/year-target-rules.ts';
import type { DecisionSubject } from '../product/decision-sources.ts';

export interface WonLaunch {
  readonly productId: string;
  readonly launchId: string;
}

export type YearLaunchPhase =
  // 枠の作成前のWeek優勝を含む。対象年が凍結済み(遅れ)なら決済期限はnull
  | { readonly kind: 'awaiting'; readonly deadlineAt: Date | null }
  // drawingは対象年が凍結済みで組み合わせを書き終える前
  | { readonly kind: 'entitled'; readonly drawing: boolean }
  // aliveは進行中のブラケットで敗退しておらず優勝でもない
  | {
      readonly kind: 'drawn';
      readonly alive: boolean;
      readonly drawing: boolean;
    };

// 期限切れ・喪失・除外の枠と、枠もWeek優勝も無いローンチは含めない
export interface YearLaunchStanding {
  readonly launch: WonLaunch;
  readonly phase: YearLaunchPhase;
}

export interface YearStandingReaders {
  readonly entries: YearEntryStore;
  readonly brackets: BracketStore;
  readonly calendar: YearCalendar;
  // 渡したときだけ、枠の無いローンチのWeek優勝を読む
  readonly champions?: WeekChampionDirectory;
}

// resolveTargetYearが調べる年数(Week優勝の日の年〜3年後)
const TARGET_YEAR_LOOKUP_YEARS = 4;

type AwardedLaunch =
  | { readonly kind: 'entry'; readonly entry: YearEntryRecord }
  | { readonly kind: 'champion'; readonly awardedDate: BusinessDate };

export function wonLaunchesOf(
  subjects: readonly DecisionSubject[],
): readonly WonLaunch[] {
  return subjects.flatMap(({ productId, latestLaunch }) =>
    latestLaunch?.outcome === 'won'
      ? [{ productId, launchId: latestLaunch.launchId }]
      : [],
  );
}

function yearOf(date: BusinessDate): number {
  return Number(date.slice(0, 4));
}

function isOpen({ status }: YearEntryRecord): boolean {
  return status === 'awaiting_payment' || status === 'entitled';
}

function awardedDateOf(awarded: AwardedLaunch): BusinessDate | undefined {
  if (awarded.kind === 'champion') {
    return awarded.awardedDate;
  }
  return isOpen(awarded.entry) ? awarded.entry.awardedDate : undefined;
}

// 分類前の枠の対象年を求めるために読む年
export function targetYearCandidates(
  awardedDate: BusinessDate,
): readonly number[] {
  const first = yearOf(awardedDate);
  return Array.from(
    { length: TARGET_YEAR_LOOKUP_YEARS },
    (_, offset) => first + offset,
  );
}

// targetYearCandidatesの年を読んだ日程から、分類前の枠の対象年を求める
export function resolveTargetIn(
  awardedDate: BusinessDate,
  calendar: ReadonlyMap<number, YearCalendarEntry>,
): TargetYearResolution {
  return resolveTargetYear(awardedDate, (year) => {
    const entry = calendar.get(year);
    if (entry === undefined) {
      throw new RangeError(`照会していない年です: ${String(year)}`);
    }
    return entry;
  });
}

// 分類前の枠は対象年を持たないためWeek優勝の日から4年分を、組み合わせの対象の枠は分類した年を読む
function yearsToDescribe(awarded: readonly AwardedLaunch[]): readonly number[] {
  const years = new Set<number>();
  for (const item of awarded) {
    const awardedDate = awardedDateOf(item);
    if (awardedDate !== undefined) {
      for (const year of targetYearCandidates(awardedDate)) {
        years.add(year);
      }
    } else if (
      item.kind === 'entry' &&
      item.entry.status === 'drawn' &&
      item.entry.classifiedYear !== null
    ) {
      years.add(item.entry.classifiedYear);
    }
  }
  return [...years].sort((left, right) => left - right);
}

async function readChampionAwardDates(
  calendar: YearCalendar,
  champions: WeekChampionDirectory,
  launchIds: readonly string[],
  at: Date,
): Promise<ReadonlyMap<string, BusinessDate>> {
  const awardedFrom = await calendar.openPeriodStart(at);
  const listed = await champions.listChampions({
    awardedFrom,
    awardedBefore: at,
  });
  const wanted = new Set(launchIds);
  return new Map(
    listed.flatMap(({ launchId, awardedAt }) =>
      wanted.has(launchId)
        ? [[launchId, toBusinessDateTime(awardedAt).date] as const]
        : [],
    ),
  );
}

function isDrawing(entry: YearCalendarEntry | undefined): boolean {
  return entry?.record?.status === 'drawing';
}

function phaseOf(
  awarded: AwardedLaunch,
  calendar: ReadonlyMap<number, YearCalendarEntry>,
  aliveRefs: ReadonlySet<string>,
): YearLaunchPhase | undefined {
  const awardedDate = awardedDateOf(awarded);
  if (awardedDate !== undefined) {
    const target = resolveTargetIn(awardedDate, calendar);
    if (awarded.kind === 'champion' || awarded.entry.status !== 'entitled') {
      return {
        kind: 'awaiting',
        deadlineAt:
          target.kind === 'open' ? target.year.schedule.deadlineAt : null,
      };
    }
    return {
      kind: 'entitled',
      drawing: target.kind === 'late' && isDrawing(calendar.get(target.year)),
    };
  }
  if (awarded.kind === 'entry' && awarded.entry.status === 'drawn') {
    const { entryId, classifiedYear } = awarded.entry;
    return {
      kind: 'drawn',
      alive: aliveRefs.has(entryId),
      drawing:
        classifiedYear !== null && isDrawing(calendar.get(classifiedYear)),
    };
  }
  return undefined;
}

// 対象の数によらず、枠・勝ち残り・年の日程・Week優勝をそれぞれ1回の一括の読み取りで引き当てる
export async function readYearLaunchStandings(
  readers: YearStandingReaders,
  launches: readonly WonLaunch[],
  at: Date,
): Promise<readonly YearLaunchStanding[]> {
  if (launches.length === 0) {
    return [];
  }
  const entries = await readers.entries.findByLaunches(
    launches.map(({ launchId }) => launchId),
  );
  const drawnRefs = [...entries.values()]
    .filter(({ status }) => status === 'drawn')
    .map(({ entryId }) => entryId);
  const unentered = launches
    .map(({ launchId }) => launchId)
    .filter((launchId) => !entries.has(launchId));
  const [aliveRefs, championDates] = await Promise.all([
    drawnRefs.length === 0
      ? new Set<string>()
      : readers.brackets.findAliveRefs('year', drawnRefs),
    readers.champions === undefined || unentered.length === 0
      ? new Map<string, BusinessDate>()
      : readChampionAwardDates(
          readers.calendar,
          readers.champions,
          unentered,
          at,
        ),
  ]);
  const awarded = launches.flatMap(
    (launch): { launch: WonLaunch; awarded: AwardedLaunch }[] => {
      const entry = entries.get(launch.launchId);
      if (entry !== undefined) {
        return [{ launch, awarded: { kind: 'entry', entry } }];
      }
      const awardedDate = championDates.get(launch.launchId);
      return awardedDate === undefined
        ? []
        : [{ launch, awarded: { kind: 'champion', awardedDate } }];
    },
  );
  const years = yearsToDescribe(awarded.map((item) => item.awarded));
  const calendar =
    years.length === 0
      ? new Map<number, YearCalendarEntry>()
      : await readers.calendar.describe(years, at);
  return awarded.flatMap(({ launch, awarded: item }) => {
    const phase = phaseOf(item, calendar, aliveRefs);
    return phase === undefined ? [] : [{ launch, phase }];
  });
}

// 勝ち残りの枠と、凍結の後に組み合わせを書き終えるまでの参加資格・組み合わせの対象の枠
export function isContending({ phase }: YearLaunchStanding): boolean {
  switch (phase.kind) {
    case 'awaiting':
      return false;
    case 'entitled':
      return phase.drawing;
    case 'drawn':
      return phase.alive || phase.drawing;
  }
}

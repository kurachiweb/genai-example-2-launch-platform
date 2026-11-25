import { weekStartOf } from '../../../common-lib/tournament/week-period.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import type {
  WeekEntryRecord,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import { entryWindowFor } from '../../../lib/core/week-tournament/week-schedule.ts';
import type { DecisionSubject } from '../product/decision-sources.ts';

export interface WonLaunch {
  readonly productId: string;
  readonly launchId: string;
  readonly launchDate: BusinessDate;
}

export interface WeekLaunchStanding {
  readonly launch: WonLaunch;
  // 予選の勝利の確定から枠の作成までの間はundefined
  readonly entry: WeekEntryRecord | undefined;
  readonly tournament: WeekTournamentRecord | undefined;
  // 週の行があれば保存した期限、無ければ規則から求めた期限
  readonly deadlineAt: Date;
  // 進行中のブラケットで敗退しておらず優勝でもない
  readonly alive: boolean;
}

export function wonLaunchesOf(
  subjects: readonly DecisionSubject[],
): readonly WonLaunch[] {
  return subjects.flatMap(({ productId, latestLaunch }) =>
    latestLaunch?.outcome === 'won'
      ? [
          {
            productId,
            launchId: latestLaunch.launchId,
            launchDate: latestLaunch.launchDate,
          },
        ]
      : [],
  );
}

const weekOf = (launchDate: BusinessDate): BusinessDate =>
  parseBusinessDate(weekStartOf(launchDate));

// 対象の数によらず、枠・週の行・勝ち残りをそれぞれ1回の一括の読み取りで引き当てる
export async function readWeekLaunchStandings(
  store: WeekTournamentStore,
  brackets: BracketStore,
  launches: readonly WonLaunch[],
): Promise<readonly WeekLaunchStanding[]> {
  if (launches.length === 0) {
    return [];
  }
  const weekStarts = [
    ...new Set(launches.map(({ launchDate }) => weekOf(launchDate))),
  ];
  const [entries, tournaments] = await Promise.all([
    store.findEntriesByLaunch(launches.map(({ launchId }) => launchId)),
    store.findTournamentsByWeeks(weekStarts),
  ]);
  const drawnRefs = [...entries.values()]
    .filter(({ status }) => status === 'drawn')
    .map(({ entryId }) => entryId);
  const aliveRefs =
    drawnRefs.length === 0
      ? new Set<string>()
      : await brackets.findAliveRefs('week', drawnRefs);
  return launches.map((launch) => {
    const weekStart = weekOf(launch.launchDate);
    const entry = entries.get(launch.launchId);
    const tournament = tournaments.get(weekStart);
    return {
      launch,
      entry,
      tournament,
      deadlineAt:
        tournament?.window.deadlineAt ?? entryWindowFor(weekStart).deadlineAt,
      alive: entry !== undefined && aliveRefs.has(entry.entryId),
    };
  });
}

// 凍結の後、組み合わせを書き終えるまではブラケットが無く勝ち残りを引き当てられないため、週の状態で組み合わせ決定を待つ間とみなす
export function isContending({
  entry,
  tournament,
  alive,
}: WeekLaunchStanding): boolean {
  return (
    entry?.status === 'drawn' && (alive || tournament?.status === 'drawing')
  );
}

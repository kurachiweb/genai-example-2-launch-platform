import { randomBytes } from 'node:crypto';

import {
  isoWeekKey,
  weekStartOf,
} from '../../apps/common-lib/tournament/week-period.ts';
import {
  MATCH_SCHEDULE,
  matchWindow,
} from '../../apps/backend-lib/core/match/match-model.ts';
import {
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../apps/backend-lib/core/time/business-time.ts';
import { defaultFinalDate } from '../../apps/backend-lib/core/year-tournament/year-schedule.ts';
import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { executeLocalD1 } from './local-d1.ts';
import { addBusinessDays, businessDateOf } from './scheduled-trigger.ts';
import {
  parseVerifiedUserId,
  parseWeekFinal,
  verifiedUserIdSql,
  type WeekFinal,
} from './week-tournament-fixture-sql.ts';
import {
  endWeekFinal,
  runWeekEveningJobs,
  type WeekEveningJobsOptions,
} from './week-tournament-fixtures.ts';
import {
  fixtureLatestYearSql,
  nextFixtureYear,
  openYearEntryEntitleSql,
  parseFixtureLatestYear,
  parseYearEntrantsInsert,
  parseYearTournamentState,
  type PlannedYearEntrant,
  planYearEntrants,
  type YearEntrantSchedule,
  yearEntrantsInsertSql,
  yearEntryWindowCloseSql,
  yearFinalSql,
  yearFinalStartSql,
  yearOwnerIdOf,
  type YearTournamentState,
  yearTournamentStateSql,
} from './year-tournament-fixture-sql.ts';

export type { YearTournamentState } from './year-tournament-fixture-sql.ts';

export type YearFinal = WeekFinal;

export type YearEveningJobsOptions = WeekEveningJobsOptions;

export interface YearTournamentEntrantsRequest {
  // 参加費を画面で支払う流れでは、画面で登録した確認済みの利用者のハンドルを渡し、受付中の枠のプロダクトをその利用者のものにする
  readonly openOwnerHandle?: string;
}

export interface YearTournamentEntrant {
  readonly ownerUserId: string;
  readonly productId: string;
  readonly productHandle: string;
  readonly productName: string;
  readonly launchId: string;
  readonly entryId: string;
}

export interface YearTournamentFixture {
  readonly yearTournamentId: string;
  readonly year: number;
  readonly deadlineDate: string;
  // 受付中の枠
  readonly open: YearTournamentEntrant;
  // Ultrasの加入者として参加資格を得た枠
  readonly ultras: YearTournamentEntrant;
}

const SUFFIX_BYTES = 4;

const MINUTE_MS = 60_000;

// 受付中の枠のWeek優勝は対象年の6月15日を含む週、Ultrasの枠はその翌週のWeek優勝にする
const OPEN_WEEK_MONTH_DAY = '06-15';
const DAYS_PER_WEEK = 7;

// 予選のローンチ日は週の水曜日、Week優勝は週の最後の日のマッチの確定の時刻にする
const LAUNCH_DAY_OFFSET = 2;
const AWARD_DAY_OFFSET = 6;

// 期限を過去へ移すときは、決済期限日の規則どおりの時刻にする
const ACCEPT_UNTIL_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 0,
});
const DEADLINE_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 35,
});
const DRAW_TIME: BusinessTimeOfDay = Object.freeze({ hour: 23, minute: 45 });

// 確定のジョブは実行の時刻で終了の日時を過ぎたマッチを選ぶため、開始の日時は作る時点より前にする
const FINAL_STARTED_AGO_MS = 3 * MINUTE_MS;

// 開始の後の画面の確認の途中で、他のテストが起こす23:40のジョブに決勝を確定させないよう、終了の日時を少なくともこの分だけ先にする
const FINAL_MIN_LIVE_MS = 10 * MINUTE_MS;

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

const nextSuffix = (): string => randomBytes(SUFFIX_BYTES).toString('hex');

const entrantOf = (entrant: PlannedYearEntrant): YearTournamentEntrant => ({
  ownerUserId: yearOwnerIdOf(entrant),
  productId: entrant.productId,
  productHandle: entrant.productHandle,
  productName: entrant.productName,
  launchId: entrant.launchId,
  entryId: entrant.yearEntryId,
});

const scheduleOf = (weekStart: string): YearEntrantSchedule => {
  const launchDate = addBusinessDays(weekStart, LAUNCH_DAY_OFFSET);
  const awardedAt = fromBusinessDateTime(
    parseBusinessDate(addBusinessDays(weekStart, AWARD_DAY_OFFSET)),
    MATCH_SCHEDULE.fullTime,
  );
  return {
    weekStart,
    weekPeriod: isoWeekKey(weekStart),
    launchDate,
    qualifierWindow: matchWindow(parseBusinessDate(launchDate)),
    awardedAt,
    awardedDate: businessDateOf(awardedAt),
  };
};

async function chooseYear(): Promise<number> {
  return nextFixtureYear(
    parseFixtureLatestYear(await executeLocalD1(fixtureLatestYearSql())),
  );
}

async function resolveOpenOwner(
  handle: string | undefined,
): Promise<string | undefined> {
  if (handle === undefined) {
    return undefined;
  }
  return parseVerifiedUserId(
    await executeLocalD1(verifiedUserIdSql(handle)),
    handle,
  );
}

// (a)予選で勝った2つのプロダクトと、他のE2Eと重ならない過去の対象年の年の行と、その年のWeek優勝の受付中の枠・Ultrasで参加資格を得た枠を作る。
// 3つの期限の列だけを現在より十分に未来にする。前回の実行のデータは消さず、年・ハンドル・名称で分ける
export async function createYearTournamentEntrants(
  request: YearTournamentEntrantsRequest = {},
): Promise<YearTournamentFixture> {
  const openOwnerUserId = await resolveOpenOwner(request.openOwnerHandle);
  const year = await chooseYear();
  const openWeekStart = weekStartOf(`${String(year)}-${OPEN_WEEK_MONTH_DAY}`);
  const plan = planYearEntrants({
    year,
    finalDate: defaultFinalDate(year),
    open: scheduleOf(openWeekStart),
    ultras: scheduleOf(addBusinessDays(openWeekStart, DAYS_PER_WEEK)),
    now: new Date(),
    suffix: nextSuffix(),
    nextId: nextFixtureId,
    ...(openOwnerUserId === undefined ? {} : { openOwnerUserId }),
  });
  parseYearEntrantsInsert(
    await executeLocalD1(yearEntrantsInsertSql(plan)),
    plan,
  );
  return {
    yearTournamentId: plan.yearTournamentId,
    year,
    deadlineDate: plan.deadlineDate,
    open: entrantOf(plan.open),
    ultras: entrantOf(plan.ultras),
  };
}

// 参加費を画面で支払わずに組み合わせを作る補助の確認のE2Eでだけ、受付中の枠を参加資格に変える
export async function entitleOpenYearEntryWithoutPayment(
  fixture: YearTournamentFixture,
): Promise<void> {
  const updated = await executeLocalD1(
    openYearEntryEntitleSql(fixture.open.entryId, new Date()),
  );
  if (updated.length !== 1) {
    throw new Error(
      `受付中の枠(${fixture.open.entryId})を参加資格に変えられませんでした`,
    );
  }
}

// (b)年の3つの期限を決済期限日の規則どおりの過去の日時へ戻す。過去の対象年は他の年より前に並ぶため、次の23:45のジョブが最初に組み合わせを決める
export async function closeYearTournamentEntry(
  fixture: YearTournamentFixture,
): Promise<void> {
  const deadlineDate = parseBusinessDate(fixture.deadlineDate);
  const updated = await executeLocalD1(
    yearEntryWindowCloseSql(
      fixture.yearTournamentId,
      {
        acceptUntil: fromBusinessDateTime(deadlineDate, ACCEPT_UNTIL_TIME),
        deadlineAt: fromBusinessDateTime(deadlineDate, DEADLINE_TIME),
        drawAt: fromBusinessDateTime(deadlineDate, DRAW_TIME),
      },
      new Date(),
    ),
  );
  if (updated.length !== 1) {
    throw new Error(
      `Yearトーナメント(${String(fixture.year)}年)は組み合わせ決定の前の年ではありません`,
    );
  }
}

export async function readYearFinal(
  fixture: YearTournamentFixture,
): Promise<YearFinal | undefined> {
  return parseWeekFinal(
    await executeLocalD1(yearFinalSql(fixture.yearTournamentId)),
  );
}

export async function readYearTournamentState(
  fixture: YearTournamentFixture,
): Promise<YearTournamentState> {
  return parseYearTournamentState(
    await executeLocalD1(yearTournamentStateSql(fixture.yearTournamentId)),
    fixture.yearTournamentId,
  );
}

async function requireYearFinal(
  fixture: YearTournamentFixture,
): Promise<YearFinal> {
  const final = await readYearFinal(fixture);
  if (final === undefined) {
    throw new Error(
      `Yearトーナメント(${String(fixture.year)}年)に予定された決勝がありません。組み合わせ決定(23:45のジョブ)の後に呼んでください`,
    );
  }
  return final;
}

// (c)組み合わせで予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移し、開始を記録済みにする
export async function startYearFinalToday(
  fixture: YearTournamentFixture,
): Promise<YearFinal> {
  const final = await requireYearFinal(fixture);
  const now = new Date();
  const businessDate = businessDateOf(now);
  const window = matchWindow(parseBusinessDate(businessDate));
  const updated = await executeLocalD1(
    yearFinalStartSql(fixture.yearTournamentId, final, {
      businessDate,
      startsAt: new Date(
        Math.min(
          window.startsAt.getTime(),
          now.getTime() - FINAL_STARTED_AGO_MS,
        ),
      ),
      endsAt: new Date(
        Math.max(window.endsAt.getTime(), now.getTime() + FINAL_MIN_LIVE_MS),
      ),
      startedEventId: nextFixtureId(),
      now,
    }),
  );
  if (updated.length !== 1) {
    throw new Error(`決勝(${final.matchId})を開始済みにできませんでした`);
  }
  return requireYearFinal(fixture);
}

// (d)決勝の終了の日時を過去へ移す。決勝の書き換えはWeekの決勝と同じ表のため、Weekの補助で勝たせる側にサポーターのUpvoteを1票入れて終了の日時を移す。確定は23:40のジョブに任せる
export async function endYearFinal(
  final: YearFinal,
  winner: YearTournamentEntrant,
): Promise<void> {
  await endWeekFinal(final, winner);
}

// 当日の業務日付で23:40(マッチの確定)と23:45(組み合わせ決定・進行)のジョブを起こす。Yearトーナメントの夜の処理はWeekトーナメントと同じ23:45の起動で動くため、Weekの補助で起こす
export async function runYearEveningJobs(
  options: YearEveningJobsOptions = {},
): Promise<void> {
  await runWeekEveningJobs(options);
}

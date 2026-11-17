import { randomBytes, randomInt } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import {
  MATCH_SCHEDULE,
  matchWindow,
} from '../../apps/backend-lib/core/match/match-model.ts';
import {
  type BusinessTimeOfDay,
  parseBusinessDate,
} from '../../apps/backend-lib/core/time/business-time.ts';
import { entryWindowFor } from '../../apps/backend-lib/core/week-tournament/week-schedule.ts';
import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { executeLocalD1 } from './local-d1.ts';
import {
  addBusinessDays,
  businessDateOf,
  triggerScheduled,
} from './scheduled-trigger.ts';
import {
  chooseFixtureWeekStart,
  finalDecidedEventSql,
  fixtureWeekStartsSql,
  entryWindowCloseSql,
  openEntryEntitleSql,
  ownerIdOf,
  parseFinalDecidedEvent,
  parseFixtureWeekStarts,
  parseVerifiedUserId,
  parseWeekEntrantsInsert,
  parseWeekFinal,
  parseWeekFinalEnd,
  parseWeekTournamentState,
  planFixtureUser,
  planWeekEntrants,
  type PlannedEntrant,
  verifiedUserIdSql,
  type WeekFinal,
  weekEntrantsInsertSql,
  weekFinalEndSql,
  weekFinalSql,
  weekFinalStartSql,
  type WeekTournamentState,
  weekTournamentStateSql,
} from './week-tournament-fixture-sql.ts';

export type {
  WeekFinal,
  WeekTournamentState,
} from './week-tournament-fixture-sql.ts';

export interface WeekTournamentEntrantsRequest {
  // 参加費を画面で支払う流れでは、画面で登録した確認済みの利用者のハンドルを渡し、受付中の枠のプロダクトをその利用者のものにする
  readonly openOwnerHandle?: string;
}

export interface WeekTournamentEntrant {
  readonly ownerUserId: string;
  readonly productId: string;
  readonly productHandle: string;
  readonly productName: string;
  readonly launchId: string;
  readonly entryId: string;
}

export interface WeekTournamentFixture {
  readonly tournamentId: string;
  readonly weekStart: string;
  // 受付中の枠
  readonly open: WeekTournamentEntrant;
  // Ultrasの加入者として参加資格を得た枠
  readonly ultras: WeekTournamentEntrant;
}

export interface WeekEveningJobsOptions {
  // 23:40のジョブが確定させる決勝。渡すと、確定のイベントがイベントサーバーで処理を終えるのを待ってから23:45のジョブを起こす
  readonly awaitDecidedFinal?: WeekFinal;
}

const SUFFIX_BYTES = 4;

const MINUTE_MS = 60_000;

// 予選のローンチ日は週の水曜日にする
const LAUNCH_DAY_OFFSET = 2;

// 確定のジョブは実行の時刻で終了の日時を過ぎたマッチを選ぶため、作る時点より前の時刻を順に並べる
const FINAL_STARTED_AGO_MS = 3 * MINUTE_MS;
const FINAL_UPVOTED_AGO_MS = 2 * MINUTE_MS;
const FINAL_ENDED_AGO_MS = MINUTE_MS;

// 開始の後の画面の確認の途中で、他のテストが起こす23:40のジョブに決勝を確定させないよう、終了の日時を少なくともこの分だけ先にする
const FINAL_MIN_LIVE_MS = 10 * MINUTE_MS;

// 確定のイベントはキューを経てイベントサーバーが処理する。同じマッチの前のイベントの処理を待つ遅延を含めて待つ
const DECIDED_EVENT_TIMEOUT_MS = 90_000;
const DECIDED_EVENT_POLL_INTERVAL_MS = 1000;

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

const nextSuffix = (): string => randomBytes(SUFFIX_BYTES).toString('hex');

const businessTimeText = ({ hour, minute }: BusinessTimeOfDay): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const entrantOf = (entrant: PlannedEntrant): WeekTournamentEntrant => ({
  ownerUserId: ownerIdOf(entrant),
  productId: entrant.productId,
  productHandle: entrant.productHandle,
  productName: entrant.productName,
  launchId: entrant.launchId,
  entryId: entrant.weekEntryId,
});

async function chooseWeekStart(): Promise<string> {
  const used = parseFixtureWeekStarts(
    await executeLocalD1(fixtureWeekStartsSql()),
  );
  return chooseFixtureWeekStart(used, randomInt(2 ** 32) / 2 ** 32);
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

// (a)予選で勝った2つのプロダクトと、その週の受付中の枠・Ultrasで参加資格を得た枠を作る。週は他のテストの予選と重ならない過去の週にし、3つの期限の列だけを現在より十分に未来にする。前回の実行のデータは消さず、週・ハンドル・名称で分ける
export async function createWeekTournamentEntrants(
  request: WeekTournamentEntrantsRequest = {},
): Promise<WeekTournamentFixture> {
  const openOwnerUserId = await resolveOpenOwner(request.openOwnerHandle);
  const weekStart = await chooseWeekStart();
  const launchDate = addBusinessDays(weekStart, LAUNCH_DAY_OFFSET);
  const plan = planWeekEntrants({
    weekStart,
    launchDate,
    qualifierWindow: matchWindow(parseBusinessDate(launchDate)),
    now: new Date(),
    suffix: nextSuffix(),
    nextId: nextFixtureId,
    ...(openOwnerUserId === undefined ? {} : { openOwnerUserId }),
  });
  parseWeekEntrantsInsert(
    await executeLocalD1(weekEntrantsInsertSql(plan)),
    plan,
  );
  return {
    tournamentId: plan.tournamentId,
    weekStart,
    open: entrantOf(plan.open),
    ultras: entrantOf(plan.ultras),
  };
}

// 参加費を画面で支払わずに組み合わせを作る補助の確認のE2Eでだけ、受付中の枠を参加資格に変える
export async function entitleOpenEntryWithoutPayment(
  fixture: WeekTournamentFixture,
): Promise<void> {
  const updated = await executeLocalD1(
    openEntryEntitleSql(fixture.open.entryId, new Date()),
  );
  if (updated.length !== 1) {
    throw new Error(
      `受付中の枠(${fixture.open.entryId})を参加資格に変えられませんでした`,
    );
  }
}

// (b)週の3つの期限を規則どおりの過去の日時へ戻す。過去の週の組み合わせ決定の日時は他の週より前に並ぶため、次の23:45のジョブが最初に組み合わせを決める
export async function closeWeekTournamentEntry(
  fixture: WeekTournamentFixture,
): Promise<void> {
  const updated = await executeLocalD1(
    entryWindowCloseSql(
      fixture.tournamentId,
      entryWindowFor(parseBusinessDate(fixture.weekStart)),
      new Date(),
    ),
  );
  if (updated.length !== 1) {
    throw new Error(
      `Weekトーナメント(${fixture.tournamentId})は組み合わせ決定の前の週ではありません`,
    );
  }
}

export async function readWeekFinal(
  fixture: WeekTournamentFixture,
): Promise<WeekFinal | undefined> {
  return parseWeekFinal(
    await executeLocalD1(weekFinalSql(fixture.tournamentId)),
  );
}

export async function readWeekTournamentState(
  fixture: WeekTournamentFixture,
): Promise<WeekTournamentState> {
  return parseWeekTournamentState(
    await executeLocalD1(weekTournamentStateSql(fixture.tournamentId)),
    fixture.tournamentId,
  );
}

async function requireWeekFinal(
  fixture: WeekTournamentFixture,
): Promise<WeekFinal> {
  const final = await readWeekFinal(fixture);
  if (final === undefined) {
    throw new Error(
      `Weekトーナメント(${fixture.tournamentId})に予定された決勝がありません。組み合わせ決定(23:45のジョブ)の後に呼んでください`,
    );
  }
  return final;
}

// (c)組み合わせで予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移し、開始を記録済みにする
export async function startWeekFinalToday(
  fixture: WeekTournamentFixture,
): Promise<WeekFinal> {
  const final = await requireWeekFinal(fixture);
  const now = new Date();
  const businessDate = businessDateOf(now);
  const window = matchWindow(parseBusinessDate(businessDate));
  const updated = await executeLocalD1(
    weekFinalStartSql(final, {
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
  return requireWeekFinal(fixture);
}

// (d)決勝の終了の日時を過去へ移す。0票同士では受賞が無いため、勝たせる側にサポーターのUpvoteを1票入れる。確定は23:40のジョブに任せる
export async function endWeekFinal(
  final: WeekFinal,
  winner: WeekTournamentEntrant,
): Promise<void> {
  const now = new Date();
  const upvoteId = nextFixtureId();
  parseWeekFinalEnd(
    await executeLocalD1(
      weekFinalEndSql(final, {
        supporter: planFixtureUser('supporter', nextSuffix(), nextFixtureId),
        upvoteId,
        winnerProductId: winner.productId,
        upvotedAt: new Date(now.getTime() - FINAL_UPVOTED_AGO_MS),
        endsAt: new Date(now.getTime() - FINAL_ENDED_AGO_MS),
        now,
      }),
    ),
    final,
    upvoteId,
  );
}

async function waitForDecidedEventCompleted(final: WeekFinal): Promise<void> {
  const deadline = Date.now() + DECIDED_EVENT_TIMEOUT_MS;
  let status: 'pending' | 'completed' | undefined;
  for (;;) {
    status = parseFinalDecidedEvent(
      await executeLocalD1(finalDecidedEventSql(final.matchId)),
    );
    if (status === 'completed') {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `決勝(${final.matchId})の確定のイベントの処理が終わりません(状態: ${status ?? '未作成'})。APIサーバーの23:40の確定のジョブとイベントサーバーのキューの処理のログを確かめてください`,
      );
    }
    await setTimeout(DECIDED_EVENT_POLL_INTERVAL_MS);
  }
}

// 当日の業務日付で23:40(マッチの確定)と23:45(組み合わせ決定・進行)のジョブを起こす。ジョブの失敗も応答は成功になるため、結果はローカルのD1か画面で確かめる
export async function runWeekEveningJobs(
  options: WeekEveningJobsOptions = {},
): Promise<void> {
  const businessDate = businessDateOf(new Date());
  await triggerScheduled({
    worker: 'api',
    businessDate,
    businessTime: businessTimeText(MATCH_SCHEDULE.fullTime),
  });
  if (options.awaitDecidedFinal !== undefined) {
    await waitForDecidedEventCompleted(options.awaitDecidedFinal);
  }
  // Weekトーナメントの組み合わせ決定と進行は、予選のペアリングと同じ23:45の起動で動く
  await triggerScheduled({
    worker: 'api',
    businessDate,
    businessTime: businessTimeText(MATCH_SCHEDULE.pairing),
  });
}

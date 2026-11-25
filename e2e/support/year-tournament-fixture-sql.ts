import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import type { MatchWindow } from '../../apps/backend-lib/core/match/match-model.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../apps/common-lib/product/product-category-constants.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import { TEST_EMAIL_DOMAIN } from './test-email.ts';
import {
  type EntrantOwner,
  type FixtureEntryWindow,
  type FixtureUser,
  type WeekFinal,
  type WeekFinalStartWrite,
  weekFinalStartSql,
} from './week-tournament-fixture-sql.ts';

// 単体テストのカバレッジが読み込んだ他のアプリのファイルを分母に数えるため、週・ローンチ日・予選の時間帯・Week優勝の日時は規則のモジュールを読まずに呼び出し側から受け取る
export interface YearEntrantSchedule {
  readonly weekStart: string;
  readonly weekPeriod: string;
  readonly launchDate: string;
  readonly qualifierWindow: MatchWindow;
  readonly awardedAt: Date;
  readonly awardedDate: string;
}

export interface YearEntrantsInput {
  readonly year: number;
  readonly finalDate: string;
  readonly open: YearEntrantSchedule;
  readonly ultras: YearEntrantSchedule;
  readonly now: Date;
  readonly suffix: string;
  readonly nextId: () => string;
  // 参加費を画面で支払う投稿者は画面で登録したアカウントを使うため、そのIDを渡す。省くと補助が利用者を作る
  readonly openOwnerUserId?: string;
}

export interface PlannedYearEntrant {
  readonly owner: EntrantOwner;
  readonly schedule: YearEntrantSchedule;
  readonly productId: string;
  readonly launchId: string;
  readonly qualifierMatchId: string;
  readonly qualifierEntryId: string;
  readonly decidedEventId: string;
  readonly logoFileId: string;
  readonly weekTournamentId: string;
  readonly yearEntryId: string;
  readonly productHandle: string;
  readonly productName: string;
  readonly tagline: string;
  readonly websiteUrl: string;
}

export interface YearEntrantsPlan {
  readonly yearTournamentId: string;
  readonly year: number;
  readonly finalDate: string;
  readonly deadlineDate: string;
  readonly window: FixtureEntryWindow;
  readonly changeLockAt: Date;
  readonly now: Date;
  readonly open: PlannedYearEntrant;
  readonly ultras: PlannedYearEntrant;
}

export interface YearTournamentState {
  readonly status: string;
  readonly outcome: string | null;
  readonly bracketId: string | null;
  readonly participantCount: number | null;
  readonly firstRoundDate: string | null;
  readonly championProductId: string | null;
}

const MILLISECONDS_PER_DAY = 86_400_000;

const MINUTE_MS = 60_000;

const HOUR_MS = 3_600_000;

// 組み合わせ決定は対象期間の全ての枠を分類するため、他のテストや実際の年と重ならない過去の対象年(1001〜2025年)を使う
export const FIXTURE_YEAR_FIRST = 1001;

const FIXTURE_YEAR_LIMIT = 2026;

// 対象期間は前の年の決済期限日から自分の年の決済期限日の前日までのため、年の中のどの日のWeek優勝も対象にできるよう決済期限日を年末にする
const FIXTURE_DEADLINE_MONTH_DAY = '12-31';

// 受付期限から決済期限・組み合わせ決定までの間隔は規則(23:00・23:35・23:45)と同じにする
const ENTRY_OPEN_FOR_MS = 7 * MILLISECONDS_PER_DAY;
const DEADLINE_AFTER_ACCEPT_UNTIL_MS = 35 * MINUTE_MS;
const DRAW_AFTER_ACCEPT_UNTIL_MS = 45 * MINUTE_MS;

// 変更期限(決勝日の7日前の0:00)は受付期限(決勝日の6日前の23:00)の47時間前になる
const CHANGE_LOCK_BEFORE_ACCEPT_UNTIL_MS = 47 * HOUR_MS;

const SUFFIX_PATTERN = /^[0-9a-z]{4,12}$/u;

// ログインさせない利用者のため、どのパスワードの検証にも一致しない値にする
const UNUSABLE_PASSWORD_HASH = sqlStringLiteral('e2e-fixture-unusable');

const QUALIFIER = sqlStringLiteral('qualifier');

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `SQLの整数のリテラルにできない値です: ${String(value)}`,
    );
  }
  return String(value);
};

const timeLiteral = (at: Date): string => integerLiteral(at.getTime());

const nullableTimeLiteral = (at: Date | null): string =>
  at === null ? 'NULL' : timeLiteral(at);

const valuesOf = (values: readonly string[]): string =>
  `(${values.join(', ')})`;

const yearText = (year: number): string => String(year).padStart(4, '0');

export function fixtureLatestYearSql(): string {
  return `SELECT MAX(year) AS latest FROM year_tournaments WHERE year < ${integerLiteral(FIXTURE_YEAR_LIMIT)};`;
}

export function parseFixtureLatestYear(
  rows: readonly LocalD1Row[],
): number | null {
  const [row] = rows;
  const latest = row?.latest;
  if (rows.length !== 1 || !(latest === null || typeof latest === 'number')) {
    throw new Error(
      `過去の対象年の照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  }
  return latest;
}

// 前回までの実行が使った年の翌年を使う
export function nextFixtureYear(latest: number | null): number {
  const year =
    latest === null
      ? FIXTURE_YEAR_FIRST
      : Math.max(latest + 1, FIXTURE_YEAR_FIRST);
  if (year >= FIXTURE_YEAR_LIMIT) {
    throw new Error(
      'E2Eの補助が使える過去の対象年が残っていません。ローカルのD1を作り直してください',
    );
  }
  return year;
}

export function planYearFixtureUser(
  role: string,
  suffix: string,
  nextId: () => string,
): FixtureUser {
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new RangeError(
      `識別子の接尾辞は英小文字と数字の4〜12文字で指定してください: ${suffix}`,
    );
  }
  const handle = `e2e-year-${suffix}-${role}`;
  return {
    id: nextId(),
    pseudonymousId: nextId(),
    handle,
    nickname: `E2EのYearの${role}${suffix}`,
    email: `${handle}@${TEST_EMAIL_DOMAIN}`,
  };
}

const assertSchedule = (
  schedule: YearEntrantSchedule,
  year: number,
  deadlineDate: string,
): void => {
  if (
    schedule.awardedDate < `${yearText(year)}-01-01` ||
    schedule.awardedDate >= deadlineDate ||
    schedule.awardedDate < schedule.launchDate
  ) {
    throw new RangeError(
      `Week優勝の日は、ローンチ日以後で対象年の決済期限日より前の対象年の日付で指定してください: ${schedule.awardedDate}`,
    );
  }
};

const planEntrant = (
  role: 'open' | 'ultras',
  owner: EntrantOwner,
  schedule: YearEntrantSchedule,
  suffix: string,
  nextId: () => string,
): PlannedYearEntrant => ({
  owner,
  schedule,
  productId: nextId(),
  launchId: nextId(),
  qualifierMatchId: nextId(),
  qualifierEntryId: nextId(),
  decidedEventId: nextId(),
  logoFileId: nextId(),
  weekTournamentId: nextId(),
  yearEntryId: nextId(),
  productHandle: `e2e-year-${suffix}-${role}`,
  productName: `E2EのYear${suffix}-${role}`,
  tagline: `E2EのYearのタグライン${suffix}-${role}`,
  websiteUrl: `https://year-${suffix}.example/${role}`,
});

export function planYearEntrants({
  year,
  finalDate,
  open,
  ultras,
  now,
  suffix,
  nextId,
  openOwnerUserId,
}: YearEntrantsInput): YearEntrantsPlan {
  if (
    !Number.isSafeInteger(year) ||
    year < FIXTURE_YEAR_FIRST ||
    year >= FIXTURE_YEAR_LIMIT
  ) {
    throw new RangeError(
      `対象年は${String(FIXTURE_YEAR_FIRST)}〜${String(FIXTURE_YEAR_LIMIT - 1)}年で指定してください: ${String(year)}`,
    );
  }
  if (!finalDate.startsWith(`${yearText(year)}-`)) {
    throw new RangeError(
      `決勝日は対象年(${String(year)}年)の日付で指定してください: ${finalDate}`,
    );
  }
  const deadlineDate = `${yearText(year)}-${FIXTURE_DEADLINE_MONTH_DAY}`;
  assertSchedule(open, year, deadlineDate);
  assertSchedule(ultras, year, deadlineDate);
  const ownerOf = (role: 'open' | 'ultras'): EntrantOwner =>
    role === 'open' && openOwnerUserId !== undefined
      ? { kind: 'existing', userId: openOwnerUserId }
      : { kind: 'new', user: planYearFixtureUser(role, suffix, nextId) };
  const acceptUntil = new Date(now.getTime() + ENTRY_OPEN_FOR_MS);
  return {
    yearTournamentId: nextId(),
    year,
    finalDate,
    deadlineDate,
    window: {
      acceptUntil,
      deadlineAt: new Date(
        acceptUntil.getTime() + DEADLINE_AFTER_ACCEPT_UNTIL_MS,
      ),
      drawAt: new Date(acceptUntil.getTime() + DRAW_AFTER_ACCEPT_UNTIL_MS),
    },
    changeLockAt: new Date(
      acceptUntil.getTime() - CHANGE_LOCK_BEFORE_ACCEPT_UNTIL_MS,
    ),
    now,
    open: planEntrant('open', ownerOf('open'), open, suffix, nextId),
    ultras: planEntrant('ultras', ownerOf('ultras'), ultras, suffix, nextId),
  };
}

export const yearOwnerIdOf = ({ owner }: PlannedYearEntrant): string =>
  owner.kind === 'new' ? owner.user.id : owner.userId;

const usersInsertSql = (
  users: readonly FixtureUser[],
  created: string,
): string =>
  `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES ${users
    .map((user) =>
      valuesOf([
        sqlStringLiteral(user.id),
        sqlStringLiteral(user.pseudonymousId),
        sqlStringLiteral(user.email),
        UNUSABLE_PASSWORD_HASH,
        sqlStringLiteral(user.nickname),
        sqlStringLiteral(user.handle),
        created,
        created,
        created,
        created,
      ]),
    )
    .join(', ')};`;

// 予選は開始時点で確定した不戦勝にし、確定のイベントを処理済みの形で持たせる。
// Yearトーナメントの照会と組み合わせ決定は枠に写したWeek優勝の値だけを読み、Weekトーナメントの行を読まないため、Weekトーナメントの行と枠は作らない。
// 年の行は途中で失敗しても使った年として残るよう先頭で作る
export function yearEntrantsInsertSql(plan: YearEntrantsPlan): string {
  const { open, ultras, now } = plan;
  const entrants = [open, ultras];
  const created = timeLiteral(now);
  const rows = (valuesOfEntrant: (entrant: PlannedYearEntrant) => string[]) =>
    entrants.map((entrant) => valuesOf(valuesOfEntrant(entrant))).join(', ');
  const newUsers = entrants.flatMap(({ owner }) =>
    owner.kind === 'new' ? [owner.user] : [],
  );
  const kickoffOf = ({ schedule }: PlannedYearEntrant): string =>
    timeLiteral(schedule.qualifierWindow.startsAt);
  const launchDateOf = ({ schedule }: PlannedYearEntrant): string =>
    sqlStringLiteral(schedule.launchDate);
  const yearEntryValues = (
    entrant: PlannedYearEntrant,
    status: string,
    entitlementSource: string | null,
    entitledAt: Date | null,
  ): string =>
    valuesOf([
      sqlStringLiteral(entrant.yearEntryId),
      sqlStringLiteral(entrant.weekTournamentId),
      sqlStringLiteral(entrant.schedule.weekPeriod),
      sqlStringLiteral(entrant.launchId),
      sqlStringLiteral(entrant.productId),
      sqlStringLiteral(yearOwnerIdOf(entrant)),
      launchDateOf(entrant),
      sqlStringLiteral(entrant.qualifierMatchId),
      '0',
      timeLiteral(entrant.schedule.awardedAt),
      sqlStringLiteral(entrant.schedule.awardedDate),
      sqlStringLiteral(status),
      entitlementSource === null ? 'NULL' : sqlStringLiteral(entitlementSource),
      nullableTimeLiteral(entitledAt),
      created,
      created,
    ]);
  return [
    `INSERT INTO year_tournaments (id, year, final_date, final_date_source, deadline_date, accept_until, deadline_at, draw_at, change_lock_at, status, created_at, updated_at) VALUES ${valuesOf(
      [
        sqlStringLiteral(plan.yearTournamentId),
        integerLiteral(plan.year),
        sqlStringLiteral(plan.finalDate),
        sqlStringLiteral('default'),
        sqlStringLiteral(plan.deadlineDate),
        timeLiteral(plan.window.acceptUntil),
        timeLiteral(plan.window.deadlineAt),
        timeLiteral(plan.window.drawAt),
        timeLiteral(plan.changeLockAt),
        sqlStringLiteral('open'),
        created,
        created,
      ],
    )};`,
    ...(newUsers.length === 0 ? [] : [usersInsertSql(newUsers, created)]),
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.productId),
        sqlStringLiteral(yearOwnerIdOf(entrant)),
        sqlStringLiteral(PRODUCT_CATEGORY_OTHER_ID),
        sqlStringLiteral(entrant.productHandle),
        sqlStringLiteral(entrant.productName),
        sqlStringLiteral(entrant.tagline),
        sqlStringLiteral(entrant.websiteUrl),
        sqlStringLiteral(`${entrant.productName}の説明文です。`),
        sqlStringLiteral(entrant.logoFileId),
        launchDateOf(entrant),
        created,
        created,
      ],
    )};`,
    `INSERT INTO product_launches (id, product_id, launch_date, outcome, decided_at, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.launchId),
        sqlStringLiteral(entrant.productId),
        launchDateOf(entrant),
        sqlStringLiteral('won'),
        kickoffOf(entrant),
        created,
        created,
      ],
    )};`,
    `INSERT INTO matches (id, kind, match_date, starts_at, ends_at, started_at, decided_at, decision, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.qualifierMatchId),
        QUALIFIER,
        launchDateOf(entrant),
        kickoffOf(entrant),
        timeLiteral(entrant.schedule.qualifierWindow.endsAt),
        kickoffOf(entrant),
        kickoffOf(entrant),
        sqlStringLiteral('bye'),
        created,
        created,
      ],
    )};`,
    `INSERT INTO match_events (id, match_id, match_kind, type, occurred_at, status, dispatch_count, last_dispatched_at, completed_at, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.decidedEventId),
        sqlStringLiteral(entrant.qualifierMatchId),
        QUALIFIER,
        sqlStringLiteral('decided'),
        kickoffOf(entrant),
        sqlStringLiteral('completed'),
        '1',
        kickoffOf(entrant),
        kickoffOf(entrant),
        created,
        created,
      ],
    )};`,
    `INSERT INTO match_entries (id, match_id, slot, match_kind, match_date, launch_id, product_id, owner_user_id, result, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.qualifierEntryId),
        sqlStringLiteral(entrant.qualifierMatchId),
        '1',
        QUALIFIER,
        launchDateOf(entrant),
        sqlStringLiteral(entrant.launchId),
        sqlStringLiteral(entrant.productId),
        sqlStringLiteral(yearOwnerIdOf(entrant)),
        sqlStringLiteral('bye'),
        created,
        created,
      ],
    )};`,
    `INSERT INTO year_tournament_entries (id, week_tournament_id, week_period, launch_id, product_id, owner_user_id, launch_date, qualifier_match_id, qualifier_upvote_count, awarded_at, awarded_date, status, entitlement_source, entitled_at, created_at, updated_at) VALUES ${yearEntryValues(open, 'awaiting_payment', null, null)}, ${yearEntryValues(ultras, 'entitled', 'ultras', now)} RETURNING id;`,
  ].join('\n');
}

export function parseYearEntrantsInsert(
  rows: readonly LocalD1Row[],
  plan: YearEntrantsPlan,
): void {
  const inserted = new Set(rows.map((row) => row.id));
  if (
    rows.length !== 2 ||
    !inserted.has(plan.open.yearEntryId) ||
    !inserted.has(plan.ultras.yearEntryId)
  ) {
    throw new Error(
      `${String(plan.year)}年のYearトーナメントの参加の枠を2件作れませんでした: ${JSON.stringify(rows)}`,
    );
  }
}

// 参加費の支払いを画面で行わない補助の確認のE2Eでだけ使う。決済の記録を持たないため、出どころはUltrasにする
export function openYearEntryEntitleSql(entryId: string, now: Date): string {
  const at = timeLiteral(now);
  return `UPDATE year_tournament_entries SET status = 'entitled', entitlement_source = 'ultras', entitled_at = ${at}, updated_at = ${at} WHERE id = ${sqlStringLiteral(entryId)} AND status = 'awaiting_payment' RETURNING id;`;
}

// 組み合わせ決定の前の年だけを対象にし、次の23:45の起動が組み合わせを決める。決済期限日は変えず、対象期間を保つ
export function yearEntryWindowCloseSql(
  yearTournamentId: string,
  window: FixtureEntryWindow,
  now: Date,
): string {
  if (
    window.drawAt.getTime() > now.getTime() ||
    window.acceptUntil.getTime() >= window.deadlineAt.getTime() ||
    window.deadlineAt.getTime() >= window.drawAt.getTime()
  ) {
    throw new RangeError(
      '受付期限・決済期限・組み合わせ決定の日時は、この順に現在より過去で指定してください',
    );
  }
  return `UPDATE year_tournaments SET accept_until = ${timeLiteral(window.acceptUntil)}, deadline_at = ${timeLiteral(window.deadlineAt)}, draw_at = ${timeLiteral(window.drawAt)}, updated_at = ${timeLiteral(now)} WHERE id = ${sqlStringLiteral(yearTournamentId)} AND status = 'open' AND draw_started_at IS NULL RETURNING id;`;
}

// 結果の行はWeekの補助の決勝と同じ列にし、parseWeekFinalで読む
export function yearFinalSql(yearTournamentId: string): string {
  return `SELECT bm.match_id AS match_id, bm.bracket_id AS bracket_id, bm.round AS round, bm.match_date AS match_date, bm.status AS bracket_status, m.started_at AS started_at, m.decided_at AS decided_at, me.product_id AS product_id FROM year_tournaments yt JOIN tournament_brackets b ON b.id = yt.bracket_id JOIN bracket_matches bm ON bm.bracket_id = b.id AND bm.round = b.round_count JOIN matches m ON m.id = bm.match_id JOIN match_entries me ON me.match_id = m.id WHERE yt.id = ${sqlStringLiteral(yearTournamentId)} ORDER BY me.slot;`;
}

// ブラケットとマッチの書き換えはWeekの決勝と同じ表のためWeekの補助の文を使い、年の行が記録する1回戦の日も同じ日へ移す
export function yearFinalStartSql(
  yearTournamentId: string,
  final: WeekFinal,
  write: WeekFinalStartWrite,
): string {
  const bracketSql = weekFinalStartSql(final, write);
  return [
    `UPDATE year_tournaments SET first_round_date = ${sqlStringLiteral(write.businessDate)}, updated_at = ${timeLiteral(write.now)} WHERE id = ${sqlStringLiteral(yearTournamentId)} AND bracket_id = ${sqlStringLiteral(final.bracketId)} AND first_round_date = ${sqlStringLiteral(final.matchDate)};`,
    bracketSql,
  ].join('\n');
}

export function yearTournamentStateSql(yearTournamentId: string): string {
  return `SELECT yt.status AS status, yt.outcome AS outcome, yt.bracket_id AS bracket_id, yt.participant_count AS participant_count, yt.first_round_date AS first_round_date, e.product_id AS champion_product_id FROM year_tournaments yt LEFT JOIN year_tournament_entries e ON e.id = yt.champion_entry_id WHERE yt.id = ${sqlStringLiteral(yearTournamentId)};`;
}

const nullableStringOf = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
};

const nullableNumberOf = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' ? value : undefined;
};

export function parseYearTournamentState(
  rows: readonly LocalD1Row[],
  yearTournamentId: string,
): YearTournamentState {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`Yearトーナメント(${yearTournamentId})が見つかりません`);
  }
  const { status } = row;
  const outcome = nullableStringOf(row.outcome);
  const bracketId = nullableStringOf(row.bracket_id);
  const participantCount = nullableNumberOf(row.participant_count);
  const firstRoundDate = nullableStringOf(row.first_round_date);
  const championProductId = nullableStringOf(row.champion_product_id);
  if (
    typeof status !== 'string' ||
    outcome === undefined ||
    bracketId === undefined ||
    participantCount === undefined ||
    firstRoundDate === undefined ||
    championProductId === undefined
  ) {
    throw new Error(
      `Yearトーナメントの照会の結果の形式が正しくありません: ${JSON.stringify(row)}`,
    );
  }
  return {
    status,
    outcome,
    bracketId,
    participantCount,
    firstRoundDate,
    championProductId,
  };
}

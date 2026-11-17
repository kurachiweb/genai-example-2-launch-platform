import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import type { MatchWindow } from '../../apps/backend-lib/core/match/match-model.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../apps/common-lib/product/product-category-constants.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import { TEST_EMAIL_DOMAIN } from './test-email.ts';

export interface FixtureUser {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly email: string;
}

export type EntrantOwner =
  | { readonly kind: 'new'; readonly user: FixtureUser }
  | { readonly kind: 'existing'; readonly userId: string };

export interface PlannedEntrant {
  readonly owner: EntrantOwner;
  readonly productId: string;
  readonly launchId: string;
  readonly qualifierMatchId: string;
  readonly qualifierEntryId: string;
  readonly decidedEventId: string;
  readonly logoFileId: string;
  readonly weekEntryId: string;
  readonly productHandle: string;
  readonly productName: string;
  readonly tagline: string;
  readonly websiteUrl: string;
}

export interface FixtureEntryWindow {
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
}

// 単体テストのカバレッジが読み込んだ他のアプリのファイルを分母に数えるため、週の初日・ローンチ日・予選の時間帯は規則のモジュールを読まずに呼び出し側から受け取る
export interface WeekEntrantsInput {
  readonly weekStart: string;
  readonly launchDate: string;
  readonly qualifierWindow: MatchWindow;
  readonly now: Date;
  readonly suffix: string;
  readonly nextId: () => string;
  // 参加費を画面で支払う投稿者は画面で登録したアカウントを使うため、そのIDを渡す。省くと補助が利用者を作る
  readonly openOwnerUserId?: string;
}

export interface WeekEntrantsPlan {
  readonly tournamentId: string;
  readonly weekStart: string;
  readonly launchDate: string;
  readonly qualifierWindow: MatchWindow;
  readonly window: FixtureEntryWindow;
  readonly now: Date;
  readonly open: PlannedEntrant;
  readonly ultras: PlannedEntrant;
}

export const WEEK_FINAL_BRACKET_STATUSES = Object.freeze([
  'planned',
  'scheduled',
  'decided',
] as const);

export type WeekFinalBracketStatus =
  (typeof WEEK_FINAL_BRACKET_STATUSES)[number];

export interface WeekFinal {
  readonly matchId: string;
  readonly bracketId: string;
  readonly round: number;
  readonly matchDate: string;
  readonly bracketStatus: WeekFinalBracketStatus;
  readonly startedAt: Date | null;
  readonly decidedAt: Date | null;
  // 側の枠の順
  readonly productIds: readonly string[];
}

export interface WeekFinalStartWrite {
  readonly businessDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly startedEventId: string;
  readonly now: Date;
}

export interface WeekFinalEndWrite {
  readonly supporter: FixtureUser;
  readonly upvoteId: string;
  readonly winnerProductId: string;
  readonly upvotedAt: Date;
  readonly endsAt: Date;
  readonly now: Date;
}

export interface WeekTournamentState {
  readonly status: string;
  readonly outcome: string | null;
  readonly bracketId: string | null;
  readonly championProductId: string | null;
}

const MILLISECONDS_PER_DAY = 86_400_000;

const MINUTE_MS = 60_000;

// 組み合わせ決定は週の7日の予選の勝者のうち枠の無いものを補うため、他のテストの予選と重ならない過去の週(2000-01-03〜2019-12-30の月曜日)を使う
const FIXTURE_WEEK_FIRST_START_MS = Date.UTC(2000, 0, 3);

export const FIXTURE_WEEK_COUNT = 1044;

const FIXTURE_WEEK_LAST_START = new Date(
  FIXTURE_WEEK_FIRST_START_MS +
    (FIXTURE_WEEK_COUNT - 1) * 7 * MILLISECONDS_PER_DAY,
)
  .toISOString()
  .slice(0, 10);

// 受付期限から決済期限・組み合わせ決定までの間隔は規則(23:00・23:35・23:45)と同じにする
const ENTRY_OPEN_FOR_MS = 7 * MILLISECONDS_PER_DAY;
const DEADLINE_AFTER_ACCEPT_UNTIL_MS = 35 * MINUTE_MS;
const DRAW_AFTER_ACCEPT_UNTIL_MS = 45 * MINUTE_MS;

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

const fixtureWeekStartOf = (index: number): string =>
  new Date(FIXTURE_WEEK_FIRST_START_MS + index * 7 * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);

export function fixtureWeekStartsSql(): string {
  return `SELECT week_start FROM week_tournaments WHERE week_start BETWEEN ${sqlStringLiteral(fixtureWeekStartOf(0))} AND ${sqlStringLiteral(FIXTURE_WEEK_LAST_START)};`;
}

export function parseFixtureWeekStarts(
  rows: readonly LocalD1Row[],
): ReadonlySet<string> {
  return new Set(
    rows.map((row) => {
      const { week_start: weekStart } = row;
      if (typeof weekStart !== 'string') {
        throw new Error(
          `週の初日の照会の結果の形式が正しくありません: ${JSON.stringify(row)}`,
        );
      }
      return weekStart;
    }),
  );
}

// 前回までの実行が使った週を避け、乱数で選んだ位置から順に空いている週を探す
export function chooseFixtureWeekStart(
  used: ReadonlySet<string>,
  random: number,
): string {
  if (!(random >= 0 && random < 1)) {
    throw new RangeError(
      `乱数は0以上1未満で指定してください: ${String(random)}`,
    );
  }
  const first = Math.floor(random * FIXTURE_WEEK_COUNT);
  for (let offset = 0; offset < FIXTURE_WEEK_COUNT; offset += 1) {
    const weekStart = fixtureWeekStartOf((first + offset) % FIXTURE_WEEK_COUNT);
    if (!used.has(weekStart)) {
      return weekStart;
    }
  }
  throw new Error(
    'E2Eの補助が使える過去の週が残っていません。ローカルのD1を作り直してください',
  );
}

export function verifiedUserIdSql(handle: string): string {
  return `SELECT id FROM users WHERE handle = ${sqlStringLiteral(handle)} AND deleted_at IS NULL AND status = 'active' AND email_verified_at IS NOT NULL;`;
}

export function parseVerifiedUserId(
  rows: readonly LocalD1Row[],
  handle: string,
): string {
  const [row] = rows;
  if (rows.length !== 1 || typeof row?.id !== 'string') {
    throw new Error(
      `メールアドレスを確認済みで可視の利用者(${handle})が見つかりません`,
    );
  }
  return row.id;
}

const fixtureUserOf = (
  handle: string,
  nickname: string,
  nextId: () => string,
): FixtureUser => ({
  id: nextId(),
  pseudonymousId: nextId(),
  handle,
  nickname,
  email: `${handle}@${TEST_EMAIL_DOMAIN}`,
});

export function planFixtureUser(
  role: string,
  suffix: string,
  nextId: () => string,
): FixtureUser {
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new RangeError(
      `識別子の接尾辞は英小文字と数字の4〜12文字で指定してください: ${suffix}`,
    );
  }
  return fixtureUserOf(
    `e2e-week-${suffix}-${role}`,
    `E2EのWeekの${role}${suffix}`,
    nextId,
  );
}

const planEntrant = (
  role: 'open' | 'ultras',
  owner: EntrantOwner,
  suffix: string,
  nextId: () => string,
): PlannedEntrant => ({
  owner,
  productId: nextId(),
  launchId: nextId(),
  qualifierMatchId: nextId(),
  qualifierEntryId: nextId(),
  decidedEventId: nextId(),
  logoFileId: nextId(),
  weekEntryId: nextId(),
  productHandle: `e2e-week-${suffix}-${role}`,
  productName: `E2EのWeek${suffix}-${role}`,
  tagline: `E2EのWeekのタグライン${suffix}-${role}`,
  websiteUrl: `https://week-${suffix}.example/${role}`,
});

export function planWeekEntrants({
  weekStart,
  launchDate,
  qualifierWindow,
  now,
  suffix,
  nextId,
  openOwnerUserId,
}: WeekEntrantsInput): WeekEntrantsPlan {
  const ownerOf = (role: 'open' | 'ultras'): EntrantOwner =>
    role === 'open' && openOwnerUserId !== undefined
      ? { kind: 'existing', userId: openOwnerUserId }
      : { kind: 'new', user: planFixtureUser(role, suffix, nextId) };
  const acceptUntil = new Date(now.getTime() + ENTRY_OPEN_FOR_MS);
  return {
    tournamentId: nextId(),
    weekStart,
    launchDate,
    qualifierWindow,
    window: {
      acceptUntil,
      deadlineAt: new Date(
        acceptUntil.getTime() + DEADLINE_AFTER_ACCEPT_UNTIL_MS,
      ),
      drawAt: new Date(acceptUntil.getTime() + DRAW_AFTER_ACCEPT_UNTIL_MS),
    },
    now,
    open: planEntrant('open', ownerOf('open'), suffix, nextId),
    ultras: planEntrant('ultras', ownerOf('ultras'), suffix, nextId),
  };
}

export const ownerIdOf = ({ owner }: PlannedEntrant): string =>
  owner.kind === 'new' ? owner.user.id : owner.userId;

const userValuesOf = (user: FixtureUser, created: string): string =>
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
  ]);

const usersInsertSql = (
  users: readonly FixtureUser[],
  created: string,
): string =>
  `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES ${users.map((user) => userValuesOf(user, created)).join(', ')};`;

// 予選は開始時点で確定した不戦勝にし、確定のイベントを処理済みの形で持たせる。枠と週の行はこの補助が作るため、確定の後続の処理(枠の作成・掲載)を起こさない。週の行は外部キーの参照先で、途中で失敗しても使った週として残るよう先頭で作る
export function weekEntrantsInsertSql(plan: WeekEntrantsPlan): string {
  const { open, ultras, qualifierWindow, now } = plan;
  const entrants = [open, ultras];
  const created = timeLiteral(now);
  const date = sqlStringLiteral(plan.launchDate);
  const kickoff = timeLiteral(qualifierWindow.startsAt);
  const fullTime = timeLiteral(qualifierWindow.endsAt);
  const rows = (valuesOfEntrant: (entrant: PlannedEntrant) => string[]) =>
    entrants.map((entrant) => valuesOf(valuesOfEntrant(entrant))).join(', ');
  const newUsers = entrants.flatMap(({ owner }) =>
    owner.kind === 'new' ? [owner.user] : [],
  );
  const weekEntryValues = (
    entrant: PlannedEntrant,
    status: string,
    entitlementSource: string | null,
    entitledAt: Date | null,
  ): string =>
    valuesOf([
      sqlStringLiteral(entrant.weekEntryId),
      sqlStringLiteral(plan.tournamentId),
      sqlStringLiteral(entrant.launchId),
      sqlStringLiteral(entrant.productId),
      sqlStringLiteral(ownerIdOf(entrant)),
      date,
      sqlStringLiteral(entrant.qualifierMatchId),
      '0',
      kickoff,
      sqlStringLiteral(status),
      entitlementSource === null ? 'NULL' : sqlStringLiteral(entitlementSource),
      nullableTimeLiteral(entitledAt),
      created,
      created,
    ]);
  return [
    `INSERT INTO week_tournaments (id, week_start, accept_until, deadline_at, draw_at, status, created_at, updated_at) VALUES ${valuesOf(
      [
        sqlStringLiteral(plan.tournamentId),
        sqlStringLiteral(plan.weekStart),
        timeLiteral(plan.window.acceptUntil),
        timeLiteral(plan.window.deadlineAt),
        timeLiteral(plan.window.drawAt),
        sqlStringLiteral('open'),
        created,
        created,
      ],
    )};`,
    ...(newUsers.length === 0 ? [] : [usersInsertSql(newUsers, created)]),
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.productId),
        sqlStringLiteral(ownerIdOf(entrant)),
        sqlStringLiteral(PRODUCT_CATEGORY_OTHER_ID),
        sqlStringLiteral(entrant.productHandle),
        sqlStringLiteral(entrant.productName),
        sqlStringLiteral(entrant.tagline),
        sqlStringLiteral(entrant.websiteUrl),
        sqlStringLiteral(`${entrant.productName}の説明文です。`),
        sqlStringLiteral(entrant.logoFileId),
        date,
        created,
        created,
      ],
    )};`,
    `INSERT INTO product_launches (id, product_id, launch_date, outcome, decided_at, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.launchId),
        sqlStringLiteral(entrant.productId),
        date,
        sqlStringLiteral('won'),
        kickoff,
        created,
        created,
      ],
    )};`,
    `INSERT INTO matches (id, kind, match_date, starts_at, ends_at, started_at, decided_at, decision, created_at, updated_at) VALUES ${rows(
      (entrant) => [
        sqlStringLiteral(entrant.qualifierMatchId),
        QUALIFIER,
        date,
        kickoff,
        fullTime,
        kickoff,
        kickoff,
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
        kickoff,
        sqlStringLiteral('completed'),
        '1',
        kickoff,
        kickoff,
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
        date,
        sqlStringLiteral(entrant.launchId),
        sqlStringLiteral(entrant.productId),
        sqlStringLiteral(ownerIdOf(entrant)),
        sqlStringLiteral('bye'),
        created,
        created,
      ],
    )};`,
    `INSERT INTO week_tournament_entries (id, tournament_id, launch_id, product_id, owner_user_id, launch_date, qualifier_match_id, qualifier_upvote_count, won_at, status, entitlement_source, entitled_at, created_at, updated_at) VALUES ${weekEntryValues(open, 'awaiting_payment', null, null)}, ${weekEntryValues(ultras, 'entitled', 'ultras', now)} RETURNING id;`,
  ].join('\n');
}

export function parseWeekEntrantsInsert(
  rows: readonly LocalD1Row[],
  plan: WeekEntrantsPlan,
): void {
  const inserted = new Set(rows.map((row) => row.id));
  if (
    rows.length !== 2 ||
    !inserted.has(plan.open.weekEntryId) ||
    !inserted.has(plan.ultras.weekEntryId)
  ) {
    throw new Error(
      `週(${plan.weekStart})のWeekトーナメントの参加の枠を2件作れませんでした: ${JSON.stringify(rows)}`,
    );
  }
}

// 参加費の支払いを画面で行わない補助の確認のE2Eでだけ使う。決済の記録を持たないため、出どころはUltrasにする
export function openEntryEntitleSql(entryId: string, now: Date): string {
  const at = timeLiteral(now);
  return `UPDATE week_tournament_entries SET status = 'entitled', entitlement_source = 'ultras', entitled_at = ${at}, updated_at = ${at} WHERE id = ${sqlStringLiteral(entryId)} AND status = 'awaiting_payment' RETURNING id;`;
}

// 組み合わせ決定の前の週だけを対象にし、次の23:45の起動が組み合わせを決める
export function entryWindowCloseSql(
  tournamentId: string,
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
  return `UPDATE week_tournaments SET accept_until = ${timeLiteral(window.acceptUntil)}, deadline_at = ${timeLiteral(window.deadlineAt)}, draw_at = ${timeLiteral(window.drawAt)}, updated_at = ${timeLiteral(now)} WHERE id = ${sqlStringLiteral(tournamentId)} AND status = 'open' AND draw_started_at IS NULL RETURNING id;`;
}

export function weekFinalSql(tournamentId: string): string {
  return `SELECT bm.match_id AS match_id, bm.bracket_id AS bracket_id, bm.round AS round, bm.match_date AS match_date, bm.status AS bracket_status, m.started_at AS started_at, m.decided_at AS decided_at, me.product_id AS product_id FROM week_tournaments wt JOIN tournament_brackets b ON b.id = wt.bracket_id JOIN bracket_matches bm ON bm.bracket_id = b.id AND bm.round = b.round_count JOIN matches m ON m.id = bm.match_id JOIN match_entries me ON me.match_id = m.id WHERE wt.id = ${sqlStringLiteral(tournamentId)} ORDER BY me.slot;`;
}

const isBracketStatus = (value: unknown): value is WeekFinalBracketStatus =>
  WEEK_FINAL_BRACKET_STATUSES.some((status) => status === value);

const nullableDateOf = (value: unknown): Date | null | undefined => {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' ? new Date(value) : undefined;
};

// 決勝は最後のラウンドの唯一の位置のため、側ごとの行が全て同じマッチを指す
export function parseWeekFinal(
  rows: readonly LocalD1Row[],
): WeekFinal | undefined {
  const [first] = rows;
  if (first === undefined) {
    return undefined;
  }
  const invalid = (): Error =>
    new Error(
      `決勝の照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  const {
    match_id: matchId,
    bracket_id: bracketId,
    round,
    match_date: matchDate,
    bracket_status: bracketStatus,
  } = first;
  const startedAt = nullableDateOf(first.started_at);
  const decidedAt = nullableDateOf(first.decided_at);
  if (
    typeof matchId !== 'string' ||
    typeof bracketId !== 'string' ||
    typeof round !== 'number' ||
    typeof matchDate !== 'string' ||
    !isBracketStatus(bracketStatus) ||
    startedAt === undefined ||
    decidedAt === undefined
  ) {
    throw invalid();
  }
  const productIds = rows.map((row) => {
    if (row.match_id !== matchId) {
      throw invalid();
    }
    return typeof row.product_id === 'string' ? row.product_id : '';
  });
  return {
    matchId,
    bracketId,
    round,
    matchDate,
    bracketStatus,
    startedAt,
    decidedAt,
    productIds,
  };
}

const assertScheduledFinal = (final: WeekFinal): void => {
  if (
    final.bracketStatus !== 'scheduled' ||
    final.startedAt !== null ||
    final.decidedAt !== null
  ) {
    throw new Error(
      `決勝(${final.matchId})は開始前の予定済みのマッチではありません`,
    );
  }
};

// 決勝が1回戦(参加2)ならブラケットの1回戦の日も同じ日へ移し、記録の1回戦の日とマッチの実施日をそろえる。開始のイベントは0:00のジョブと同じ形で処理済みとして持たせ、後の確定のイベントの処理を待たせない
export function weekFinalStartSql(
  final: WeekFinal,
  { businessDate, startsAt, endsAt, startedEventId, now }: WeekFinalStartWrite,
): string {
  assertScheduledFinal(final);
  if (startsAt.getTime() > now.getTime() || endsAt.getTime() <= now.getTime()) {
    throw new RangeError(
      '決勝の開始の日時は現在以前、終了の日時は現在より後で指定してください',
    );
  }
  const matchId = sqlStringLiteral(final.matchId);
  const date = sqlStringLiteral(businessDate);
  const at = timeLiteral(now);
  const started = timeLiteral(startsAt);
  return [
    `UPDATE tournament_brackets SET first_round_date = ${date}, updated_at = ${at} WHERE id = ${sqlStringLiteral(final.bracketId)} AND first_round_date = ${sqlStringLiteral(final.matchDate)};`,
    `UPDATE bracket_matches SET match_date = ${date}, updated_at = ${at} WHERE match_id = ${matchId};`,
    `UPDATE match_entries SET match_date = ${date}, updated_at = ${at} WHERE match_id = ${matchId};`,
    `UPDATE matches SET match_date = ${date}, starts_at = ${started}, ends_at = ${timeLiteral(endsAt)}, started_at = ${started}, updated_at = ${at} WHERE id = ${matchId} AND started_at IS NULL AND decided_at IS NULL RETURNING id;`,
    `INSERT INTO match_events (id, match_id, match_kind, type, occurred_at, status, dispatch_count, last_dispatched_at, completed_at, created_at, updated_at) SELECT ${sqlStringLiteral(startedEventId)}, id, kind, 'started', ${started}, 'completed', 1, ${at}, ${at}, ${at}, ${at} FROM matches WHERE id = ${matchId} ON CONFLICT (match_id, type) DO NOTHING;`,
  ].join('\n');
}

const latestUpvoteOf = (column: 'upvoted_at' | 'seq'): string =>
  `(SELECT u.${column} FROM match_upvotes u WHERE u.entry_id = match_entries.id AND u.deleted_at IS NULL ORDER BY u.upvoted_at DESC, u.seq DESC LIMIT 1)`;

// 0票同士の決勝は両者敗北で受賞が無いため、勝たせる側にサポーターのUpvoteを1票入れ、側の集計値をUpvoteの記録から求め直してから終了の日時を過去へ移す。確定は23:40のジョブに任せる
export function weekFinalEndSql(
  final: WeekFinal,
  {
    supporter,
    upvoteId,
    winnerProductId,
    upvotedAt,
    endsAt,
    now,
  }: WeekFinalEndWrite,
): string {
  if (final.startedAt === null || final.decidedAt !== null) {
    throw new Error(
      `決勝(${final.matchId})は開始済みで未確定のマッチではありません`,
    );
  }
  if (!final.productIds.includes(winnerProductId)) {
    throw new Error(
      `プロダクト(${winnerProductId})は決勝(${final.matchId})の側ではありません`,
    );
  }
  if (
    upvotedAt.getTime() <= final.startedAt.getTime() ||
    upvotedAt.getTime() >= endsAt.getTime() ||
    endsAt.getTime() > now.getTime()
  ) {
    throw new RangeError(
      'Upvoteの日時は開始の日時より後で終了の日時より前、終了の日時は現在以前で指定してください',
    );
  }
  const matchId = sqlStringLiteral(final.matchId);
  const at = timeLiteral(now);
  return [
    usersInsertSql([supporter], at),
    `INSERT INTO match_upvotes (id, match_id, entry_id, user_id, match_date, upvoted_at, seq, created_at, updated_at) SELECT ${sqlStringLiteral(upvoteId)}, me.match_id, me.id, ${sqlStringLiteral(supporter.id)}, me.match_date, ${timeLiteral(upvotedAt)}, COALESCE((SELECT MAX(u.seq) FROM match_upvotes u WHERE u.match_id = me.match_id), 0) + 1, ${at}, ${at} FROM match_entries me WHERE me.match_id = ${matchId} AND me.product_id = ${sqlStringLiteral(winnerProductId)} RETURNING id;`,
    `UPDATE match_entries SET upvote_count = (SELECT COUNT(*) FROM match_upvotes u WHERE u.entry_id = match_entries.id AND u.deleted_at IS NULL), last_upvoted_at = ${latestUpvoteOf('upvoted_at')}, last_upvote_seq = ${latestUpvoteOf('seq')}, updated_at = ${at} WHERE match_id = ${matchId};`,
    `UPDATE matches SET ends_at = ${timeLiteral(endsAt)}, updated_at = ${at} WHERE id = ${matchId} AND started_at IS NOT NULL AND decided_at IS NULL RETURNING id;`,
  ].join('\n');
}

export function parseWeekFinalEnd(
  rows: readonly LocalD1Row[],
  final: WeekFinal,
  upvoteId: string,
): void {
  const ids = rows.map((row) => row.id);
  if (
    rows.length !== 2 ||
    !ids.includes(upvoteId) ||
    !ids.includes(final.matchId)
  ) {
    throw new Error(
      `決勝(${final.matchId})のUpvoteの記録と終了の日時の書き換えができませんでした: ${JSON.stringify(rows)}`,
    );
  }
}

export function finalDecidedEventSql(matchId: string): string {
  return `SELECT status FROM match_events WHERE match_id = ${sqlStringLiteral(matchId)} AND type = 'decided';`;
}

// 確定のイベントがまだ無ければundefined
export function parseFinalDecidedEvent(
  rows: readonly LocalD1Row[],
): 'pending' | 'completed' | undefined {
  const [row] = rows;
  if (row === undefined) {
    return undefined;
  }
  if (row.status !== 'pending' && row.status !== 'completed') {
    throw new Error(
      `確定のイベントの照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  }
  return row.status;
}

export function weekTournamentStateSql(tournamentId: string): string {
  return `SELECT wt.status AS status, wt.outcome AS outcome, wt.bracket_id AS bracket_id, e.product_id AS champion_product_id FROM week_tournaments wt LEFT JOIN week_tournament_entries e ON e.id = wt.champion_entry_id WHERE wt.id = ${sqlStringLiteral(tournamentId)};`;
}

const nullableStringOf = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
};

export function parseWeekTournamentState(
  rows: readonly LocalD1Row[],
  tournamentId: string,
): WeekTournamentState {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`Weekトーナメント(${tournamentId})が見つかりません`);
  }
  const { status } = row;
  const outcome = nullableStringOf(row.outcome);
  const bracketId = nullableStringOf(row.bracket_id);
  const championProductId = nullableStringOf(row.champion_product_id);
  if (
    typeof status !== 'string' ||
    outcome === undefined ||
    bracketId === undefined ||
    championProductId === undefined
  ) {
    throw new Error(
      `Weekトーナメントの照会の結果の形式が正しくありません: ${JSON.stringify(row)}`,
    );
  }
  return { status, outcome, bracketId, championProductId };
}

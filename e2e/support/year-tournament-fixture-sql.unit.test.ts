import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import { fixtureId } from './directory-fixture-sql.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import {
  parseWeekFinal,
  type WeekFinal,
} from './week-tournament-fixture-sql.ts';
import {
  FIXTURE_YEAR_FIRST,
  fixtureLatestYearSql,
  nextFixtureYear,
  openYearEntryEntitleSql,
  parseFixtureLatestYear,
  parseYearEntrantsInsert,
  parseYearTournamentState,
  planYearEntrants,
  planYearFixtureUser,
  type YearEntrantSchedule,
  type YearEntrantsPlan,
  yearEntrantsInsertSql,
  yearEntryWindowCloseSql,
  yearFinalSql,
  yearFinalStartSql,
  yearTournamentStateSql,
} from './year-tournament-fixture-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const MINUTE_MS = 60_000;

const HOUR_MS = 3_600_000;

const DAY_MS = 86_400_000;

const YEAR = 1005;

const FINAL_DATE = '1005-05-28';

const DEADLINE_DATE = '1005-12-31';

const OPEN_SCHEDULE: YearEntrantSchedule = {
  weekStart: '1005-06-14',
  weekPeriod: '1005-W24',
  launchDate: '1005-06-16',
  qualifierWindow: {
    startsAt: new Date('1005-06-15T15:00:00.000Z'),
    endsAt: new Date('1005-06-16T14:40:00.000Z'),
  },
  awardedAt: new Date('1005-06-20T14:40:00.000Z'),
  awardedDate: '1005-06-20',
};

const ULTRAS_SCHEDULE: YearEntrantSchedule = {
  weekStart: '1005-06-21',
  weekPeriod: '1005-W25',
  launchDate: '1005-06-23',
  qualifierWindow: {
    startsAt: new Date('1005-06-22T15:00:00.000Z'),
    endsAt: new Date('1005-06-23T14:40:00.000Z'),
  },
  awardedAt: new Date('1005-06-27T14:40:00.000Z'),
  awardedDate: '1005-06-27',
};

const NOW = new Date('2026-11-17T20:00:00.000Z');

const TODAY = '2026-11-18';

const TOMORROW = '2026-11-19';

const SUFFIX = 'a1b2c3d4';

let db: Database;

let idCount = 0;

const nextId = (): string => {
  idCount += 1;
  const random = new Uint8Array(10);
  new DataView(random.buffer).setUint32(6, idCount);
  return fixtureId(NOW, random);
};

const queryRows = (sql: string): LocalD1Row[] =>
  db.query<Record<string, unknown>, []>(sql).all();

// 複数の文を順に実行し、RETURNINGの行を文の順につなげて返す(ローカルのD1の実行結果と同じ形)
const executeAll = (sql: string): LocalD1Row[] =>
  sql
    .split('\n')
    .flatMap((statement) =>
      db.query<Record<string, unknown>, []>(statement).all(),
    );

const planOf = (
  overrides: Partial<Parameters<typeof planYearEntrants>[0]> = {},
): YearEntrantsPlan =>
  planYearEntrants({
    year: YEAR,
    finalDate: FINAL_DATE,
    open: OPEN_SCHEDULE,
    ultras: ULTRAS_SCHEDULE,
    now: NOW,
    suffix: SUFFIX,
    nextId,
    ...overrides,
  });

const insertVerifiedUser = (id: string, handle: string): void => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, 1, 1, 1, 1)`,
    [id, `p-${id}`, `${handle}@test.example`, handle, handle],
  );
};

const insertYearRow = (id: string, year: number): void => {
  db.run(
    `INSERT INTO year_tournaments (id, year, final_date, final_date_source, deadline_date, accept_until, deadline_at, draw_at, change_lock_at, status, created_at, updated_at) VALUES (?, ?, ?, 'default', ?, 1, 2, 3, 0, 'open', 1, 1)`,
    [id, year, `${String(year)}-05-28`, `${String(year)}-12-31`],
  );
};

// 23:45のジョブの組み合わせ決定(参加2)が作る行を、決勝が翌日に予定された形で用意する
const insertDrawnFinal = (plan: YearEntrantsPlan, matchId: string): void => {
  const startsAt = Date.parse('2026-11-18T15:00:00.000Z');
  const endsAt = Date.parse('2026-11-19T14:40:00.000Z');
  const at = NOW.getTime();
  db.run(
    `INSERT INTO tournament_brackets (id, kind, tournament_id, participant_count, seed_count, second_round_size, round_count, first_round_date, status, created_at, updated_at) VALUES ('B1', 'year', ?, 2, 0, 1, 1, ?, 'active', ?, ?)`,
    [plan.yearTournamentId, TOMORROW, at, at],
  );
  db.run(
    `UPDATE year_tournaments SET status = 'in_progress', bracket_id = 'B1', first_round_date = ?, participant_count = 2, draw_started_at = ?, drawn_at = ? WHERE id = ?`,
    [TOMORROW, at, at, plan.yearTournamentId],
  );
  db.run(
    `UPDATE year_tournament_entries SET status = 'drawn', entitlement_source = 'ultras', classified_year = ? WHERE id IN (?, ?)`,
    [YEAR, plan.open.yearEntryId, plan.ultras.yearEntryId],
  );
  db.run(
    `INSERT INTO bracket_matches (match_id, bracket_id, round, position, match_date, participant1_no, participant2_no, status, created_at, updated_at) VALUES (?, 'B1', 1, 1, ?, 1, 2, 'scheduled', ?, ?)`,
    [matchId, TOMORROW, at, at],
  );
  db.run(
    `INSERT INTO matches (id, kind, match_date, round, stage, starts_at, ends_at, created_at, updated_at) VALUES (?, 'year', ?, 1, 'final', ?, ?, ?, ?)`,
    [matchId, TOMORROW, startsAt, endsAt, at, at],
  );
  [plan.ultras, plan.open].forEach((entrant, index) => {
    db.run(
      `INSERT INTO match_entries (id, match_id, slot, match_kind, match_date, launch_id, product_id, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, 'year', ?, ?, ?, (SELECT user_id FROM products WHERE id = ?), ?, ?)`,
      [
        `FE${String(index + 1)}`,
        matchId,
        index + 1,
        TOMORROW,
        entrant.launchId,
        entrant.productId,
        entrant.productId,
        at,
        at,
      ],
    );
  });
};

const readFinal = (plan: YearEntrantsPlan): WeekFinal => {
  const final = parseWeekFinal(queryRows(yearFinalSql(plan.yearTournamentId)));
  if (final === undefined) {
    throw new Error('決勝がありません');
  }
  return final;
};

const createdPlan = (): YearEntrantsPlan => {
  const plan = planOf();
  executeAll(yearEntrantsInsertSql(plan));
  return plan;
};

const startWrite = {
  businessDate: TODAY,
  startsAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
  endsAt: new Date(NOW.getTime() + 60 * MINUTE_MS),
  startedEventId: 'SE',
  now: NOW,
};

beforeEach(async () => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
});

afterEach(() => {
  db.close();
});

describe('fixtureLatestYearSql・parseFixtureLatestYear・nextFixtureYear', () => {
  test('補助が使う過去の対象年(2026年より前)の最大の年だけを読む', () => {
    insertYearRow('Y1', 1001);
    insertYearRow('Y2', 1003);
    insertYearRow('Y3', 2027);

    expect(parseFixtureLatestYear(queryRows(fixtureLatestYearSql()))).toBe(
      1003,
    );
  });

  test('過去の対象年の行が無ければnullを読む', () => {
    insertYearRow('Y1', 2026);

    expect(
      parseFixtureLatestYear(queryRows(fixtureLatestYearSql())),
    ).toBeNull();
  });

  test('照会の結果の形式が違えば失敗する', () => {
    expect(() => parseFixtureLatestYear([{ latest: '1001' }])).toThrow(
      '過去の対象年の照会の結果の形式が正しくありません',
    );
    expect(() => parseFixtureLatestYear([])).toThrow(
      '過去の対象年の照会の結果の形式が正しくありません',
    );
  });

  test('過去の対象年が無ければ1001年、あれば最大の年の翌年を使う', () => {
    expect(FIXTURE_YEAR_FIRST).toBe(1001);
    expect(nextFixtureYear(null)).toBe(1001);
    expect(nextFixtureYear(1000)).toBe(1001);
    expect(nextFixtureYear(1003)).toBe(1004);
    expect(nextFixtureYear(2024)).toBe(2025);
  });

  test('翌年が2026年以後になれば失敗する', () => {
    expect(() => nextFixtureYear(2025)).toThrow(
      'E2Eの補助が使える過去の対象年が残っていません',
    );
  });
});

describe('planYearFixtureUser・planYearEntrants', () => {
  test('利用者は接尾辞と役割で識別できるハンドルとテスト用のドメインのメールアドレスにする', () => {
    expect(planYearFixtureUser('open', SUFFIX, nextId)).toMatchObject({
      handle: `e2e-year-${SUFFIX}-open`,
      email: `e2e-year-${SUFFIX}-open@test.example`,
    });
  });

  test('接尾辞が英小文字と数字の4〜12文字でなければ失敗する', () => {
    expect(() => planYearFixtureUser('open', 'AB', nextId)).toThrow(RangeError);
  });

  test('決済期限日は対象年の12月31日にし、受付期限は現在より十分に未来に、決済期限と組み合わせ決定を規則と同じ間隔で続ける', () => {
    const plan = planOf();

    expect(plan.deadlineDate).toBe(DEADLINE_DATE);
    expect(plan.window.acceptUntil.getTime() - NOW.getTime()).toBe(7 * DAY_MS);
    expect(
      plan.window.deadlineAt.getTime() - plan.window.acceptUntil.getTime(),
    ).toBe(35 * MINUTE_MS);
    expect(
      plan.window.drawAt.getTime() - plan.window.acceptUntil.getTime(),
    ).toBe(45 * MINUTE_MS);
    expect(
      plan.window.acceptUntil.getTime() - plan.changeLockAt.getTime(),
    ).toBe(47 * HOUR_MS);
    expect(plan.changeLockAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test('IDはすべてアプリと同じULIDの形式で、互いに重ならない', () => {
    const plan = planOf();
    const ids = [plan.yearTournamentId, plan.open, plan.ultras].flatMap(
      (part) =>
        typeof part === 'string'
          ? [part]
          : [
              part.productId,
              part.launchId,
              part.qualifierMatchId,
              part.qualifierEntryId,
              part.decidedEventId,
              part.weekTournamentId,
              part.yearEntryId,
            ],
    );

    expect(ids.every((id) => ULID_PATTERN.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('対象年が補助の範囲外か、決勝日が対象年の日付でなければ失敗する', () => {
    expect(() => planOf({ year: 1000 })).toThrow(RangeError);
    expect(() => planOf({ year: 2026 })).toThrow(RangeError);
    expect(() => planOf({ finalDate: '1006-05-27' })).toThrow(RangeError);
  });

  test('Week優勝の日が対象年の決済期限日より前の対象年の日付でないか、ローンチ日より前なら失敗する', () => {
    expect(() =>
      planOf({ open: { ...OPEN_SCHEDULE, awardedDate: DEADLINE_DATE } }),
    ).toThrow(RangeError);
    expect(() =>
      planOf({ ultras: { ...ULTRAS_SCHEDULE, awardedDate: '1004-12-31' } }),
    ).toThrow(RangeError);
    expect(() =>
      planOf({ open: { ...OPEN_SCHEDULE, awardedDate: '1005-06-15' } }),
    ).toThrow(RangeError);
  });
});

describe('yearEntrantsInsertSql・parseYearEntrantsInsert', () => {
  test('確認済みで可視の利用者2人・可視のプロダクト2つ・予選で勝ったローンチ2つと、未来の期限の年の行・受付中とUltrasの参加資格の枠を作る', () => {
    const plan = planOf();

    const rows = executeAll(yearEntrantsInsertSql(plan));

    expect(() => {
      parseYearEntrantsInsert(rows, plan);
    }).not.toThrow();
    expect(
      queryRows(
        `SELECT p.handle, l.outcome, l.launch_date, u.status, u.email_verified_at IS NOT NULL AS verified, p.hidden_at, p.deleted_at FROM products p JOIN users u ON u.id = p.user_id JOIN product_launches l ON l.product_id = p.id ORDER BY p.handle`,
      ),
    ).toStrictEqual([
      {
        handle: `e2e-year-${SUFFIX}-open`,
        outcome: 'won',
        launch_date: OPEN_SCHEDULE.launchDate,
        status: 'active',
        verified: 1,
        hidden_at: null,
        deleted_at: null,
      },
      {
        handle: `e2e-year-${SUFFIX}-ultras`,
        outcome: 'won',
        launch_date: ULTRAS_SCHEDULE.launchDate,
        status: 'active',
        verified: 1,
        hidden_at: null,
        deleted_at: null,
      },
    ]);
    expect(
      queryRows(
        `SELECT id, year, final_date, final_date_source, final_date_version, deadline_date, accept_until, deadline_at, draw_at, change_lock_at, status, draw_started_at FROM year_tournaments`,
      ),
    ).toStrictEqual([
      {
        id: plan.yearTournamentId,
        year: YEAR,
        final_date: FINAL_DATE,
        final_date_source: 'default',
        final_date_version: 0,
        deadline_date: DEADLINE_DATE,
        accept_until: plan.window.acceptUntil.getTime(),
        deadline_at: plan.window.deadlineAt.getTime(),
        draw_at: plan.window.drawAt.getTime(),
        change_lock_at: plan.changeLockAt.getTime(),
        status: 'open',
        draw_started_at: null,
      },
    ]);
    expect(
      queryRows(
        `SELECT e.id, e.status, e.entitlement_source, e.entitled_at, e.week_tournament_id, e.week_period, e.launch_date, e.awarded_at, e.awarded_date, e.qualifier_match_id = me.match_id AS qualified, e.qualifier_upvote_count, e.classified_year, e.purchase_id, e.product_id = l.product_id AS linked, e.owner_user_id = p.user_id AS owned FROM year_tournament_entries e JOIN product_launches l ON l.id = e.launch_id JOIN products p ON p.id = e.product_id JOIN match_entries me ON me.launch_id = e.launch_id ORDER BY e.status`,
      ),
    ).toStrictEqual([
      {
        id: plan.open.yearEntryId,
        status: 'awaiting_payment',
        entitlement_source: null,
        entitled_at: null,
        week_tournament_id: plan.open.weekTournamentId,
        week_period: OPEN_SCHEDULE.weekPeriod,
        launch_date: OPEN_SCHEDULE.launchDate,
        awarded_at: OPEN_SCHEDULE.awardedAt.getTime(),
        awarded_date: OPEN_SCHEDULE.awardedDate,
        qualified: 1,
        qualifier_upvote_count: 0,
        classified_year: null,
        purchase_id: null,
        linked: 1,
        owned: 1,
      },
      {
        id: plan.ultras.yearEntryId,
        status: 'entitled',
        entitlement_source: 'ultras',
        entitled_at: NOW.getTime(),
        week_tournament_id: plan.ultras.weekTournamentId,
        week_period: ULTRAS_SCHEDULE.weekPeriod,
        launch_date: ULTRAS_SCHEDULE.launchDate,
        awarded_at: ULTRAS_SCHEDULE.awardedAt.getTime(),
        awarded_date: ULTRAS_SCHEDULE.awardedDate,
        qualified: 1,
        qualifier_upvote_count: 0,
        classified_year: null,
        purchase_id: null,
        linked: 1,
        owned: 1,
      },
    ]);
  });

  test('予選は開始時点で確定した不戦勝で、確定のイベントを処理済みの形で持ち、Weekトーナメントの行は作らない', () => {
    const plan = createdPlan();

    expect(
      queryRows(
        `SELECT m.id, m.kind, m.match_date, m.starts_at, m.decision, me.result, me.launch_id, ev.type, ev.status FROM matches m JOIN match_entries me ON me.match_id = m.id JOIN match_events ev ON ev.match_id = m.id ORDER BY m.match_date`,
      ),
    ).toStrictEqual(
      [
        { entrant: plan.open, schedule: OPEN_SCHEDULE },
        { entrant: plan.ultras, schedule: ULTRAS_SCHEDULE },
      ].map(({ entrant, schedule }) => ({
        id: entrant.qualifierMatchId,
        kind: 'qualifier',
        match_date: schedule.launchDate,
        starts_at: schedule.qualifierWindow.startsAt.getTime(),
        decision: 'bye',
        result: 'bye',
        launch_id: entrant.launchId,
        type: 'decided',
        status: 'completed',
      })),
    );
    expect(
      queryRows(
        'SELECT (SELECT COUNT(*) FROM week_tournaments) AS tournaments, (SELECT COUNT(*) FROM week_tournament_entries) AS entries',
      ),
    ).toStrictEqual([{ tournaments: 0, entries: 0 }]);
  });

  test('受付中の枠の投稿者を渡すと、その利用者のプロダクトとして作り利用者は1人だけ作る', () => {
    insertVerifiedUser('U1', 'entrant-owner');
    const plan = planOf({ openOwnerUserId: 'U1' });

    executeAll(yearEntrantsInsertSql(plan));

    expect(
      queryRows(
        `SELECT e.status, e.owner_user_id = 'U1' AS existing FROM year_tournament_entries e ORDER BY e.status`,
      ),
    ).toStrictEqual([
      { status: 'awaiting_payment', existing: 1 },
      { status: 'entitled', existing: 0 },
    ]);
    expect(queryRows('SELECT COUNT(*) AS count FROM users')).toStrictEqual([
      { count: 2 },
    ]);
  });

  test('名称や説明の引用符はSQLの文字列のリテラルとしてエスケープする', () => {
    const plan = planOf();
    const quoted: YearEntrantsPlan = {
      ...plan,
      open: { ...plan.open, productName: "E2EのYear'open" },
    };

    const sql = yearEntrantsInsertSql(quoted);
    executeAll(sql);

    expect(sql).toContain("'E2EのYear''open'");
    expect(
      queryRows(
        `SELECT name FROM products WHERE id = '${plan.open.productId}'`,
      ),
    ).toStrictEqual([{ name: "E2EのYear'open" }]);
  });

  test('枠が2件返らなければ失敗する', () => {
    const plan = planOf();

    expect(() => {
      parseYearEntrantsInsert([{ id: plan.open.yearEntryId }], plan);
    }).toThrow(
      `${String(YEAR)}年のYearトーナメントの参加の枠を2件作れませんでした`,
    );
  });
});

describe('openYearEntryEntitleSql', () => {
  test('受付中の枠だけをUltrasの出どころの参加資格にする', () => {
    const plan = createdPlan();

    expect(
      executeAll(openYearEntryEntitleSql(plan.open.yearEntryId, NOW)),
    ).toStrictEqual([{ id: plan.open.yearEntryId }]);
    expect(
      executeAll(openYearEntryEntitleSql(plan.ultras.yearEntryId, NOW)),
    ).toStrictEqual([]);
    expect(
      queryRows(
        `SELECT status, entitlement_source, entitled_at FROM year_tournament_entries WHERE id = '${plan.open.yearEntryId}'`,
      ),
    ).toStrictEqual([
      {
        status: 'entitled',
        entitlement_source: 'ultras',
        entitled_at: NOW.getTime(),
      },
    ]);
  });
});

describe('yearEntryWindowCloseSql', () => {
  const pastWindow = {
    acceptUntil: new Date('1005-12-31T14:00:00.000Z'),
    deadlineAt: new Date('1005-12-31T14:35:00.000Z'),
    drawAt: new Date('1005-12-31T14:45:00.000Z'),
  };

  test('組み合わせ決定の前の年の3つの期限を現在より過去へ移し、組み合わせ決定の対象にする', () => {
    const plan = createdPlan();

    expect(
      executeAll(
        yearEntryWindowCloseSql(plan.yearTournamentId, pastWindow, NOW),
      ),
    ).toStrictEqual([{ id: plan.yearTournamentId }]);
    expect(
      queryRows(
        `SELECT id FROM year_tournaments WHERE status IN ('open', 'drawing') AND draw_at <= ${String(NOW.getTime())} AND accept_until = ${String(pastWindow.acceptUntil.getTime())} AND deadline_at = ${String(pastWindow.deadlineAt.getTime())} AND deadline_date = '${DEADLINE_DATE}'`,
      ),
    ).toStrictEqual([{ id: plan.yearTournamentId }]);
  });

  test('組み合わせ決定を始めた年は書き換えない', () => {
    const plan = createdPlan();
    db.run(
      `UPDATE year_tournaments SET status = 'drawing', draw_started_at = 1 WHERE id = ?`,
      [plan.yearTournamentId],
    );

    expect(
      executeAll(
        yearEntryWindowCloseSql(plan.yearTournamentId, pastWindow, NOW),
      ),
    ).toStrictEqual([]);
  });

  test('組み合わせ決定の日時が未来か、期限の順が規則と違えば失敗する', () => {
    expect(() =>
      yearEntryWindowCloseSql(
        'Y',
        { ...pastWindow, drawAt: new Date(NOW.getTime() + 1) },
        NOW,
      ),
    ).toThrow(RangeError);
    expect(() =>
      yearEntryWindowCloseSql(
        'Y',
        { ...pastWindow, deadlineAt: pastWindow.acceptUntil },
        NOW,
      ),
    ).toThrow(RangeError);
  });

  test('IDの引用符はSQLの文字列のリテラルとしてエスケープする', () => {
    expect(yearEntryWindowCloseSql("Y'1", pastWindow, NOW)).toContain(
      "WHERE id = 'Y''1'",
    );
  });
});

describe('yearFinalSql', () => {
  test('組み合わせ決定の前は決勝が無い', () => {
    const plan = createdPlan();

    expect(
      parseWeekFinal(queryRows(yearFinalSql(plan.yearTournamentId))),
    ).toBeUndefined();
  });

  test('組み合わせで予定された決勝を、側のプロダクトを枠の順に並べて読む', () => {
    const plan = createdPlan();
    insertDrawnFinal(plan, 'MF');

    expect(readFinal(plan)).toStrictEqual({
      matchId: 'MF',
      bracketId: 'B1',
      round: 1,
      matchDate: TOMORROW,
      bracketStatus: 'scheduled',
      startedAt: null,
      decidedAt: null,
      productIds: [plan.ultras.productId, plan.open.productId],
    });
  });
});

describe('yearFinalStartSql', () => {
  test('予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移して開始を記録済みにし、年の行の1回戦の日もそろえる', () => {
    const plan = createdPlan();
    insertDrawnFinal(plan, 'MF');

    const rows = executeAll(
      yearFinalStartSql(plan.yearTournamentId, readFinal(plan), startWrite),
    );

    expect(rows).toStrictEqual([{ id: 'MF' }]);
    expect(readFinal(plan)).toMatchObject({
      matchDate: TODAY,
      bracketStatus: 'scheduled',
      startedAt: startWrite.startsAt,
      decidedAt: null,
    });
    expect(
      queryRows(
        `SELECT m.match_date, m.ends_at > ${String(NOW.getTime())} AS ends_after_now, (SELECT first_round_date FROM tournament_brackets WHERE id = 'B1') AS bracket_first_round_date, (SELECT first_round_date FROM year_tournaments WHERE id = '${plan.yearTournamentId}') AS year_first_round_date FROM matches m WHERE m.id = 'MF'`,
      ),
    ).toStrictEqual([
      {
        match_date: TODAY,
        ends_after_now: 1,
        bracket_first_round_date: TODAY,
        year_first_round_date: TODAY,
      },
    ]);
    expect(
      queryRows(`SELECT type, status FROM match_events WHERE match_id = 'MF'`),
    ).toStrictEqual([{ type: 'started', status: 'completed' }]);
  });

  test('開始済みの決勝は失敗する', () => {
    const plan = createdPlan();
    insertDrawnFinal(plan, 'MF');
    const final = readFinal(plan);

    expect(() =>
      yearFinalStartSql(
        plan.yearTournamentId,
        { ...final, startedAt: NOW },
        startWrite,
      ),
    ).toThrow('決勝(MF)は開始前の予定済みのマッチではありません');
  });
});

describe('yearTournamentStateSql・parseYearTournamentState', () => {
  test('組み合わせ決定の前の年の状態を読む', () => {
    const plan = createdPlan();

    expect(
      parseYearTournamentState(
        queryRows(yearTournamentStateSql(plan.yearTournamentId)),
        plan.yearTournamentId,
      ),
    ).toStrictEqual({
      status: 'open',
      outcome: null,
      bracketId: null,
      participantCount: null,
      firstRoundDate: null,
      championProductId: null,
    });
  });

  test('受賞で終えた年は優勝の枠のプロダクトを読む', () => {
    const plan = createdPlan();
    insertDrawnFinal(plan, 'MF');
    db.run(
      `UPDATE year_tournaments SET status = 'finished', outcome = 'awarded', champion_entry_id = ?, awarded_at = 1, finished_at = 1 WHERE id = ?`,
      [plan.open.yearEntryId, plan.yearTournamentId],
    );

    expect(
      parseYearTournamentState(
        queryRows(yearTournamentStateSql(plan.yearTournamentId)),
        plan.yearTournamentId,
      ),
    ).toStrictEqual({
      status: 'finished',
      outcome: 'awarded',
      bracketId: 'B1',
      participantCount: 2,
      firstRoundDate: TOMORROW,
      championProductId: plan.open.productId,
    });
  });

  test('年の行が無いか、行の形式が違えば失敗する', () => {
    expect(() => parseYearTournamentState([], 'Y1')).toThrow(
      'Yearトーナメント(Y1)が見つかりません',
    );
    expect(() =>
      parseYearTournamentState(
        [
          {
            status: 'open',
            outcome: null,
            bracket_id: null,
            participant_count: '2',
            first_round_date: null,
            champion_product_id: null,
          },
        ],
        'Y1',
      ),
    ).toThrow('Yearトーナメントの照会の結果の形式が正しくありません');
  });
});

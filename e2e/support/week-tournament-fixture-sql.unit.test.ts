import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import { fixtureId } from './directory-fixture-sql.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import {
  chooseFixtureWeekStart,
  entryWindowCloseSql,
  FIXTURE_WEEK_COUNT,
  finalDecidedEventSql,
  finalPendingEventCountSql,
  fixtureWeekStartsSql,
  openEntryEntitleSql,
  parseFinalDecidedEvent,
  parseFinalPendingEventCount,
  parseFixtureWeekStarts,
  parseVerifiedUserId,
  parseWeekEntrantsInsert,
  parseWeekFinal,
  parseWeekFinalEnd,
  parseWeekTournamentState,
  planFixtureUser,
  planWeekEntrants,
  verifiedUserIdSql,
  type WeekEntrantsPlan,
  type WeekFinal,
  weekEntrantsInsertSql,
  weekFinalEndSql,
  weekFinalSql,
  weekFinalStartSql,
  weekTournamentStateSql,
} from './week-tournament-fixture-sql.ts';

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

const DAY_MS = 86_400_000;

const WEEK_START = '2005-03-07';

const LAUNCH_DATE = '2005-03-09';

const QUALIFIER_WINDOW = {
  startsAt: new Date('2005-03-09T08:00:00.000Z'),
  endsAt: new Date('2005-03-10T07:40:00.000Z'),
};

const NOW = new Date('2026-11-17T20:00:00.000Z');

const TODAY = '2026-11-17';

const TOMORROW = '2026-11-18';

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

const planOf = (openOwnerUserId?: string): WeekEntrantsPlan =>
  planWeekEntrants({
    weekStart: WEEK_START,
    launchDate: LAUNCH_DATE,
    qualifierWindow: QUALIFIER_WINDOW,
    now: NOW,
    suffix: SUFFIX,
    nextId,
    ...(openOwnerUserId === undefined ? {} : { openOwnerUserId }),
  });

const insertVerifiedUser = (id: string, handle: string): void => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, 1, 1, 1, 1)`,
    [id, `p-${id}`, `${handle}@test.example`, handle, handle],
  );
};

// 23:45のジョブの組み合わせ決定(参加2)が作る行を、決勝が翌日に予定された形で用意する
const insertDrawnFinal = (plan: WeekEntrantsPlan, matchId: string): void => {
  const startsAt = Date.parse('2026-11-18T08:00:00.000Z');
  const endsAt = Date.parse('2026-11-19T07:40:00.000Z');
  const at = NOW.getTime();
  db.run(
    `INSERT INTO tournament_brackets (id, kind, tournament_id, participant_count, seed_count, second_round_size, round_count, first_round_date, status, created_at, updated_at) VALUES ('B1', 'week', ?, 2, 0, 1, 1, ?, 'active', ?, ?)`,
    [plan.tournamentId, TOMORROW, at, at],
  );
  db.run(
    `UPDATE week_tournaments SET status = 'in_progress', bracket_id = 'B1', draw_started_at = ?, drawn_at = ? WHERE id = ?`,
    [at, at, plan.tournamentId],
  );
  db.run(
    `INSERT INTO bracket_matches (match_id, bracket_id, round, position, match_date, participant1_no, participant2_no, status, created_at, updated_at) VALUES (?, 'B1', 1, 1, ?, 1, 2, 'scheduled', ?, ?)`,
    [matchId, TOMORROW, at, at],
  );
  db.run(
    `INSERT INTO matches (id, kind, match_date, round, stage, starts_at, ends_at, created_at, updated_at) VALUES (?, 'week', ?, 1, 'final', ?, ?, ?, ?)`,
    [matchId, TOMORROW, startsAt, endsAt, at, at],
  );
  [plan.ultras, plan.open].forEach((entrant, index) => {
    db.run(
      `INSERT INTO match_entries (id, match_id, slot, match_kind, match_date, launch_id, product_id, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, 'week', ?, ?, ?, (SELECT user_id FROM products WHERE id = ?), ?, ?)`,
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

const readFinal = (plan: WeekEntrantsPlan): WeekFinal => {
  const final = parseWeekFinal(queryRows(weekFinalSql(plan.tournamentId)));
  if (final === undefined) {
    throw new Error('決勝がありません');
  }
  return final;
};

const createdPlan = (): WeekEntrantsPlan => {
  const plan = planOf();
  executeAll(weekEntrantsInsertSql(plan));
  return plan;
};

const startedFinal = (plan: WeekEntrantsPlan): WeekFinal => {
  insertDrawnFinal(plan, 'MF');
  executeAll(
    weekFinalStartSql(readFinal(plan), {
      businessDate: TODAY,
      startsAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
      endsAt: new Date(NOW.getTime() + 60 * MINUTE_MS),
      startedEventId: 'SE',
      now: NOW,
    }),
  );
  return readFinal(plan);
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

describe('fixtureWeekStartsSql・parseFixtureWeekStarts・chooseFixtureWeekStart', () => {
  test('補助が使う範囲の週の行の週の初日だけを読む', () => {
    for (const [id, weekStart] of [
      ['W1', '2005-03-07'],
      ['W2', '2026-11-16'],
    ] as const) {
      db.run(
        `INSERT INTO week_tournaments (id, week_start, accept_until, deadline_at, draw_at, status, created_at, updated_at) VALUES (?, ?, 1, 2, 3, 'open', 1, 1)`,
        [id, weekStart],
      );
    }

    expect(
      parseFixtureWeekStarts(queryRows(fixtureWeekStartsSql())),
    ).toStrictEqual(new Set(['2005-03-07']));
  });

  test('週の初日が文字列でなければ失敗する', () => {
    expect(() => parseFixtureWeekStarts([{ week_start: 1 }])).toThrow(
      '週の初日の照会の結果の形式が正しくありません',
    );
  });

  test('乱数の位置の週が空いていればその月曜日を選ぶ', () => {
    expect(chooseFixtureWeekStart(new Set(), 0)).toBe('2000-01-03');
    expect(
      chooseFixtureWeekStart(
        new Set(),
        (FIXTURE_WEEK_COUNT - 1) / FIXTURE_WEEK_COUNT,
      ),
    ).toBe('2019-12-30');
  });

  test('使った週は飛ばし、範囲の末尾から先頭へ回って探す', () => {
    expect(
      chooseFixtureWeekStart(
        new Set(['2019-12-30']),
        (FIXTURE_WEEK_COUNT - 1) / FIXTURE_WEEK_COUNT,
      ),
    ).toBe('2000-01-03');
  });

  test('空いている週が無ければ失敗する', () => {
    const all = new Set(
      Array.from({ length: FIXTURE_WEEK_COUNT }, (_, index) =>
        new Date(Date.UTC(2000, 0, 3) + index * 7 * DAY_MS)
          .toISOString()
          .slice(0, 10),
      ),
    );

    expect(() => chooseFixtureWeekStart(all, 0.5)).toThrow(
      'E2Eの補助が使える過去の週が残っていません',
    );
  });

  test('乱数が0以上1未満でなければ失敗する', () => {
    expect(() => chooseFixtureWeekStart(new Set(), 1)).toThrow(RangeError);
    expect(() => chooseFixtureWeekStart(new Set(), -0.1)).toThrow(RangeError);
  });
});

describe('verifiedUserIdSql・parseVerifiedUserId', () => {
  test('メールアドレスを確認済みで可視の利用者を、ハンドルの大文字小文字を区別せずに読む', () => {
    insertVerifiedUser('U1', 'entrant-owner');

    expect(
      parseVerifiedUserId(
        queryRows(verifiedUserIdSql('Entrant-Owner')),
        'Entrant-Owner',
      ),
    ).toBe('U1');
  });

  test('メールアドレスが未確認か停止中の利用者は見つからない扱いで失敗する', () => {
    insertVerifiedUser('U1', 'unverified');
    insertVerifiedUser('U2', 'suspended');
    db.run(`UPDATE users SET email_verified_at = NULL WHERE id = 'U1'`);
    db.run(`UPDATE users SET status = 'suspended' WHERE id = 'U2'`);

    for (const handle of ['unverified', 'suspended']) {
      expect(() =>
        parseVerifiedUserId(queryRows(verifiedUserIdSql(handle)), handle),
      ).toThrow(
        `メールアドレスを確認済みで可視の利用者(${handle})が見つかりません`,
      );
    }
  });
});

describe('planFixtureUser・planWeekEntrants', () => {
  test('利用者は接尾辞と役割で識別できるハンドルとテスト用のドメインのメールアドレスにする', () => {
    expect(planFixtureUser('supporter', SUFFIX, nextId)).toMatchObject({
      handle: `e2e-week-${SUFFIX}-supporter`,
      email: `e2e-week-${SUFFIX}-supporter@test.example`,
    });
  });

  test('接尾辞が英小文字と数字の4〜12文字でなければ失敗する', () => {
    expect(() => planFixtureUser('open', 'AB', nextId)).toThrow(RangeError);
  });

  test('受付期限は現在より十分に未来にし、決済期限と組み合わせ決定を規則と同じ間隔で続ける', () => {
    const { window } = planOf();

    expect(window.acceptUntil.getTime() - NOW.getTime()).toBe(7 * DAY_MS);
    expect(window.deadlineAt.getTime() - window.acceptUntil.getTime()).toBe(
      35 * MINUTE_MS,
    );
    expect(window.drawAt.getTime() - window.acceptUntil.getTime()).toBe(
      45 * MINUTE_MS,
    );
  });

  test('IDはすべてアプリと同じULIDの形式で、互いに重ならない', () => {
    const plan = planOf();
    const ids = [plan.tournamentId, plan.open, plan.ultras].flatMap((part) =>
      typeof part === 'string'
        ? [part]
        : [
            part.productId,
            part.launchId,
            part.qualifierMatchId,
            part.qualifierEntryId,
            part.decidedEventId,
            part.weekEntryId,
          ],
    );

    expect(ids.every((id) => ULID_PATTERN.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('weekEntrantsInsertSql・parseWeekEntrantsInsert', () => {
  test('確認済みで可視の利用者2人・可視のプロダクト2つ・予選で勝ったローンチ2つと、未来の期限の週の行・受付中とUltrasの参加資格の枠を作る', () => {
    const plan = planOf();

    const rows = executeAll(weekEntrantsInsertSql(plan));

    expect(() => {
      parseWeekEntrantsInsert(rows, plan);
    }).not.toThrow();
    expect(
      queryRows(
        `SELECT p.handle, l.outcome, l.launch_date, u.status, u.email_verified_at IS NOT NULL AS verified, p.hidden_at, p.deleted_at FROM products p JOIN users u ON u.id = p.user_id JOIN product_launches l ON l.product_id = p.id ORDER BY p.handle`,
      ),
    ).toStrictEqual([
      {
        handle: `e2e-week-${SUFFIX}-open`,
        outcome: 'won',
        launch_date: LAUNCH_DATE,
        status: 'active',
        verified: 1,
        hidden_at: null,
        deleted_at: null,
      },
      {
        handle: `e2e-week-${SUFFIX}-ultras`,
        outcome: 'won',
        launch_date: LAUNCH_DATE,
        status: 'active',
        verified: 1,
        hidden_at: null,
        deleted_at: null,
      },
    ]);
    expect(
      queryRows(
        `SELECT week_start, status, accept_until, deadline_at, draw_at, draw_started_at FROM week_tournaments`,
      ),
    ).toStrictEqual([
      {
        week_start: WEEK_START,
        status: 'open',
        accept_until: plan.window.acceptUntil.getTime(),
        deadline_at: plan.window.deadlineAt.getTime(),
        draw_at: plan.window.drawAt.getTime(),
        draw_started_at: null,
      },
    ]);
    expect(
      queryRows(
        `SELECT e.id, e.status, e.entitlement_source, e.entitled_at, e.launch_date, e.won_at, e.product_id = l.product_id AS linked, e.owner_user_id = p.user_id AS owned FROM week_tournament_entries e JOIN product_launches l ON l.id = e.launch_id JOIN products p ON p.id = e.product_id ORDER BY e.status`,
      ),
    ).toStrictEqual([
      {
        id: plan.open.weekEntryId,
        status: 'awaiting_payment',
        entitlement_source: null,
        entitled_at: null,
        launch_date: LAUNCH_DATE,
        won_at: QUALIFIER_WINDOW.startsAt.getTime(),
        linked: 1,
        owned: 1,
      },
      {
        id: plan.ultras.weekEntryId,
        status: 'entitled',
        entitlement_source: 'ultras',
        entitled_at: NOW.getTime(),
        launch_date: LAUNCH_DATE,
        won_at: QUALIFIER_WINDOW.startsAt.getTime(),
        linked: 1,
        owned: 1,
      },
    ]);
  });

  test('予選は開始時点で確定した不戦勝で、確定のイベントを処理済みの形で持つ', () => {
    const plan = createdPlan();

    expect(
      queryRows(
        `SELECT m.id, m.kind, m.match_date, m.decision, me.result, me.launch_id, ev.type, ev.status FROM matches m JOIN match_entries me ON me.match_id = m.id JOIN match_events ev ON ev.match_id = m.id ORDER BY m.id`,
      ),
    ).toStrictEqual(
      [plan.open, plan.ultras]
        .map((entrant) => ({
          id: entrant.qualifierMatchId,
          kind: 'qualifier',
          match_date: LAUNCH_DATE,
          decision: 'bye',
          result: 'bye',
          launch_id: entrant.launchId,
          type: 'decided',
          status: 'completed',
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  test('受付中の枠の投稿者を渡すと、その利用者のプロダクトとして作り利用者は1人だけ作る', () => {
    insertVerifiedUser('U1', 'entrant-owner');
    const plan = planOf('U1');

    executeAll(weekEntrantsInsertSql(plan));

    expect(
      queryRows(
        `SELECT e.status, e.owner_user_id = 'U1' AS existing FROM week_tournament_entries e ORDER BY e.status`,
      ),
    ).toStrictEqual([
      { status: 'awaiting_payment', existing: 1 },
      { status: 'entitled', existing: 0 },
    ]);
    expect(queryRows('SELECT COUNT(*) AS count FROM users')).toStrictEqual([
      { count: 2 },
    ]);
  });

  test('枠が2件返らなければ失敗する', () => {
    const plan = planOf();

    expect(() => {
      parseWeekEntrantsInsert([{ id: plan.open.weekEntryId }], plan);
    }).toThrow(
      `週(${WEEK_START})のWeekトーナメントの参加の枠を2件作れませんでした`,
    );
  });
});

describe('openEntryEntitleSql', () => {
  test('受付中の枠だけをUltrasの出どころの参加資格にする', () => {
    const plan = createdPlan();

    expect(
      executeAll(openEntryEntitleSql(plan.open.weekEntryId, NOW)),
    ).toStrictEqual([{ id: plan.open.weekEntryId }]);
    expect(
      executeAll(openEntryEntitleSql(plan.ultras.weekEntryId, NOW)),
    ).toStrictEqual([]);
    expect(
      queryRows(
        `SELECT status, entitlement_source, entitled_at FROM week_tournament_entries WHERE id = '${plan.open.weekEntryId}'`,
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

describe('entryWindowCloseSql', () => {
  const pastWindow = {
    acceptUntil: new Date('2005-03-15T07:00:00.000Z'),
    deadlineAt: new Date('2005-03-15T07:35:00.000Z'),
    drawAt: new Date('2005-03-15T07:45:00.000Z'),
  };

  test('組み合わせ決定の前の週の3つの期限を現在より過去へ移し、組み合わせ決定の対象にする', () => {
    const plan = createdPlan();

    expect(
      executeAll(entryWindowCloseSql(plan.tournamentId, pastWindow, NOW)),
    ).toStrictEqual([{ id: plan.tournamentId }]);
    expect(
      queryRows(
        `SELECT id FROM week_tournaments WHERE status IN ('open', 'drawing') AND draw_at <= ${String(NOW.getTime())} AND accept_until = ${String(pastWindow.acceptUntil.getTime())} AND deadline_at = ${String(pastWindow.deadlineAt.getTime())}`,
      ),
    ).toStrictEqual([{ id: plan.tournamentId }]);
  });

  test('組み合わせ決定を始めた週は書き換えない', () => {
    const plan = createdPlan();
    db.run(
      `UPDATE week_tournaments SET status = 'drawing', draw_started_at = 1 WHERE id = ?`,
      [plan.tournamentId],
    );

    expect(
      executeAll(entryWindowCloseSql(plan.tournamentId, pastWindow, NOW)),
    ).toStrictEqual([]);
  });

  test('組み合わせ決定の日時が未来か、期限の順が規則と違えば失敗する', () => {
    expect(() =>
      entryWindowCloseSql(
        'T',
        { ...pastWindow, drawAt: new Date(NOW.getTime() + 1) },
        NOW,
      ),
    ).toThrow(RangeError);
    expect(() =>
      entryWindowCloseSql(
        'T',
        { ...pastWindow, deadlineAt: pastWindow.acceptUntil },
        NOW,
      ),
    ).toThrow(RangeError);
  });
});

describe('weekFinalSql・parseWeekFinal', () => {
  test('組み合わせ決定の前は決勝が無い', () => {
    const plan = createdPlan();

    expect(
      parseWeekFinal(queryRows(weekFinalSql(plan.tournamentId))),
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

  test('行の形式が違うか、別のマッチの行が混ざれば失敗する', () => {
    const row = {
      match_id: 'MF',
      bracket_id: 'B1',
      round: 1,
      match_date: TOMORROW,
      bracket_status: 'scheduled',
      started_at: null,
      decided_at: null,
      product_id: 'P1',
    };

    expect(() =>
      parseWeekFinal([{ ...row, bracket_status: 'unknown' }]),
    ).toThrow('決勝の照会の結果の形式が正しくありません');
    expect(() => parseWeekFinal([{ ...row, started_at: '1' }])).toThrow(
      '決勝の照会の結果の形式が正しくありません',
    );
    expect(() => parseWeekFinal([row, { ...row, match_id: 'OTHER' }])).toThrow(
      '決勝の照会の結果の形式が正しくありません',
    );
  });
});

describe('weekFinalStartSql', () => {
  test('予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移し、開始を記録済みにする', () => {
    const plan = createdPlan();
    const final = startedFinal(plan);

    expect(final).toMatchObject({
      matchDate: TODAY,
      bracketStatus: 'scheduled',
      startedAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
      decidedAt: null,
    });
    expect(
      queryRows(
        `SELECT m.match_date, m.starts_at <= ${String(NOW.getTime())} AS started_before_now, m.ends_at > ${String(NOW.getTime())} AS ends_after_now, (SELECT COUNT(*) FROM match_entries WHERE match_id = m.id AND match_date = '${TODAY}') AS moved_entries, (SELECT first_round_date FROM tournament_brackets WHERE id = 'B1') AS first_round_date FROM matches m WHERE m.id = 'MF'`,
      ),
    ).toStrictEqual([
      {
        match_date: TODAY,
        started_before_now: 1,
        ends_after_now: 1,
        moved_entries: 2,
        first_round_date: TODAY,
      },
    ]);
    expect(
      queryRows(`SELECT type, status FROM match_events WHERE match_id = 'MF'`),
    ).toStrictEqual([{ type: 'started', status: 'completed' }]);
  });

  test('開始済みの決勝や、未来の開始・過去の終了は失敗する', () => {
    const plan = createdPlan();
    const final = startedFinal(plan);
    const write = {
      businessDate: TODAY,
      startsAt: new Date(NOW.getTime() - MINUTE_MS),
      endsAt: new Date(NOW.getTime() + MINUTE_MS),
      startedEventId: 'SE2',
      now: NOW,
    };

    expect(() => weekFinalStartSql(final, write)).toThrow(
      '決勝(MF)は開始前の予定済みのマッチではありません',
    );
    const scheduled = { ...final, startedAt: null };
    expect(() =>
      weekFinalStartSql(scheduled, {
        ...write,
        startsAt: new Date(NOW.getTime() + 1),
      }),
    ).toThrow(RangeError);
    expect(() =>
      weekFinalStartSql(scheduled, { ...write, endsAt: NOW }),
    ).toThrow(RangeError);
  });
});

describe('weekFinalEndSql・parseWeekFinalEnd', () => {
  const endWriteOf = (plan: WeekEntrantsPlan) => ({
    supporter: planFixtureUser('supporter', SUFFIX, nextId),
    upvoteId: 'UV',
    winnerProductId: plan.open.productId,
    upvotedAt: new Date(NOW.getTime() - 2 * MINUTE_MS),
    endsAt: new Date(NOW.getTime() - MINUTE_MS),
    now: NOW,
  });

  test('勝たせる側にサポーターのUpvoteを1票入れて集計値をそろえ、終了の日時を過去へ移して確定のジョブの対象にする', () => {
    const plan = createdPlan();
    const final = startedFinal(plan);
    const write = endWriteOf(plan);

    const rows = executeAll(weekFinalEndSql(final, write));

    expect(() => {
      parseWeekFinalEnd(rows, final, 'UV');
    }).not.toThrow();
    expect(
      queryRows(
        `SELECT me.product_id, me.upvote_count, me.last_upvoted_at, me.last_upvote_seq FROM match_entries me WHERE me.match_id = 'MF' ORDER BY me.slot`,
      ),
    ).toStrictEqual([
      {
        product_id: plan.ultras.productId,
        upvote_count: 0,
        last_upvoted_at: null,
        last_upvote_seq: null,
      },
      {
        product_id: plan.open.productId,
        upvote_count: 1,
        last_upvoted_at: write.upvotedAt.getTime(),
        last_upvote_seq: 1,
      },
    ]);
    expect(
      queryRows(
        `SELECT u.user_id = '${write.supporter.id}' AS by_supporter, u.match_date, u.upvoted_at > m.started_at AND u.upvoted_at < m.ends_at AS within_match FROM match_upvotes u JOIN matches m ON m.id = u.match_id`,
      ),
    ).toStrictEqual([{ by_supporter: 1, match_date: TODAY, within_match: 1 }]);
    expect(
      queryRows(
        `SELECT id FROM matches WHERE started_at IS NOT NULL AND decided_at IS NULL AND ends_at <= ${String(NOW.getTime())}`,
      ),
    ).toStrictEqual([{ id: 'MF' }]);
  });

  test('開始前・確定済みの決勝や、決勝の側でないプロダクト、範囲外の日時は失敗する', () => {
    const plan = createdPlan();
    const final = startedFinal(plan);
    const write = endWriteOf(plan);

    expect(() => weekFinalEndSql({ ...final, startedAt: null }, write)).toThrow(
      '決勝(MF)は開始済みで未確定のマッチではありません',
    );
    expect(() => weekFinalEndSql({ ...final, decidedAt: NOW }, write)).toThrow(
      '決勝(MF)は開始済みで未確定のマッチではありません',
    );
    expect(() =>
      weekFinalEndSql(final, { ...write, winnerProductId: 'OTHER' }),
    ).toThrow('プロダクト(OTHER)は決勝(MF)の側ではありません');
    expect(() =>
      weekFinalEndSql(final, {
        ...write,
        endsAt: new Date(NOW.getTime() + 1),
      }),
    ).toThrow(RangeError);
    expect(() =>
      weekFinalEndSql(final, { ...write, upvotedAt: write.endsAt }),
    ).toThrow(RangeError);
  });

  test('Upvoteと決勝の両方の行が返らなければ失敗する', () => {
    const plan = createdPlan();
    const final = startedFinal(plan);

    expect(() => {
      parseWeekFinalEnd([{ id: 'MF' }], final, 'UV');
    }).toThrow(
      '決勝(MF)のUpvoteの記録と終了の日時の書き換えができませんでした',
    );
  });
});

describe('finalDecidedEventSql・parseFinalDecidedEvent', () => {
  test('確定のイベントの処理の状態を読み、まだ無ければundefinedを返す', () => {
    const plan = createdPlan();
    startedFinal(plan);

    expect(
      parseFinalDecidedEvent(queryRows(finalDecidedEventSql('MF'))),
    ).toBeUndefined();

    db.run(
      `INSERT INTO match_events (id, match_id, match_kind, type, occurred_at, status, dispatch_count, last_dispatched_at, created_at, updated_at) VALUES ('DE', 'MF', 'week', 'decided', 1, 'pending', 1, 1, 1, 1)`,
    );

    expect(parseFinalDecidedEvent(queryRows(finalDecidedEventSql('MF')))).toBe(
      'pending',
    );
  });

  test('状態の値が想定外なら失敗する', () => {
    expect(() => parseFinalDecidedEvent([{ status: 'unknown' }])).toThrow(
      '確定のイベントの照会の結果の形式が正しくありません',
    );
  });
});

describe('weekTournamentStateSql・parseWeekTournamentState', () => {
  test('週の状態・結果・ブラケットと、受賞した枠のプロダクトを読む', () => {
    const plan = createdPlan();
    insertDrawnFinal(plan, 'MF');
    db.run(
      `UPDATE week_tournaments SET status = 'finished', outcome = 'awarded', champion_entry_id = ?, awarded_at = 1, finished_at = 1 WHERE id = ?`,
      [plan.open.weekEntryId, plan.tournamentId],
    );

    expect(
      parseWeekTournamentState(
        queryRows(weekTournamentStateSql(plan.tournamentId)),
        plan.tournamentId,
      ),
    ).toStrictEqual({
      status: 'finished',
      outcome: 'awarded',
      bracketId: 'B1',
      championProductId: plan.open.productId,
    });
  });

  test('組み合わせ決定の前はブラケットと受賞が無い', () => {
    const plan = createdPlan();

    expect(
      parseWeekTournamentState(
        queryRows(weekTournamentStateSql(plan.tournamentId)),
        plan.tournamentId,
      ),
    ).toStrictEqual({
      status: 'open',
      outcome: null,
      bracketId: null,
      championProductId: null,
    });
  });

  test('週が無いか行の形式が違えば失敗する', () => {
    expect(() => parseWeekTournamentState([], 'T')).toThrow(
      'Weekトーナメント(T)が見つかりません',
    );
    expect(() =>
      parseWeekTournamentState(
        [
          {
            status: 'open',
            outcome: 1,
            bracket_id: null,
            champion_product_id: null,
          },
        ],
        'T',
      ),
    ).toThrow('Weekトーナメントの照会の結果の形式が正しくありません');
  });
});

describe('finalPendingEventCountSql・parseFinalPendingEventCount', () => {
  test('決勝のマッチの処理を終えていないイベントの数を数え、処理済みのイベントと他のマッチのイベントを数えない', () => {
    const plan = createdPlan();
    startedFinal(plan);

    expect(
      parseFinalPendingEventCount(queryRows(finalPendingEventCountSql('MF'))),
    ).toBe(0);

    db.run(
      `INSERT INTO match_events (id, match_id, match_kind, type, occurred_at, status, dispatch_count, last_dispatched_at, created_at, updated_at) VALUES ('SC', 'MF', 'week', 'scheduled', 1, 'pending', 1, 1, 1, 1)`,
    );

    expect(
      parseFinalPendingEventCount(queryRows(finalPendingEventCountSql('MF'))),
    ).toBe(1);
    expect(
      parseFinalPendingEventCount(
        queryRows(finalPendingEventCountSql('OTHER')),
      ),
    ).toBe(0);
  });

  test('数の形式が想定外なら失敗する', () => {
    expect(() => parseFinalPendingEventCount([{ pending: '1' }])).toThrow(
      '決勝のイベントの照会の結果の形式が正しくありません',
    );
    expect(() => parseFinalPendingEventCount([])).toThrow(
      '決勝のイベントの照会の結果の形式が正しくありません',
    );
  });
});

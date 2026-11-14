import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { join } from 'node:path';

import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import {
  type EndedQualifierInput,
  endedQualifierInsertSql,
  endedQualifierLookupSql,
  fixtureId,
  listedProductsInsertSql,
  parseEndedQualifierLookup,
  planListedProducts,
  type ResolvedQualifier,
} from './directory-fixture-sql.ts';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'db',
  'migrations',
);

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const BUSINESS_DATE = '2026-11-11';

const WINDOW = {
  startsAt: new Date('2026-11-11T08:00:00.000Z'),
  endsAt: new Date('2026-11-12T07:40:00.000Z'),
};

const NOW = new Date(WINDOW.startsAt.getTime() + 10 * 60 * 60 * 1000);

const INPUT: EndedQualifierInput = {
  winnerHandle: 'Winner-Product',
  loserHandle: "loser-o'product",
  supporterHandle: 'supporter',
  businessDate: BUSINESS_DATE,
};

let db: Database;

let idCount = 0;

const nextId = (): string => {
  idCount += 1;
  const random = new Uint8Array(10);
  new DataView(random.buffer).setUint32(6, idCount);
  return fixtureId(NOW, random);
};

const insertUser = (id: string, handle: string): void => {
  db.run(
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, 1, 1, 1, 1)`,
    [id, `p-${id}`, `${handle}@test.example`, handle, handle],
  );
};

const insertOpenLaunch = (
  productId: string,
  launchId: string,
  ownerId: string,
  handle: string,
): void => {
  db.run(
    `INSERT INTO products (id, user_id, category_id, handle, name, tagline, website_url, description_markdown, logo_file_id, latest_launch_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 't', 'https://x.example/', 'd', 'logo', ?, 1, 1)`,
    [productId, ownerId, OTHER_CATEGORY_ID, handle, handle, BUSINESS_DATE],
  );
  db.run(
    `INSERT INTO product_launches (id, product_id, launch_date, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`,
    [launchId, productId, BUSINESS_DATE],
  );
};

const queryRows = (sql: string): Record<string, unknown>[] =>
  db.query<Record<string, unknown>, []>(sql).all();

const RESOLVED: ResolvedQualifier = {
  winner: { productId: 'PW', launchId: 'LW', ownerUserId: 'UW' },
  loser: { productId: 'PL', launchId: 'LL', ownerUserId: 'UL' },
  supporterUserId: 'US',
};

beforeEach(async () => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const migration of await readNestedD1Migrations(MIGRATIONS_DIR)) {
    for (const query of migration.queries) {
      db.run(query);
    }
  }
  insertUser('UW', 'winner-owner');
  insertUser('UL', 'loser-owner');
  insertUser('US', 'supporter');
  insertOpenLaunch('PW', 'LW', 'UW', 'winner-product');
  insertOpenLaunch('PL', 'LL', 'UL', "loser-o'product");
});

afterEach(() => {
  db.close();
});

describe('fixtureId', () => {
  test('時刻の48ビットを先頭の10文字、乱数の80ビットを後の16文字として、Crockfordの32進数で表す', () => {
    const at = new Date(1_469_918_176_385);

    expect(fixtureId(at, new Uint8Array(10))).toBe(
      `01ARYZ6S41${'0'.repeat(16)}`,
    );
    expect(fixtureId(at, new Uint8Array(10).fill(0xff))).toBe(
      `01ARYZ6S41${'Z'.repeat(16)}`,
    );
  });

  test('アプリが採番するULIDと同じ形式になる', () => {
    expect(
      fixtureId(
        NOW,
        Uint8Array.from({ length: 10 }, (_, i) => i),
      ),
    ).toMatch(ULID_PATTERN);
  });

  test('乱数が10バイトでなければ失敗する', () => {
    expect(() => fixtureId(NOW, new Uint8Array(9))).toThrow(RangeError);
  });

  test('48ビットに収まらない時刻は失敗する', () => {
    expect(() => fixtureId(new Date(2 ** 48), new Uint8Array(10))).toThrow(
      RangeError,
    );
  });
});

describe('endedQualifierLookupSql・parseEndedQualifierLookup', () => {
  test('2つのプロダクトの未確定のローンチと投稿者を、ハンドルの大文字小文字を区別せずに読み、サポーターを解決する', () => {
    const rows = queryRows(endedQualifierLookupSql(INPUT));

    expect(parseEndedQualifierLookup(rows, INPUT)).toStrictEqual({
      winner: { productId: 'PW', launchId: 'LW', ownerUserId: 'UW' },
      loser: { productId: 'PL', launchId: 'LL', ownerUserId: 'UL' },
      supporterUserId: 'US',
    });
  });

  test('業務日付が違うローンチは読まない', () => {
    db.run(
      `UPDATE product_launches SET launch_date = '2026-11-12' WHERE id = 'LL'`,
    );
    const rows = queryRows(endedQualifierLookupSql(INPUT));

    expect(() => parseEndedQualifierLookup(rows, INPUT)).toThrow(
      `プロダクト(${INPUT.loserHandle})の${BUSINESS_DATE}の未確定のローンチがありません`,
    );
  });

  test('サポーターが見つからなければ失敗する', () => {
    const input = { ...INPUT, supporterHandle: 'nobody' };
    const rows = queryRows(endedQualifierLookupSql(input));

    expect(() => parseEndedQualifierLookup(rows, input)).toThrow(
      'サポーター(nobody)が見つかりません',
    );
  });

  test('サポーターがどちらかのプロダクトの投稿者なら失敗する', () => {
    const input = { ...INPUT, supporterHandle: 'winner-owner' };
    const rows = queryRows(endedQualifierLookupSql(input));

    expect(() => parseEndedQualifierLookup(rows, input)).toThrow(
      'サポーター(winner-owner)は対戦するプロダクトの投稿者のためUpvoteできません',
    );
  });

  test('結果の値が文字列でなければ失敗する', () => {
    expect(() =>
      parseEndedQualifierLookup(
        [
          {
            handle: 'winner-product',
            product_id: 1,
            launch_id: 'LW',
            owner_user_id: 'UW',
            supporter_user_id: 'US',
          },
        ],
        INPUT,
      ),
    ).toThrow('ローンチの照会の結果の形式が正しくありません');
  });
});

describe('endedQualifierInsertSql', () => {
  const ids = {
    matchId: 'M1',
    winnerEntryId: 'EW',
    loserEntryId: 'EL',
    upvoteId: 'V1',
  };

  test('開始を記録済みで終了の日時を過ぎた未確定の予選を、確定のジョブが選ぶ形で作る', () => {
    db.run(
      endedQualifierInsertSql(RESOLVED, {
        businessDate: BUSINESS_DATE,
        window: WINDOW,
        now: NOW,
        ids,
      }),
    );

    const due = queryRows(
      `SELECT id, kind, match_date FROM matches WHERE started_at IS NOT NULL AND decided_at IS NULL AND ends_at <= ${String(NOW.getTime())} AND starts_at <= started_at`,
    );
    expect(due).toStrictEqual([
      { id: 'M1', kind: 'qualifier', match_date: BUSINESS_DATE },
    ]);
  });

  test('一方の側にだけサポーターのUpvoteを記録し、側の集計値をUpvoteにそろえる', () => {
    db.run(
      endedQualifierInsertSql(RESOLVED, {
        businessDate: BUSINESS_DATE,
        window: WINDOW,
        now: NOW,
        ids,
      }),
    );

    expect(
      queryRows(
        'SELECT e.id, e.slot, e.launch_id, e.product_id, e.owner_user_id, e.match_kind, e.match_date, e.upvote_count, e.last_upvote_seq, e.last_upvoted_at = (SELECT upvoted_at FROM match_upvotes WHERE entry_id = e.id) AS tallied, e.result FROM match_entries e ORDER BY e.slot',
      ),
    ).toStrictEqual([
      {
        id: 'EW',
        slot: 1,
        launch_id: 'LW',
        product_id: 'PW',
        owner_user_id: 'UW',
        match_kind: 'qualifier',
        match_date: BUSINESS_DATE,
        upvote_count: 1,
        last_upvote_seq: 1,
        tallied: 1,
        result: null,
      },
      {
        id: 'EL',
        slot: 2,
        launch_id: 'LL',
        product_id: 'PL',
        owner_user_id: 'UL',
        match_kind: 'qualifier',
        match_date: BUSINESS_DATE,
        upvote_count: 0,
        last_upvote_seq: null,
        tallied: null,
        result: null,
      },
    ]);
    expect(
      queryRows(
        'SELECT u.id, u.match_id, u.entry_id, u.user_id, u.match_date, u.seq, u.deleted_at, u.upvoted_at > m.starts_at AND u.upvoted_at < m.ends_at AS within_match FROM match_upvotes u JOIN matches m ON m.id = u.match_id',
      ),
    ).toStrictEqual([
      {
        id: 'V1',
        match_id: 'M1',
        entry_id: 'EW',
        user_id: 'US',
        match_date: BUSINESS_DATE,
        seq: 1,
        deleted_at: null,
        within_match: 1,
      },
    ]);
  });

  test('業務日付の開始の直後でも開始の日時を終了の日時より前にする', () => {
    const justAfterKickoff = new Date(WINDOW.startsAt.getTime() + 1000);

    db.run(
      endedQualifierInsertSql(RESOLVED, {
        businessDate: BUSINESS_DATE,
        window: WINDOW,
        now: justAfterKickoff,
        ids,
      }),
    );

    expect(
      queryRows(
        `SELECT count(*) AS due FROM matches WHERE starts_at < ends_at AND ends_at <= ${String(justAfterKickoff.getTime())}`,
      ),
    ).toStrictEqual([{ due: 1 }]);
  });
});

describe('planListedProducts・listedProductsInsertSql', () => {
  const MATCH_DATE = '2026-11-10';

  const MATCH_WINDOW = {
    startsAt: new Date('2026-11-10T08:00:00.000Z'),
    endsAt: new Date('2026-11-11T07:40:00.000Z'),
  };

  const plan = () =>
    planListedProducts({
      count: 21,
      matchDate: MATCH_DATE,
      window: MATCH_WINDOW,
      now: NOW,
      suffix: 'a1b2c3d4',
      nextId,
    });

  const LISTED_COUNT_SQL = `SELECT count(*) AS listed FROM products p JOIN users u ON u.id = p.user_id WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND u.deleted_at IS NULL AND u.status = 'active' AND EXISTS (SELECT 1 FROM product_launches l WHERE l.product_id = p.id AND l.outcome = 'won' AND l.cancelled_at IS NULL) AND EXISTS (SELECT 1 FROM match_entries e JOIN matches m ON m.id = e.match_id WHERE e.product_id = p.id AND e.launch_id IS NOT NULL AND e.match_kind = 'qualifier' AND e.result IN ('won', 'bye', 'walkover') AND m.decided_at IS NOT NULL AND e.match_date = '${MATCH_DATE}')`;

  test('識別子の接頭辞を共有する一意のハンドルと名称で、指定した件数のプロダクトを1人の投稿者に割り当てる', () => {
    const { owner, products } = plan();

    expect(owner.handle).toBe('e2e-dir-a1b2c3d4');
    expect(products).toHaveLength(21);
    expect(products[0]).toMatchObject({
      handle: 'e2e-dir-a1b2c3d4-01',
      name: 'E2Eディレクトリa1b2c3d4-01',
    });
    expect(products.at(-1)).toMatchObject({
      handle: 'e2e-dir-a1b2c3d4-21',
      name: 'E2Eディレクトリa1b2c3d4-21',
    });
    expect(new Set(products.map((product) => product.productId)).size).toBe(21);
  });

  test('可視の投稿者・プロダクト・確定した予選の不戦勝・勝ちのローンチを作り、全件が掲載の条件を満たす', () => {
    const fixture = plan();

    db.run(listedProductsInsertSql(fixture));

    expect(queryRows(LISTED_COUNT_SQL)).toStrictEqual([{ listed: 21 }]);
    expect(
      queryRows(
        `SELECT DISTINCT m.kind, m.decision, m.starts_at, m.ends_at, m.started_at = m.decided_at AS decided_at_kickoff, e.slot, e.upvote_count FROM matches m JOIN match_entries e ON e.match_id = m.id`,
      ),
    ).toStrictEqual([
      {
        kind: 'qualifier',
        decision: 'bye',
        starts_at: MATCH_WINDOW.startsAt.getTime(),
        ends_at: MATCH_WINDOW.endsAt.getTime(),
        decided_at_kickoff: 1,
        slot: 1,
        upvote_count: 0,
      },
    ]);
  });

  test('プロダクトの索引文書と掲載の記録は作らない', () => {
    db.run(listedProductsInsertSql(plan()));

    expect(
      queryRows(
        'SELECT (SELECT count(*) FROM product_search_documents) AS documents, (SELECT count(*) FROM directory_entries) AS entries',
      ),
    ).toStrictEqual([{ documents: 0, entries: 0 }]);
  });

  test('確定のイベントの掃き出し(直近48時間に確定し確定のイベントが無いマッチ)の対象を残さない', () => {
    db.run(listedProductsInsertSql(plan()));
    const sweepSince = NOW.getTime() - 2 * 24 * 60 * 60 * 1000;

    expect(
      queryRows(
        `SELECT count(*) AS missing FROM matches m WHERE m.decided_at >= ${String(sweepSince)} AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.type = 'decided')`,
      ),
    ).toStrictEqual([{ missing: 0 }]);
  });

  test('各マッチに、キックオフの時刻に確定して処理済みの確定のイベントを1件ずつ持たせる', () => {
    const fixture = plan();
    db.run(listedProductsInsertSql(fixture));

    expect(
      queryRows(
        `SELECT DISTINCT (SELECT count(*) FROM match_events e WHERE e.match_id = m.id) AS events, e.match_kind, e.type, e.status, e.occurred_at = m.decided_at AS at_decision, e.dispatch_count, e.last_dispatched_at = m.decided_at AS dispatched_at_decision, e.completed_at = m.decided_at AS completed_at_decision FROM matches m JOIN match_events e ON e.match_id = m.id`,
      ),
    ).toStrictEqual([
      {
        events: 1,
        match_kind: 'qualifier',
        type: 'decided',
        status: 'completed',
        at_decision: 1,
        dispatch_count: 1,
        dispatched_at_decision: 1,
        completed_at_decision: 1,
      },
    ]);
    expect(
      queryRows('SELECT id FROM match_events ORDER BY id').map(({ id }) => id),
    ).toStrictEqual(
      fixture.products.map(({ decidedEventId }) => decidedEventId).toSorted(),
    );
  });

  test.each([0, 1.5, 100])(
    '件数が1〜99の整数でなければ失敗する: %p',
    (count) => {
      expect(() =>
        planListedProducts({
          count,
          matchDate: MATCH_DATE,
          window: MATCH_WINDOW,
          now: NOW,
          suffix: 'a1b2c3d4',
          nextId,
        }),
      ).toThrow(RangeError);
    },
  );
});

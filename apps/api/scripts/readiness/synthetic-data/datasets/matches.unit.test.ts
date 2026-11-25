import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { decideAtKickoff } from '../../../../lib/core/match/match-decision.ts';
import { deriveMatchPhase } from '../../../../lib/core/match/match-model.ts';
import { createMigratedDatabase } from '../migrated-database.ts';
import { baseInstantOf, productAt } from '../entities.ts';
import {
  EVENT_HISTORY_DAYS,
  matchAt,
  qualifierPlanOf,
  tomorrowMatchOf,
} from '../qualifier-history.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext, SqlStatement } from '../sql-writer.ts';
import { matchesDataset } from './matches.ts';
import { productsDataset } from './products.ts';
import { usersDataset } from './users.ts';

const context: DatasetContext = { seed: 1, baseDate: '2026-11-24' };

const DAY_MS = 86_400_000;

const smokeStatements = (): SqlStatement[] => [
  ...matchesDataset.generate(SMOKE_PROFILE, context),
];

const countRows = (
  statements: Iterable<SqlStatement>,
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const statement of statements) {
    counts[statement.table] =
      (counts[statement.table] ?? 0) + statement.insertedRows;
  }
  return counts;
};

let db: Database;

beforeAll(() => {
  db = createMigratedDatabase();
  for (const dataset of [usersDataset, productsDataset, matchesDataset]) {
    for (const statement of dataset.generate(SMOKE_PROFILE, context)) {
      db.run(statement.text);
    }
  }
});

afterAll(() => {
  db.close();
});

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

const rows = <T extends Record<string, unknown>>(sql: string): T[] =>
  db.query<T, []>(sql).all();

describe('matchesDataset', () => {
  test('利用者とプロダクトのデータセットに依存する', () => {
    expect(matchesDataset.name).toBe('matches');
    expect(matchesDataset.dependsOn).toEqual(['users', 'products']);
  });

  test('先に作るべき利用者・プロダクトが無いと外部キーの違反になる', () => {
    const empty = createMigratedDatabase();
    try {
      expect(() => {
        for (const statement of smokeStatements()) {
          empty.run(statement.text);
        }
      }).toThrow(/FOREIGN KEY/u);
    } finally {
      empty.close();
    }
  });

  test('検証用の規模の全データセットを適用しても外部キーの違反が無い', () => {
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('同じ種と基準日なら同じ文を出す', () => {
    const texts = (): string[] =>
      smokeStatements().map((statement) => statement.text);

    expect(texts()).toEqual(texts());
  });

  test('想定規模では予選の勝利10万件を持つ件数のマッチ・側・ローンチ・Upvote・イベントを作る', () => {
    const counts = countRows(
      matchesDataset.generate(YEAR_ONE_PROFILE, context),
    );

    expect(counts).toMatchObject({
      matches: 100_001,
      qualifier_pairings: 219,
      directory_entries: 20_000,
      product_search_documents: 20_000,
    });
    expect(counts.match_entries).toBe(100_000 + 90_000 + 2);
    expect(counts.product_launches).toBe(100_000 + 90_000);
    expect(counts.match_upvotes).toBe(110_000);
  }, 120_000);
});

describe('予選の勝利と集計値', () => {
  test('予選の勝利(勝ち・不戦勝)は100件で、プロダクトごとに1回以上ある', () => {
    expect(
      scalar(
        "SELECT count(*) FROM match_entries WHERE match_kind = 'qualifier' AND result IN ('won', 'bye', 'walkover') AND launch_id IS NOT NULL AND product_id IS NOT NULL",
      ),
    ).toBe(100);
    expect(
      scalar(
        "SELECT count(DISTINCT product_id) FROM match_entries WHERE result IN ('won', 'bye')",
      ),
    ).toBe(SMOKE_PROFILE.products);
    expect(
      scalar("SELECT count(*) FROM match_entries WHERE result = 'bye'"),
    ).toBe(10);
  });

  test('勝利は昨日までの100日に1日1件ずつあり、昨日の分を含む', () => {
    expect(
      scalar(
        'SELECT count(DISTINCT match_date) FROM matches WHERE decided_at IS NOT NULL',
      ),
    ).toBe(100);
    expect(
      scalar(
        'SELECT max(match_date) FROM matches WHERE decided_at IS NOT NULL',
      ),
    ).toBe('2026-11-23');
    expect(
      scalar(
        'SELECT min(match_date) FROM matches WHERE decided_at IS NOT NULL',
      ),
    ).toBe('2026-08-16');
  });

  test('側のUpvote数・最終Upvote時間・最終の記録の順は、有効なUpvoteの記録と全ての側で一致する', () => {
    expect(
      scalar(
        `SELECT count(*) FROM match_entries e WHERE e.upvote_count <> (SELECT count(*) FROM match_upvotes u WHERE u.entry_id = e.id AND u.deleted_at IS NULL)
          OR coalesce(e.last_upvoted_at, -1) <> coalesce((SELECT max(u.upvoted_at) FROM match_upvotes u WHERE u.entry_id = e.id), -1)
          OR coalesce(e.last_upvote_seq, -1) <> coalesce((SELECT max(u.seq) FROM match_upvotes u WHERE u.entry_id = e.id), -1)`,
      ),
    ).toBe(0);
  });

  test('Upvoteの記録は、マッチの日付・側のマッチと一致し、連番はマッチごとに1から続く', () => {
    expect(
      scalar(
        'SELECT count(*) FROM match_upvotes u JOIN match_entries e ON e.id = u.entry_id JOIN matches m ON m.id = u.match_id WHERE e.match_id <> u.match_id OR u.match_date <> m.match_date',
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM (SELECT match_id FROM match_upvotes GROUP BY match_id HAVING min(seq) <> 1 OR max(seq) <> count(*))',
      ),
    ).toBe(0);
  });

  test('確定したマッチは側の結果が揃い、勝つ側のUpvoteが多い(同数は無い)', () => {
    expect(
      scalar(
        "SELECT count(*) FROM matches WHERE decided_at IS NOT NULL AND (started_at IS NULL OR decision NOT IN ('votes', 'bye'))",
      ),
    ).toBe(0);
    expect(
      scalar(
        `SELECT count(*) FROM matches m WHERE m.decision = 'votes' AND (
           SELECT upvote_count FROM match_entries WHERE match_id = m.id AND result = 'won'
         ) <= (
           SELECT upvote_count FROM match_entries WHERE match_id = m.id AND result = 'lost'
         )`,
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM matches m WHERE decided_at IS NOT NULL AND (SELECT count(*) FROM match_entries WHERE match_id = m.id AND result IS NOT NULL) <> (SELECT count(*) FROM match_entries WHERE match_id = m.id)',
      ),
    ).toBe(0);
  });

  test('側のローンチは、勝てば勝ち・負ければ負けで、マッチの確定の日時に確定している', () => {
    expect(
      scalar(
        `SELECT count(*) FROM match_entries e JOIN product_launches l ON l.id = e.launch_id JOIN matches m ON m.id = e.match_id
          WHERE e.match_kind = 'qualifier' AND m.decided_at IS NOT NULL AND (
            l.outcome <> (CASE e.result WHEN 'lost' THEN 'lost' ELSE 'won' END)
            OR l.decided_at <> m.decided_at OR l.launch_date <> m.match_date OR l.product_id <> e.product_id)`,
      ),
    ).toBe(0);
  });

  test('1つのプロダクトが同じ日に2つのローンチを持たず、未確定のローンチは1つだけである', () => {
    expect(
      scalar(
        'SELECT count(*) FROM (SELECT product_id, launch_date FROM product_launches GROUP BY product_id, launch_date HAVING count(*) > 1)',
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM (SELECT product_id FROM product_launches WHERE outcome IS NULL AND cancelled_at IS NULL GROUP BY product_id HAVING count(*) <> 1)',
      ),
    ).toBe(0);
  });

  test('ローンチはプロダクトの作成より後に作られ、プロダクトの最新のローンチ日は変わらない', () => {
    expect(
      scalar(
        'SELECT count(*) FROM product_launches l JOIN products p ON p.id = l.product_id WHERE l.created_at < p.created_at',
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM products p WHERE p.latest_launch_date <> (SELECT max(launch_date) FROM product_launches WHERE product_id = p.id)',
      ),
    ).toBe(0);
  });

  test('側の投稿者のIDはプロダクトの投稿者と一致し、Upvoteした利用者は側の投稿者ではない', () => {
    expect(
      scalar(
        'SELECT count(*) FROM match_entries e JOIN products p ON p.id = e.product_id WHERE e.owner_user_id <> p.user_id',
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM match_upvotes u WHERE u.user_id IN (SELECT owner_user_id FROM match_entries WHERE match_id = u.match_id)',
      ),
    ).toBe(0);
  });

  test('実施日ごとの予選の組み合わせが完了した記録を、マッチの数と側の数とともに持つ', () => {
    expect(
      scalar(
        "SELECT count(*) FROM qualifier_pairings WHERE status = 'completed' AND completed_at IS NOT NULL",
      ),
    ).toBe(101);
    expect(
      scalar(
        `SELECT count(*) FROM qualifier_pairings q WHERE q.match_count <> (SELECT count(*) FROM matches WHERE match_date = q.match_date)
          OR q.launch_count <> (SELECT count(*) FROM match_entries WHERE match_date = q.match_date)`,
      ),
    ).toBe(0);
  });
});

describe('翌業務日の予選', () => {
  const tomorrow = tomorrowMatchOf({
    seed: 1,
    baseDate: '2026-11-24',
    profile: SMOKE_PROFILE,
  });

  test('作り手とその対戦相手の2つの側で、開始も確定も記録されていない予定のマッチを作る', () => {
    const [match] = rows<{
      id: string;
      starts_at: number;
      ends_at: number;
      started_at: number | null;
      decided_at: number | null;
      decision: string | null;
    }>(
      "SELECT id, starts_at, ends_at, started_at, decided_at, decision FROM matches WHERE match_date = '2026-11-25'",
    );

    expect(match?.id).toBe(tomorrow.matchId);
    expect(match?.started_at).toBeNull();
    expect(match?.decided_at).toBeNull();
    expect(match?.decision).toBeNull();
    expect(match?.starts_at).toBe(tomorrow.startsAt.getTime());
    expect(match?.ends_at).toBe(tomorrow.endsAt.getTime());
    expect(
      rows<{ handle: string; slot: number; upvote_count: number }>(
        "SELECT p.handle AS handle, e.slot AS slot, e.upvote_count AS upvote_count FROM match_entries e JOIN products p ON p.id = e.product_id WHERE e.match_id = '" +
          tomorrow.matchId +
          "' ORDER BY e.slot",
      ),
    ).toEqual([
      { handle: 'synthetic-p-000001', slot: 1, upvote_count: 0 },
      { handle: 'synthetic-p-000002', slot: 2, upvote_count: 0 },
    ]);
  });

  test('側は翌業務日の未確定のローンチを指し、結果と該当の記録を持たない', () => {
    expect(
      scalar(
        `SELECT count(*) FROM match_entries e JOIN product_launches l ON l.id = e.launch_id
          WHERE e.match_id = '${tomorrow.matchId}' AND l.outcome IS NULL AND l.cancelled_at IS NULL AND l.launch_date = '2026-11-25'
            AND e.result IS NULL AND e.forfeited_at IS NULL AND e.unlinked_at IS NULL AND e.match_kind = 'qualifier'`,
      ),
    ).toBe(2);
  });

  test('上流の判定で、0:00のジョブが開始して予定からマッチ中になる状態である', () => {
    const startsAt = tomorrow.startsAt;
    const match = {
      startsAt,
      endsAt: tomorrow.endsAt,
      startedAt: null,
      decidedAt: null,
    };

    expect(deriveMatchPhase(match, baseInstantOf('2026-11-24'))).toBe(
      'scheduled',
    );
    expect(
      decideAtKickoff(
        tomorrow.sides.map((side) => ({
          entryId: side.entryId,
          forfeited: false,
        })),
      ).kind,
    ).toBe('start');
    expect(
      deriveMatchPhase(
        { ...match, startedAt: new Date(startsAt.getTime() + 3_000) },
        new Date(startsAt.getTime() + 60_000),
      ),
    ).toBe('live');
  });

  test('予選の組み合わせの完了の記録は2つの側と1つのマッチで、0:00の回復で組み直されない', () => {
    expect(
      rows(
        "SELECT status, launch_count, match_count FROM qualifier_pairings WHERE match_date = '2026-11-25'",
      ),
    ).toEqual([{ status: 'completed', launch_count: 2, match_count: 1 }]);
  });
});

describe('マッチイベント', () => {
  test('イベントは全て処理済みで、確定から29日以内のマッチだけが開始・確定のイベントを持つ', () => {
    expect(
      scalar("SELECT count(*) FROM match_events WHERE status <> 'completed'"),
    ).toBe(0);
    expect(
      scalar(
        "SELECT count(*) FROM matches WHERE decided_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match_events WHERE match_id = matches.id AND type = 'decided') AND decided_at >= " +
          String(
            baseInstantOf('2026-11-24').getTime() - EVENT_HISTORY_DAYS * DAY_MS,
          ),
      ),
    ).toBe(0);
    expect(
      scalar(
        'SELECT count(*) FROM matches WHERE decided_at < ' +
          String(
            baseInstantOf('2026-11-24').getTime() -
              (EVENT_HISTORY_DAYS + 1) * DAY_MS,
          ) +
          ' AND EXISTS (SELECT 1 FROM match_events WHERE match_id = matches.id)',
      ),
    ).toBe(0);
  });

  test('不戦勝のマッチは開始のイベントを持たず、予選の予定と確定のイベントだけを持つ', () => {
    const plan = qualifierPlanOf({
      seed: 1,
      baseDate: '2026-11-24',
      profile: SMOKE_PROFILE,
    });
    const bye = matchAt(plan, 99);
    const normal = matchAt(plan, 98);

    const typesOf = (matchId: string): string[] =>
      rows<{ type: string }>(
        `SELECT type FROM match_events WHERE match_id = '${matchId}' ORDER BY occurred_at`,
      ).map((row) => row.type);
    expect(bye.bye).toBe(true);
    expect(typesOf(bye.matchId)).toEqual(['scheduled', 'decided']);
    expect(typesOf(normal.matchId)).toEqual([
      'scheduled',
      'started',
      'decided',
    ]);
  });
});

describe('ディレクトリの掲載の記録と索引文書', () => {
  test('全てのプロダクトに掲載の記録が1件ずつあり、最初の勝利の確定の日時と投稿者を持つ', () => {
    expect(scalar('SELECT count(*) FROM directory_entries')).toBe(20);
    expect(
      scalar(
        `SELECT count(*) FROM directory_entries d WHERE d.first_won_at <> (
           SELECT min(m.decided_at) FROM match_entries e JOIN matches m ON m.id = e.match_id
            WHERE e.product_id = d.product_id AND e.result IN ('won', 'bye'))
          OR d.owner_user_id <> (SELECT user_id FROM products WHERE id = d.product_id)
          OR d.created_at <> d.first_won_at`,
      ),
    ).toBe(0);
  });

  test('全てのプロダクトに索引文書が1件ずつあり、名前とタグラインが一致し、再抽出の対象にならない', () => {
    expect(scalar('SELECT count(*) FROM product_search_documents')).toBe(20);
    expect(
      scalar(
        'SELECT count(*) FROM product_search_documents d JOIN products p ON p.id = d.source_id WHERE d.name <> p.name OR d.tagline <> p.tagline',
      ),
    ).toBe(0);
    expect(
      scalar(
        "SELECT count(*) FROM product_search_documents WHERE keyword_status IN ('pending', 'fallback')",
      ),
    ).toBe(0);
  });

  test('索引文書のトリガーが全文検索の索引にも反映している', () => {
    expect(
      scalar('SELECT count(*) FROM product_search_documents_fts_docsize'),
    ).toBe(20);
  });

  test('掲載の条件(勝ちのローンチと表示できるプロダクト)を全てのプロダクトが満たす', () => {
    expect(
      scalar(
        "SELECT count(*) FROM products p WHERE p.hidden_at IS NULL AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM product_launches l WHERE l.product_id = p.id AND l.outcome = 'won')",
      ),
    ).toBe(20);
  });
});

describe('samples', () => {
  test('翌業務日のマッチと直近の確定したマッチのIDを返し、全て実在する', () => {
    const samples = matchesDataset.samples?.(SMOKE_PROFILE, context);
    const ids = samples?.matchIds ?? [];

    expect(ids.length).toBe(5);
    expect(ids[0]).toBe(
      tomorrowMatchOf({
        seed: 1,
        baseDate: '2026-11-24',
        profile: SMOKE_PROFILE,
      }).matchId,
    );
    for (const id of ids) {
      expect(scalar(`SELECT count(*) FROM matches WHERE id = '${id}'`)).toBe(1);
    }
  });

  test('2.1のプロダクトのハンドルと対応する', () => {
    expect(
      productAt({ seed: 1, baseDate: '2026-11-24', profile: SMOKE_PROFILE }, 0)
        .handle,
    ).toBe('synthetic-p-000001');
  });
});

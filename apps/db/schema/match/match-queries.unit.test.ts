import { describe, expect, test } from 'bun:test';

import { sql } from 'drizzle-orm';
import { SQLiteDialect } from 'drizzle-orm/sqlite-core';

import { qualifierWins } from './match-queries.ts';

const dialect = new SQLiteDialect();

describe('qualifierWins', () => {
  test('予選の勝利・不戦勝・相手の退会等による勝利で、ローンチとプロダクトの紐付けが残る側を選ぶ別名付きの副問い合わせになり、バインド変数を使わない', () => {
    const query = dialect.sqlToQuery(sql`select * from ${qualifierWins()}`);

    expect(query.sql).toBe(
      'select * from (select "match_entries"."launch_id" as "launch_id", "match_entries"."product_id" as "product_id", "match_entries"."upvote_count" as "upvote_count", "match_entries"."last_upvoted_at" as "last_upvoted_at", "match_entries"."match_date" as "match_date", "matches"."decided_at" as "decided_at" from "match_entries" inner join "matches" on "matches"."id" = "match_entries"."match_id" where (("match_entries"."match_kind" = \'qualifier\') and ("match_entries"."result" in (\'won\', \'bye\', \'walkover\')) and (("match_entries"."launch_id" is not null)) and (("match_entries"."product_id" is not null)))) "qualifier_wins"',
    );
    expect(query.params).toEqual([]);
  });

  test('呼び出すたびに新しい副問い合わせを返す', () => {
    expect(qualifierWins()).not.toBe(qualifierWins());
  });
});

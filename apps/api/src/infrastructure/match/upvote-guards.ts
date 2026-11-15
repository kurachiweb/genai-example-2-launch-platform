import { and, eq, gt, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../../../db/schema/identity/users.ts';
import { verifiedUsers } from '../../../db/schema/identity/visibility.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matches } from '../../../db/schema/match/matches.ts';

// 外側の文がmatchesを対象にしても列の参照が副問い合わせの側に取られないよう、別名で読む
const acceptingMatch = alias(matches, 'accepting_match');

// 状態の導出(deriveMatchPhase)のliveと同じ条件を、書き込みの時点の行と要求の時刻で確かめる
export function acceptingCondition(
  matchIdColumn: SQLiteColumn | SQL,
  now: Date,
): SQL {
  return sql`EXISTS (SELECT 1 FROM ${matches} AS ${acceptingMatch} WHERE ${and(
    eq(acceptingMatch.id, matchIdColumn),
    isNotNull(acceptingMatch.startedAt),
    isNull(acceptingMatch.decidedAt),
    gt(acceptingMatch.endsAt, now),
  )})`;
}

export interface UpvoteAllowedInput {
  readonly matchId: string;
  readonly entryId: string;
  readonly userId: string;
  readonly now: Date;
}

// UpvoteのNOT NULLの列へ入れるCASE式の条件。読み取りの後に終了の日時・確定・利用者の停止などが起きても記録の時点で拒否する
export function upvoteAllowedCondition(input: UpvoteAllowedInput): SQL {
  const entryOfMatch = sql`EXISTS (SELECT 1 FROM ${matchEntries} WHERE ${and(
    eq(matchEntries.id, input.entryId),
    eq(matchEntries.matchId, input.matchId),
  )})`;
  const notOwnMatch = sql`NOT EXISTS (SELECT 1 FROM ${matchEntries} WHERE ${and(
    eq(matchEntries.matchId, input.matchId),
    eq(matchEntries.ownerUserId, input.userId),
  )})`;
  const userVerified = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${and(
    eq(users.id, input.userId),
    verifiedUsers(),
  )})`;
  return sql`(${and(
    acceptingCondition(sql`${input.matchId}`, input.now),
    entryOfMatch,
    notOwnMatch,
    userVerified,
  )})`;
}

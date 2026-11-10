import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { tallyRecomputeStatement } from './tally-statements.ts';
import { acceptingCondition } from './upvote-guards.ts';

export type ClosureSubject =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'product'; readonly productId: string };

// 退会はall、停止はlive。Upvoteは利用者のものだけのため、プロダクトはnoneに限る
export type UpvoteClosure = 'all' | 'live' | 'none';

export type MatchClosureInput =
  | {
      readonly subject: Extract<ClosureSubject, { kind: 'user' }>;
      readonly upvotes: UpvoteClosure;
      readonly at: Date;
    }
  | {
      readonly subject: Extract<ClosureSubject, { kind: 'product' }>;
      readonly upvotes: 'none';
      readonly at: Date;
    };

// 外側の文がmatch_entriesを対象にしても列の参照が副問い合わせの側に取られないよう、別名で読む
const subjectEntry = alias(matchEntries, 'closure_subject_entry');

const walkoverEntry = alias(matchEntries, 'closure_walkover_entry');

function isSubjectEntry(
  entry: typeof matchEntries | typeof subjectEntry,
  subject: ClosureSubject,
): SQL {
  return subject.kind === 'user'
    ? eq(entry.ownerUserId, subject.userId)
    : eq(entry.productId, subject.productId);
}

function upvoteStatements(
  db: Database,
  userId: string,
  upvotes: 'all' | 'live',
  at: Date,
): BatchItem<'sqlite'>[] {
  return [
    db
      .update(matchUpvotes)
      .set({ deletedAt: at, updatedAt: at })
      .where(
        and(
          eq(matchUpvotes.userId, userId),
          isNull(matchUpvotes.deletedAt),
          upvotes === 'live'
            ? acceptingCondition(matchUpvotes.matchId, at)
            : undefined,
        ),
      ),
    // 論理削除の日時が同じ行を、この一括の書き込みで消したUpvoteとして側を絞る
    tallyRecomputeStatement(
      db,
      inArray(
        matchEntries.id,
        db
          .select({ entryId: matchUpvotes.entryId })
          .from(matchUpvotes)
          .where(
            and(
              eq(matchUpvotes.userId, userId),
              eq(matchUpvotes.deletedAt, at),
            ),
          ),
      ),
      at,
    ),
  ];
}

// 23:40の確定とどちらが先に書いても、受け付け中(decided_atが無く終了の日時の前)の条件で先に確定した方だけが有効になる
function closureStatements(
  db: Database,
  subject: ClosureSubject,
  at: Date,
): BatchItem<'sqlite'>[] {
  const subjectMatchIds = db
    .select({ matchId: subjectEntry.matchId })
    .from(subjectEntry)
    .where(isSubjectEntry(subjectEntry, subject));
  return [
    db
      .update(matchEntries)
      .set({
        result: sql`CASE WHEN ${isSubjectEntry(matchEntries, subject)} THEN 'lost' ELSE 'walkover' END`,
        updatedAt: at,
      })
      .where(
        and(
          inArray(matchEntries.matchId, subjectMatchIds),
          acceptingCondition(matchEntries.matchId, at),
        ),
      ),
    // 側の結果の更新の後に置き、同じマッチだけを確定する。相手の側が残らなければ両者敗北
    db
      .update(matches)
      .set({
        decidedAt: at,
        endedEarlyAt: at,
        decision: sql`CASE WHEN EXISTS (SELECT 1 FROM ${matchEntries} AS ${walkoverEntry} WHERE ${and(
          eq(walkoverEntry.matchId, matches.id),
          eq(walkoverEntry.result, 'walkover'),
        )}) THEN 'walkover' ELSE 'both_forfeited' END`,
        updatedAt: at,
      })
      .where(
        and(
          inArray(matches.id, subjectMatchIds),
          acceptingCondition(matches.id, at),
        ),
      ),
    // 開始の記録の前のマッチは、開始時点の決着で該当した側として扱う
    db
      .update(matchEntries)
      .set({ forfeitedAt: at, updatedAt: at })
      .where(
        and(
          isSubjectEntry(matchEntries, subject),
          isNull(matchEntries.forfeitedAt),
          inArray(
            matchEntries.matchId,
            db
              .select({ id: matches.id })
              .from(matches)
              .where(and(isNull(matches.startedAt), isNull(matches.decidedAt))),
          ),
        ),
      ),
  ];
}

// 利用者またはプロダクトの退場と同じ一括の書き込みに入れる、集合の更新の文。読み取りはしない
export function matchClosureStatements(
  db: Database,
  input: MatchClosureInput,
): readonly BatchItem<'sqlite'>[] {
  const upvotes =
    input.subject.kind === 'user' && input.upvotes !== 'none'
      ? upvoteStatements(db, input.subject.userId, input.upvotes, input.at)
      : [];
  return [...upvotes, ...closureStatements(db, input.subject, input.at)];
}

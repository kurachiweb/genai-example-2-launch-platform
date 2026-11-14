import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { deriveMatchPhase } from '../../../lib/core/match/match-model.ts';
import type {
  UpvoteApplyInput,
  UpvoteCancelInput,
  UpvoteState,
  UpvoteStore,
  UpvoteWriteResult,
} from '../../application/match/ports.ts';
import { tallyRecomputeStatement } from './tally-statements.ts';
import { acceptingCondition, upvoteAllowedCondition } from './upvote-guards.ts';

// D1は`D1_ERROR: NOT NULL constraint failed: match_upvotes.entry_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ。部分一意索引の違反も列の名前で報告される
const GUARD_VIOLATION_PATTERN =
  /NOT NULL constraint failed: match_upvotes\.entry_id(?::|$)/u;

const ACTIVE_UPVOTE_VIOLATION_PATTERN =
  /UNIQUE constraint failed: match_upvotes\.match_id, match_upvotes\.user_id(?::|$)/u;

function violationMatches(error: unknown, pattern: RegExp): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (pattern.test(current.message)) {
      return true;
    }
  }
  return false;
}

@injectable()
export class D1UpvoteStore implements UpvoteStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findState(
    matchId: string,
    userId: string,
    now: Date,
  ): Promise<UpvoteState | undefined> {
    const [rows, current] = await this.db.batch([
      this.db
        .select({
          startsAt: matches.startsAt,
          endsAt: matches.endsAt,
          startedAt: matches.startedAt,
          decidedAt: matches.decidedAt,
          entryId: matchEntries.id,
          ownerUserId: matchEntries.ownerUserId,
        })
        .from(matches)
        .innerJoin(matchEntries, eq(matchEntries.matchId, matches.id))
        .where(eq(matches.id, matchId))
        .orderBy(asc(matchEntries.slot)),
      this.db
        .select({ entryId: matchUpvotes.entryId })
        .from(matchUpvotes)
        .where(this.activeUpvoteOf(matchId, userId)),
    ]);
    const [first] = rows;
    if (first === undefined) {
      return undefined;
    }
    return {
      matchId,
      phase: deriveMatchPhase(first, now),
      entryIds: rows.map((row) => row.entryId),
      ownerUserIds: rows.map((row) => row.ownerUserId),
      currentEntryId: current[0]?.entryId ?? null,
    };
  }

  async apply(input: UpvoteApplyInput): Promise<UpvoteWriteResult> {
    const { action } = input;
    const insertion = this.guardedInsertion(
      input,
      action.kind === 'insert' ? action.entryId : action.toEntryId,
    );
    const tally = this.tallyOf(input.matchId, input.now);
    try {
      await this.db.batch(
        action.kind === 'switch'
          ? [
              this.activeUpvoteDeletion(input, action.fromEntryId),
              insertion,
              tally,
            ]
          : [insertion, tally],
      );
      return 'applied';
    } catch (error) {
      if (violationMatches(error, GUARD_VIOLATION_PATTERN)) {
        return 'rejected';
      }
      if (violationMatches(error, ACTIVE_UPVOTE_VIOLATION_PATTERN)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async cancel(input: UpvoteCancelInput): Promise<'cancelled' | 'nothing'> {
    const [deletion] = await this.db.batch([
      this.activeUpvoteDeletion(input),
      this.tallyOf(input.matchId, input.now),
    ]);
    return deletion.meta.changes > 0 ? 'cancelled' : 'nothing';
  }

  // 条件が成り立たなければentry_idがNULLになり、NOT NULL制約の違反で一括の書き込み全体を取り消す
  private guardedInsertion(
    input: UpvoteApplyInput,
    entryId: string,
  ): BatchItem<'sqlite'> {
    const { matchId, userId, now } = input;
    return this.db.insert(matchUpvotes).values({
      id: input.upvoteId,
      matchId,
      entryId: sql`CASE WHEN ${upvoteAllowedCondition({ matchId, entryId, userId, now })} THEN ${entryId} ELSE NULL END`,
      userId,
      matchDate: sql`(SELECT ${matches.matchDate} FROM ${matches} WHERE ${eq(matches.id, matchId)})`,
      upvotedAt: now,
      seq: sql`(SELECT COALESCE(MAX(${matchUpvotes.seq}), 0) + 1 FROM ${matchUpvotes} WHERE ${eq(matchUpvotes.matchId, matchId)})`,
      createdAt: now,
      updatedAt: now,
    });
  }

  private activeUpvoteOf(matchId: string, userId: string) {
    return and(
      eq(matchUpvotes.matchId, matchId),
      eq(matchUpvotes.userId, userId),
      isNull(matchUpvotes.deletedAt),
    );
  }

  // 付け替えは元の側のUpvoteだけを消す。読み取りの後に別の要求が先に付け替えていれば何も消さず、続く挿入が部分一意索引に当たって全体を取り消すため、付け替え先のUpvoteの日時と記録の順を進めない
  private activeUpvoteDeletion(input: UpvoteCancelInput, fromEntryId?: string) {
    return this.db
      .delete(matchUpvotes)
      .where(
        and(
          this.activeUpvoteOf(input.matchId, input.userId),
          fromEntryId === undefined
            ? undefined
            : eq(matchUpvotes.entryId, fromEntryId),
          acceptingCondition(matchUpvotes.matchId, input.now),
        ),
      );
  }

  private tallyOf(matchId: string, now: Date): BatchItem<'sqlite'> {
    return tallyRecomputeStatement(
      this.db,
      eq(matchEntries.matchId, matchId),
      now,
    );
  }
}

import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sum,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { visibleUsers } from '../../../db/schema/identity/visibility.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  deriveMatchPhase,
  type EntryResult,
  type MatchDecision,
  type MatchKind,
  type MatchStage,
} from '../../core/match/match-model.ts';
import type {
  DailyMatchSummary,
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
  QualifierResultRecord,
  SupporterCursor,
  SupporterDirectory,
  SupporterRecord,
} from '../../core/match/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const MAX_SUMMARY_DAYS = 366;

const MAX_SUPPORTER_PAGE_SIZE = 20;

const MILLISECONDS_PER_DAY = 86_400_000;

const MIDNIGHT = Object.freeze({ hour: 0, minute: 0 });

// 開始時点の決着(不戦勝・相手の該当による勝利・両者敗北)と区別するため、即時の終了の印か投票による決着を持つものだけを実施した予選として数える
const PLAYED_DECISIONS = ['votes', 'last_upvote', 'no_votes'] as const;

interface MatchRow {
  readonly matchId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly startedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly decision: MatchDecision | null;
  readonly endedEarlyAt: Date | null;
  readonly entryId: string;
  readonly slot: number;
  readonly launchId: string | null;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
  readonly upvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  readonly forfeitedAt: Date | null;
  readonly result: EntryResult | null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function matchColumns() {
  return {
    matchId: matches.id,
    kind: matches.kind,
    round: matches.round,
    stage: matches.stage,
    matchDate: matches.matchDate,
    startsAt: matches.startsAt,
    endsAt: matches.endsAt,
    startedAt: matches.startedAt,
    decidedAt: matches.decidedAt,
    decision: matches.decision,
    endedEarlyAt: matches.endedEarlyAt,
    entryId: matchEntries.id,
    slot: matchEntries.slot,
    launchId: matchEntries.launchId,
    productId: matchEntries.productId,
    ownerUserId: matchEntries.ownerUserId,
    upvoteCount: matchEntries.upvoteCount,
    lastUpvotedAt: matchEntries.lastUpvotedAt,
    forfeitedAt: matchEntries.forfeitedAt,
    result: matchEntries.result,
  };
}

function toEntryRecord(row: MatchRow): MatchEntryRecord {
  return {
    entryId: row.entryId,
    slot: row.slot === 1 ? 1 : 2,
    launchId: row.launchId,
    productId: row.productId,
    ownerUserId: row.ownerUserId,
    upvoteCount: row.upvoteCount,
    lastUpvotedAt: row.lastUpvotedAt,
    lastUpvoteElapsedMs:
      row.lastUpvotedAt === null
        ? null
        : row.lastUpvotedAt.getTime() - row.startsAt.getTime(),
    forfeited: row.forfeitedAt !== null,
    result: row.result,
  };
}

// 行はマッチごとに側の番号の順に並んでいるため、マッチの最初の行の順を保って1件にまとめる
function toMatchRecords(rows: readonly MatchRow[], now: Date): MatchRecord[] {
  return [...Map.groupBy(rows, (row) => row.matchId).values()].flatMap(
    (group) => {
      const [first] = group;
      if (first === undefined) {
        return [];
      }
      const times = {
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        startedAt: first.startedAt,
        decidedAt: first.decidedAt,
      };
      return [
        {
          matchId: first.matchId,
          kind: first.kind,
          round: first.round,
          stage: first.stage,
          matchDate: parseBusinessDate(first.matchDate),
          ...times,
          decision: first.decision,
          endedEarly: first.endedEarlyAt !== null,
          phase: deriveMatchPhase(times, now),
          entries: group.map(toEntryRecord),
        },
      ];
    },
  );
}

function startOf(date: BusinessDate): number {
  return fromBusinessDateTime(date, MIDNIGHT).getTime();
}

function datesBetween(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  const start = startOf(from);
  const days = (startOf(to) - start) / MILLISECONDS_PER_DAY + 1;
  if (days < 1 || days > MAX_SUMMARY_DAYS) {
    throw new RangeError(
      `日ごとの集計の期間は開始が終わり以前の1〜${String(MAX_SUMMARY_DAYS)}日で指定してください(${from}〜${to})`,
    );
  }
  return Array.from(
    { length: days },
    (_, offset) =>
      toBusinessDateTime(new Date(start + offset * MILLISECONDS_PER_DAY)).date,
  );
}

function playedQualifier(): SQL | undefined {
  return and(
    eq(matches.kind, 'qualifier'),
    isNotNull(matches.startedAt),
    or(
      isNotNull(matches.endedEarlyAt),
      isNull(matches.decision),
      inArray(matches.decision, PLAYED_DECISIONS),
    ),
  );
}

@injectable()
export class D1MatchDirectory implements MatchDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findMatches(
    matchIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, MatchRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(matchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(matchColumns())
          .from(matches)
          .innerJoin(matchEntries, eq(matchEntries.matchId, matches.id))
          .where(inArray(matches.id, page))
          .orderBy(asc(matches.id), asc(matchEntries.slot)),
      ),
    );
    return new Map(
      toMatchRecords(pages.flat(), now).map((match) => [match.matchId, match]),
    );
  }

  async listForDate(input: {
    readonly date: BusinessDate;
    readonly kinds: readonly MatchKind[];
    readonly now: Date;
  }): Promise<readonly MatchRecord[]> {
    if (input.kinds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select(matchColumns())
      .from(matches)
      .innerJoin(matchEntries, eq(matchEntries.matchId, matches.id))
      .where(
        and(
          eq(matches.matchDate, input.date),
          inArray(matches.kind, [...new Set(input.kinds)]),
        ),
      )
      .orderBy(asc(matches.id), asc(matchEntries.slot));
    return toMatchRecords(rows, input.now);
  }

  async listByLaunches(
    launchIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, readonly MatchRecord[]>> {
    const requested = new Set(launchIds);
    const pages = await Promise.all(
      chunk([...requested], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(matchColumns())
          .from(matches)
          .innerJoin(matchEntries, eq(matchEntries.matchId, matches.id))
          .where(
            inArray(
              matches.id,
              this.db
                .select({ matchId: matchEntries.matchId })
                .from(matchEntries)
                .where(inArray(matchEntries.launchId, page)),
            ),
          )
          .orderBy(
            desc(matches.matchDate),
            desc(matches.id),
            asc(matchEntries.slot),
          ),
      ),
    );
    // 両側のローンチが別の単位に入ったマッチは各単位が同じ側の行を返すため、側ごとに1行にしてからまとめ、実施日の新しい順に並べ直す
    const rows = [
      ...new Map(pages.flat().map((row) => [row.entryId, row])).values(),
    ];
    const records = toMatchRecords(rows, now).toSorted(
      (a, b) =>
        b.matchDate.localeCompare(a.matchDate) ||
        b.matchId.localeCompare(a.matchId),
    );
    const byLaunch = new Map<string, MatchRecord[]>();
    for (const record of records) {
      for (const entry of record.entries) {
        if (entry.launchId !== null && requested.has(entry.launchId)) {
          byLaunch.set(entry.launchId, [
            ...(byLaunch.get(entry.launchId) ?? []),
            record,
          ]);
        }
      }
    }
    return byLaunch;
  }

  async findQualifierResults(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, QualifierResultRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            launchId: matchEntries.launchId,
            matchId: matchEntries.matchId,
            result: matchEntries.result,
            upvoteCount: matchEntries.upvoteCount,
            lastUpvotedAt: matchEntries.lastUpvotedAt,
            decidedAt: matches.decidedAt,
          })
          .from(matchEntries)
          .innerJoin(matches, eq(matches.id, matchEntries.matchId))
          .where(
            and(
              eq(matchEntries.matchKind, 'qualifier'),
              inArray(matchEntries.launchId, page),
              isNotNull(matches.decidedAt),
              isNotNull(matchEntries.result),
            ),
          ),
      ),
    );
    return new Map(
      pages
        .flat()
        .flatMap(({ launchId, result, decidedAt, ...rest }) =>
          launchId === null || result === null || decidedAt === null
            ? []
            : [[launchId, { launchId, result, decidedAt, ...rest }] as const],
        ),
    );
  }

  async summarizeDaily(input: {
    readonly from: BusinessDate;
    readonly to: BusinessDate;
  }): Promise<readonly DailyMatchSummary[]> {
    const dates = datesBetween(input.from, input.to);
    const [played, upvoted] = await this.db.batch([
      this.db
        .select({ date: matches.matchDate, total: count() })
        .from(matches)
        .where(
          and(
            between(matches.matchDate, input.from, input.to),
            playedQualifier(),
          ),
        )
        .groupBy(matches.matchDate),
      this.db
        .select({
          date: matchEntries.matchDate,
          total: sum(matchEntries.upvoteCount).mapWith(Number),
        })
        .from(matchEntries)
        .innerJoin(matches, eq(matches.id, matchEntries.matchId))
        .where(
          and(
            between(matchEntries.matchDate, input.from, input.to),
            isNotNull(matches.decidedAt),
          ),
        )
        .groupBy(matchEntries.matchDate),
    ]);
    const playedByDate = new Map(played.map((row) => [row.date, row.total]));
    const upvotesByDate = new Map(upvoted.map((row) => [row.date, row.total]));
    return dates.map((date) => ({
      date,
      qualifierMatches: playedByDate.get(date) ?? 0,
      upvotes: upvotesByDate.get(date) ?? 0,
    }));
  }
}

function afterCursor(after: SupporterCursor | undefined): SQL | undefined {
  if (after === undefined) {
    return undefined;
  }
  return or(
    gt(matchUpvotes.upvotedAt, after.upvotedAt),
    and(
      eq(matchUpvotes.upvotedAt, after.upvotedAt),
      gt(matchUpvotes.id, after.upvoteId),
    ),
  );
}

@injectable()
export class D1SupporterDirectory implements SupporterDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listSupporters(input: {
    readonly entryId: string;
    readonly after: SupporterCursor | undefined;
    readonly limit: number;
  }): Promise<readonly SupporterRecord[]> {
    const { entryId, after, limit } = input;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_SUPPORTER_PAGE_SIZE
    ) {
      throw new RangeError(
        `サポーターの件数は1〜${String(MAX_SUPPORTER_PAGE_SIZE)}の整数で指定してください(${String(limit)})`,
      );
    }
    return this.db
      .select({
        upvoteId: matchUpvotes.id,
        userId: matchUpvotes.userId,
        upvotedAt: matchUpvotes.upvotedAt,
      })
      .from(matchUpvotes)
      .innerJoin(matches, eq(matches.id, matchUpvotes.matchId))
      .innerJoin(users, eq(users.id, matchUpvotes.userId))
      .where(
        and(
          eq(matchUpvotes.entryId, entryId),
          isNull(matchUpvotes.deletedAt),
          isNotNull(matches.decidedAt),
          visibleUsers(),
          afterCursor(after),
        ),
      )
      .orderBy(asc(matchUpvotes.upvotedAt), asc(matchUpvotes.id))
      .limit(limit);
  }
}

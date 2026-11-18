import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { chunk, IDS_PER_STATEMENT } from '../../core/d1/statement-chunks.ts';
import type { Database } from '../../../db/client.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type {
  NewWeekEntry,
  WeekAwardedProduct,
  WeekEntryClassification,
  WeekEntryRecord,
  WeekFollowUpTarget,
  WeekRefundClosedStatus,
  WeekTournamentFinish,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { GRANTABLE_STATUSES } from '../../core/week-tournament/week-entry-rules.ts';
import { entryWindowFor } from '../../core/week-tournament/week-schedule.ts';

const DRAWABLE_STATUSES = ['open', 'drawing'] as const;

// 喪失と分類の対象になる、組み合わせ決定の前の状態
const OPEN_ENTRY_STATUSES = ['awaiting_payment', 'entitled'] as const;

// 分類の書き込みを、ブラケットの書き込みと同じ50件ずつの一括にそろえる
const CLASSIFICATIONS_PER_BATCH = 50;

// 決済の無い枠は返金の依頼が要らないため、返金の再処理の対象にしない
const REFUND_ON_CLOSE = sql<
  'pending' | 'not_needed'
>`case when ${weekTournamentEntries.purchaseId} is not null then 'pending' else 'not_needed' end`;

const PENDING_FOLLOW_UP = or(
  eq(weekTournamentEntries.refundStatus, 'pending'),
  eq(weekTournamentEntries.refundNoticeStatus, 'pending'),
);

// 受賞の照会が優勝の枠を引けなくならないよう、受賞と優勝の枠の有無の食い違いを書き込む前に止める
function finishColumns(
  outcome: WeekTournamentFinish['outcome'],
  championEntryId: string | null,
  at: Date,
) {
  if ((outcome === 'awarded') !== (championEntryId !== null)) {
    throw new RangeError(
      `受賞の結果と優勝の枠が食い違っています: ${outcome}, ${String(championEntryId)}`,
    );
  }
  return {
    status: 'finished',
    outcome,
    championEntryId,
    awardedAt: outcome === 'awarded' ? at : null,
    finishedAt: at,
  } as const;
}

function followUpTargetCondition(target: WeekFollowUpTarget): SQL {
  if ('productId' in target) {
    return eq(weekTournamentEntries.productId, target.productId);
  }
  if ('ownerUserId' in target) {
    return eq(weekTournamentEntries.ownerUserId, target.ownerUserId);
  }
  return eq(weekTournamentEntries.tournamentId, target.tournamentId);
}

type EntryInsertRow = typeof weekTournamentEntries.$inferInsert;

// 挿入する値を、条件付きの挿入(INSERT ... SELECT)の選択の定数として各列の形式で渡す
function constantSelectionOf(row: EntryInsertRow) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      sql`${sql.param(value, weekTournamentEntries[key as keyof EntryInsertRow])}`.as(
        key,
      ),
    ]),
  ) as Record<keyof EntryInsertRow, SQL.Aliased>;
}

function batchOf(
  statements: readonly BatchItem<'sqlite'>[],
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] | undefined {
  const [first, ...rest] = statements;
  return first === undefined ? undefined : [first, ...rest];
}

const TOURNAMENT_COLUMNS = {
  tournamentId: weekTournaments.id,
  weekStart: weekTournaments.weekStart,
  acceptUntil: weekTournaments.acceptUntil,
  deadlineAt: weekTournaments.deadlineAt,
  drawAt: weekTournaments.drawAt,
  status: weekTournaments.status,
  drawStartedAt: weekTournaments.drawStartedAt,
  bracketId: weekTournaments.bracketId,
  outcome: weekTournaments.outcome,
  championEntryId: weekTournaments.championEntryId,
  awardedAt: weekTournaments.awardedAt,
};

const ENTRY_COLUMNS = {
  entryId: weekTournamentEntries.id,
  tournamentId: weekTournamentEntries.tournamentId,
  launchId: weekTournamentEntries.launchId,
  productId: weekTournamentEntries.productId,
  ownerUserId: weekTournamentEntries.ownerUserId,
  launchDate: weekTournamentEntries.launchDate,
  qualifierUpvoteCount: weekTournamentEntries.qualifierUpvoteCount,
  qualifierLastUpvoteElapsedMs:
    weekTournamentEntries.qualifierLastUpvoteElapsedMs,
  wonAt: weekTournamentEntries.wonAt,
  status: weekTournamentEntries.status,
  entitlementSource: weekTournamentEntries.entitlementSource,
  purchaseId: weekTournamentEntries.purchaseId,
  closeReason: weekTournamentEntries.closeReason,
  refundStatus: weekTournamentEntries.refundStatus,
  refundNoticeStatus: weekTournamentEntries.refundNoticeStatus,
};

type TournamentRow = Omit<WeekTournamentRecord, 'window'> & {
  readonly weekStart: string;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
};

type EntryRow = Omit<WeekEntryRecord, 'launchDate'> & {
  readonly launchDate: string;
};

function tournamentRecordOf({
  weekStart,
  acceptUntil,
  deadlineAt,
  drawAt,
  ...row
}: TournamentRow): WeekTournamentRecord {
  return {
    ...row,
    window: {
      weekStart: parseBusinessDate(weekStart),
      acceptUntil,
      deadlineAt,
      drawAt,
    },
  };
}

function entryRecordOf({ launchDate, ...row }: EntryRow): WeekEntryRecord {
  return { ...row, launchDate: parseBusinessDate(launchDate) };
}

@injectable()
export class D1WeekTournamentStore implements WeekTournamentStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  // 同時の作成でも行が1つにそろうよう、週の初日の一意索引で重複を無視し、保存した行を読み直す
  async ensureTournament(
    weekStart: BusinessDate,
    at: Date,
  ): Promise<WeekTournamentRecord> {
    const window = entryWindowFor(weekStart);
    await this.db
      .insert(weekTournaments)
      .values({
        weekStart: window.weekStart,
        acceptUntil: window.acceptUntil,
        deadlineAt: window.deadlineAt,
        drawAt: window.drawAt,
        status: 'open',
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    const record = await this.findTournamentByWeek(weekStart);
    if (record === undefined) {
      throw new Error(`週のトーナメントを記録できませんでした: ${weekStart}`);
    }
    return record;
  }

  async findTournament(
    tournamentId: string,
  ): Promise<WeekTournamentRecord | undefined> {
    const [record] = await this.selectTournaments(
      eq(weekTournaments.id, tournamentId),
    );
    return record;
  }

  async findTournamentByWeek(
    weekStart: BusinessDate,
  ): Promise<WeekTournamentRecord | undefined> {
    const [record] = await this.selectTournaments(
      eq(weekTournaments.weekStart, weekStart),
    );
    return record;
  }

  async findTournamentsByWeeks(
    weekStarts: readonly BusinessDate[],
  ): Promise<ReadonlyMap<BusinessDate, WeekTournamentRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(weekStarts)], IDS_PER_STATEMENT).map(async (page) =>
        this.selectTournaments(inArray(weekTournaments.weekStart, page)),
      ),
    );
    return new Map(
      pages.flat().map((record) => [record.window.weekStart, record]),
    );
  }

  listDue(now: Date, limit: number): Promise<readonly WeekTournamentRecord[]> {
    return this.selectTournaments(
      and(
        inArray(weekTournaments.status, DRAWABLE_STATUSES),
        lte(weekTournaments.drawAt, now),
      ),
      [asc(weekTournaments.drawAt), asc(weekTournaments.weekStart)],
      limit,
    );
  }

  listInProgress(limit: number): Promise<readonly WeekTournamentRecord[]> {
    return this.selectTournaments(
      eq(weekTournaments.status, 'in_progress'),
      [asc(weekTournaments.weekStart)],
      limit,
    );
  }

  async findEntriesByLaunch(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, WeekEntryRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(launchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(ENTRY_COLUMNS)
          .from(weekTournamentEntries)
          .where(inArray(weekTournamentEntries.launchId, page)),
      ),
    );
    return new Map(
      pages.flat().flatMap((row) => {
        const record = entryRecordOf(row);
        return record.launchId === null ? [] : [[record.launchId, record]];
      }),
    );
  }

  async findEntry(entryId: string): Promise<WeekEntryRecord | undefined> {
    const [row] = await this.db
      .select(ENTRY_COLUMNS)
      .from(weekTournamentEntries)
      .where(eq(weekTournamentEntries.id, entryId));
    return row === undefined ? undefined : entryRecordOf(row);
  }

  async listLaunchIdsByProduct(productId: string): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ launchId: weekTournamentEntries.launchId })
      .from(weekTournamentEntries)
      .where(
        and(
          eq(weekTournamentEntries.productId, productId),
          isNotNull(weekTournamentEntries.launchId),
        ),
      )
      .orderBy(asc(weekTournamentEntries.launchId));
    return rows.flatMap(({ launchId }) =>
      launchId === null ? [] : [launchId],
    );
  }

  async listEntriesForClassification(
    tournamentId: string,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(weekTournamentEntries)
      .where(
        and(
          eq(weekTournamentEntries.tournamentId, tournamentId),
          inArray(weekTournamentEntries.status, OPEN_ENTRY_STATUSES),
          afterEntryId === undefined
            ? undefined
            : gt(weekTournamentEntries.id, afterEntryId),
        ),
      )
      .orderBy(asc(weekTournamentEntries.id))
      .limit(limit);
    return rows.map(entryRecordOf);
  }

  // ブラケットは凍結後の同じ候補で作り直すため、紐付けを解除した枠も候補から外さない
  async listDrawnEntries(
    tournamentId: string,
  ): Promise<readonly WeekEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(weekTournamentEntries)
      .where(
        and(
          eq(weekTournamentEntries.tournamentId, tournamentId),
          eq(weekTournamentEntries.status, 'drawn'),
        ),
      )
      .orderBy(asc(weekTournamentEntries.id));
    return rows.map(entryRecordOf);
  }

  // 同じ勝利の知らせが重ねて届いても枠が1つにそろうよう、ローンチと週ごとのプロダクトの一意索引で重複を無視する。
  // 凍結の後の分類から漏れる枠を作らないよう、受付中・資格を得た枠は凍結前の条件を読み取りでなく挿入の文に含める
  async insertEntry({
    entryId,
    at,
    ...entry
  }: NewWeekEntry): Promise<'inserted' | 'exists' | 'frozen'> {
    const row: EntryInsertRow = {
      ...entry,
      id: entryId,
      entitledAt: entry.status === 'entitled' ? at : null,
      closedAt: entry.status === 'expired' ? at : null,
      createdAt: at,
      updatedAt: at,
    };
    if (entry.status === 'expired') {
      const result = await this.db
        .insert(weekTournamentEntries)
        .values(row)
        .onConflictDoNothing();
      return result.meta.changes > 0 ? 'inserted' : 'exists';
    }
    const result = await this.db
      .insert(weekTournamentEntries)
      .select(
        this.db
          .select(constantSelectionOf(row))
          .from(weekTournaments)
          .where(
            and(
              eq(weekTournaments.id, entry.tournamentId),
              isNull(weekTournaments.drawStartedAt),
            ),
          ),
      )
      .onConflictDoNothing();
    if (result.meta.changes > 0) {
      return 'inserted';
    }
    const tournament = await this.findTournament(entry.tournamentId);
    if (tournament === undefined) {
      throw new Error(
        `週のトーナメントが見つかりません: ${entry.tournamentId}`,
      );
    }
    return tournament.drawStartedAt === null ? 'exists' : 'frozen';
  }

  // 凍結と同時の加入の知らせが凍結後の資格を変えないよう、凍結前の条件と期間の条件を読み取りでなく更新の文に含める
  async grantByUltras(
    userId: string,
    activatedAt: Date,
    at: Date,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .update(weekTournamentEntries)
      .set({
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: at,
        updatedAt: at,
      })
      .where(
        and(
          eq(weekTournamentEntries.ownerUserId, userId),
          inArray(weekTournamentEntries.status, GRANTABLE_STATUSES),
          lte(weekTournamentEntries.wonAt, activatedAt),
          inArray(
            weekTournamentEntries.tournamentId,
            this.unfrozenTournamentIds(
              gte(weekTournaments.deadlineAt, activatedAt),
            ),
          ),
        ),
      )
      .returning({ entryId: weekTournamentEntries.id });
    return rows.map(({ entryId }) => entryId).toSorted();
  }

  forfeitByProduct(
    productId: string,
    reason: 'deleted',
    at: Date,
  ): Promise<readonly string[]> {
    return this.forfeit(
      eq(weekTournamentEntries.productId, productId),
      reason,
      at,
    );
  }

  forfeitByOwner(
    userId: string,
    reason: 'withdrawn',
    at: Date,
  ): Promise<readonly string[]> {
    return this.forfeit(
      eq(weekTournamentEntries.ownerUserId, userId),
      reason,
      at,
    );
  }

  // 凍結の後は資格を変える書き込みが条件の不一致で何もしなくなるため、凍結前の条件を更新の文に含めて凍結を1回にする
  async freeze(tournamentId: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(weekTournaments)
      .set({ status: 'drawing', drawStartedAt: at, updatedAt: at })
      .where(
        and(
          eq(weekTournaments.id, tournamentId),
          isNull(weekTournaments.drawStartedAt),
        ),
      )
      .returning({ tournamentId: weekTournaments.id });
    return rows.length > 0;
  }

  async classify(
    updates: readonly WeekEntryClassification[],
    at: Date,
  ): Promise<void> {
    const statements = updates.map((update) =>
      this.classifyStatement(update, at),
    );
    for (const part of chunk(statements, CLASSIFICATIONS_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
  }

  // 回復で呼び直しても記録済みのブラケットと結果を書き換えないよう、組み合わせ決定中の条件を更新の文に含める
  async markDrawn(
    tournamentId: string,
    bracketId: string,
    finished: WeekTournamentFinish | null,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(weekTournaments)
      .set({
        bracketId,
        drawnAt: at,
        ...(finished === null
          ? { status: 'in_progress' }
          : finishColumns(finished.outcome, finished.championEntryId, at)),
        updatedAt: at,
      })
      .where(
        and(
          eq(weekTournaments.id, tournamentId),
          eq(weekTournaments.status, 'drawing'),
        ),
      );
  }

  // イベントの処理と23:45のジョブが同時に終了を確定させても受賞が1回になるよう、終了していない条件を更新の文に含める
  async recordFinish(
    tournamentId: string,
    outcome: WeekTournamentFinish['outcome'],
    championEntryId: string | null,
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(weekTournaments)
      .set({ ...finishColumns(outcome, championEntryId, at), updatedAt: at })
      .where(
        and(
          eq(weekTournaments.id, tournamentId),
          ne(weekTournaments.status, 'finished'),
        ),
      )
      .returning({ tournamentId: weekTournaments.id });
    return rows.length > 0;
  }

  async listAwardedBetween(
    from: Date,
    to: Date,
  ): Promise<readonly WeekAwardedProduct[]> {
    const rows = await this.db
      .select({
        weekStart: weekTournaments.weekStart,
        productId: weekTournamentEntries.productId,
      })
      .from(weekTournaments)
      .innerJoin(
        weekTournamentEntries,
        eq(weekTournamentEntries.id, weekTournaments.championEntryId),
      )
      .where(
        and(
          eq(weekTournaments.outcome, 'awarded'),
          gte(weekTournaments.awardedAt, from),
          lt(weekTournaments.awardedAt, to),
          isNotNull(weekTournamentEntries.productId),
        ),
      )
      .orderBy(asc(weekTournaments.awardedAt), asc(weekTournaments.weekStart));
    return rows.flatMap(({ weekStart, productId }) =>
      productId === null
        ? []
        : [{ weekStart: parseBusinessDate(weekStart), productId }],
    );
  }

  // 処理中の枠を再処理で重ねて扱わないよう、基準の時刻より前に更新した枠だけを返す
  async listPendingFollowUps(
    olderThan: Date,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(weekTournamentEntries)
      .where(
        and(PENDING_FOLLOW_UP, lt(weekTournamentEntries.updatedAt, olderThan)),
      )
      .orderBy(
        asc(weekTournamentEntries.updatedAt),
        asc(weekTournamentEntries.id),
      )
      .limit(limit);
    return rows.map(entryRecordOf);
  }

  async listPendingFollowUpsOf(
    target: WeekFollowUpTarget,
    limit: number,
  ): Promise<readonly WeekEntryRecord[]> {
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(weekTournamentEntries)
      .where(and(PENDING_FOLLOW_UP, followUpTargetCondition(target)))
      .orderBy(asc(weekTournamentEntries.id))
      .limit(limit);
    return rows.map(entryRecordOf);
  }

  // 重複の処理で返金の知らせを送り直さないよう、返金待ちの条件を更新の文に含める
  async markRefundRequested(entryId: string, at: Date): Promise<void> {
    await this.db
      .update(weekTournamentEntries)
      .set({
        refundStatus: 'requested',
        refundRequestedAt: at,
        refundNoticeStatus: 'pending',
        updatedAt: at,
      })
      .where(
        and(
          eq(weekTournamentEntries.id, entryId),
          eq(weekTournamentEntries.refundStatus, 'pending'),
        ),
      );
  }

  async markRefundClosed(
    entryId: string,
    status: WeekRefundClosedStatus,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(weekTournamentEntries)
      .set({ refundStatus: status, updatedAt: at })
      .where(
        and(
          eq(weekTournamentEntries.id, entryId),
          eq(weekTournamentEntries.refundStatus, 'pending'),
        ),
      );
  }

  async markNotice(
    entryId: string,
    status: 'sent' | 'skipped',
    at: Date,
  ): Promise<void> {
    await this.db
      .update(weekTournamentEntries)
      .set({ refundNoticeStatus: status, updatedAt: at })
      .where(
        and(
          eq(weekTournamentEntries.id, entryId),
          eq(weekTournamentEntries.refundNoticeStatus, 'pending'),
        ),
      );
  }

  // ブラケットの参加者と受賞が組み合わせに入った枠を参照し続けるため、その枠は残す。
  // 投稿者の列も外部キーのため、解除しないと利用者の物理削除が失敗する
  async unlinkOrDeleteByProduct(
    productId: string,
  ): Promise<{ readonly unlinked: number; readonly deleted: number }> {
    const ofProduct = eq(weekTournamentEntries.productId, productId);
    const [unlinked, deleted] = await this.db.batch([
      this.db
        .update(weekTournamentEntries)
        .set({ launchId: null, productId: null, ownerUserId: null })
        .where(and(ofProduct, eq(weekTournamentEntries.status, 'drawn'))),
      this.db
        .delete(weekTournamentEntries)
        .where(and(ofProduct, ne(weekTournamentEntries.status, 'drawn'))),
    ]);
    return {
      unlinked: unlinked.meta.changes,
      deleted: deleted.meta.changes,
    };
  }

  // 決済で得た資格の出どころと日時は、組み合わせ決定の時点のUltrasの判定で書き換えない
  private classifyStatement(
    {
      entryId,
      status,
      closeReason,
      entitlementSource,
    }: WeekEntryClassification,
    at: Date,
  ) {
    return this.db
      .update(weekTournamentEntries)
      .set({
        status,
        closeReason,
        ...(entitlementSource === undefined
          ? {}
          : {
              entitlementSource: sql`coalesce(${weekTournamentEntries.entitlementSource}, ${entitlementSource})`,
              entitledAt: sql`coalesce(${weekTournamentEntries.entitledAt}, ${at.getTime()})`,
            }),
        ...(status === 'entitled' ? {} : { closedAt: at }),
        ...(status === 'forfeited' || status === 'excluded'
          ? { refundStatus: REFUND_ON_CLOSE }
          : {}),
        updatedAt: at,
      })
      .where(
        and(
          eq(weekTournamentEntries.id, entryId),
          inArray(weekTournamentEntries.status, OPEN_ENTRY_STATUSES),
        ),
      );
  }

  // 凍結と同時の削除・退会が凍結後の資格を変えないよう、凍結前の条件を読み取りでなく更新の文に含める
  private async forfeit(
    target: SQL,
    reason: 'deleted' | 'withdrawn',
    at: Date,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .update(weekTournamentEntries)
      .set({
        status: 'forfeited',
        closeReason: reason,
        closedAt: at,
        refundStatus: REFUND_ON_CLOSE,
        updatedAt: at,
      })
      .where(
        and(
          target,
          inArray(weekTournamentEntries.status, OPEN_ENTRY_STATUSES),
          inArray(
            weekTournamentEntries.tournamentId,
            this.unfrozenTournamentIds(),
          ),
        ),
      )
      .returning({ entryId: weekTournamentEntries.id });
    return rows.map(({ entryId }) => entryId).toSorted();
  }

  private unfrozenTournamentIds(condition?: SQL) {
    return this.db
      .select({ id: weekTournaments.id })
      .from(weekTournaments)
      .where(and(isNull(weekTournaments.drawStartedAt), condition));
  }

  private async selectTournaments(
    condition: SQL | undefined,
    order: readonly SQL[] = [],
    limit?: number,
  ): Promise<WeekTournamentRecord[]> {
    const query = this.db
      .select(TOURNAMENT_COLUMNS)
      .from(weekTournaments)
      .where(condition)
      .orderBy(...order);
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(tournamentRecordOf);
  }
}

import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { bracketMatches } from '../../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../db/schema/tournament/tournament-brackets.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import { isWinningResult, matchWindow } from '../../core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
  MatchScheduleInput,
  MatchScheduler,
  ScheduledEntryInput,
} from '../../core/match/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type { PlannedNode } from '../../core/tournament/bracket-progress-rules.ts';
import { roundStage } from '../../core/tournament/bracket-shape.ts';
import type {
  AdvanceResult,
  BracketMatchRecord,
  BracketProgression,
  BracketRecord,
  BracketStore,
} from '../../core/tournament/ports.ts';
import {
  nextBusinessDate,
  type RoundSchedulePolicy,
} from '../../core/tournament/round-schedule.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  type Elimination,
  planNext,
  type SchedulePlan,
} from './bracket-progress-plan.ts';

// 参加者・マッチの位置の書き込みと予定の作成を、マッチ50件ずつの一括にそろえる
const MATCHES_PER_BATCH = 50;

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

const ROUND_LATE_MESSAGE =
  'ラウンドの予定を実施日の0:00までに作れなかったため、実施日を遅らせました';

const UNSAFE_VALUE = 'unknown';

interface DecidedMatch {
  readonly node: BracketMatchRecord;
  readonly winnerNo: number | null;
  readonly decidedAt: Date;
}

interface RoundTarget {
  readonly round: number;
  readonly nodes: readonly PlannedNode[];
  readonly matchDate: BusinessDate;
}

interface PositionRow {
  readonly matchId: string;
  readonly round: number;
  readonly position: number;
  readonly matchDate: BusinessDate;
  readonly participantNos: BracketMatchRecord['participantNos'];
}

type StoredMatchRow = typeof bracketMatches.$inferSelect;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function batchOf(
  statements: readonly BatchItem<'sqlite'>[],
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] | undefined {
  const [first, ...rest] = statements;
  return first === undefined ? undefined : [first, ...rest];
}

// マッチの側は記録した参加者の番号の順で作るため、側の番号の順が記録の参加者の順に当たる
function winnerNoOf(
  node: BracketMatchRecord,
  match: MatchRecord,
): number | null {
  const winner = match.entries.find(
    (entry) => entry.result !== null && isWinningResult(entry.result),
  );
  return winner === undefined
    ? null
    : (node.participantNos[winner.slot - 1] ?? null);
}

function lastRoundOf(record: BracketRecord): number {
  return Math.max(0, ...record.matches.map(({ round }) => round));
}

function matchesOfRound(
  record: BracketRecord,
  round: number,
): readonly BracketMatchRecord[] {
  return record.matches.filter((match) => match.round === round);
}

// 位置が1つも残らず飛ばしたラウンドと、作り直す途中のラウンドは前ラウンドに数えない
function previousRoundOf(record: BracketRecord, round: number): number {
  return Math.max(
    0,
    ...record.matches
      .filter((match) => match.round < round && match.status !== 'planned')
      .map((match) => match.round),
  );
}

function latestDateOf(
  matches: readonly { readonly matchDate: BusinessDate }[],
): BusinessDate | undefined {
  let latest: BusinessDate | undefined;
  for (const { matchDate } of matches) {
    if (latest === undefined || matchDate > latest) {
      latest = matchDate;
    }
  }
  return latest;
}

// 遅れの無い実施日は前ラウンドの翌日で、前ラウンドが無ければ記録した1回戦の日
function expectedDateOf(
  record: BracketRecord,
  round: number,
): BusinessDate | undefined {
  const previous = latestDateOf(
    matchesOfRound(record, previousRoundOf(record, round)),
  );
  if (previous !== undefined) {
    return nextBusinessDate(previous);
  }
  return record.firstRoundDate ?? undefined;
}

function isLate(record: BracketRecord, round: number): boolean {
  const date = latestDateOf(matchesOfRound(record, round));
  const expected = expectedDateOf(record, round);
  return date !== undefined && expected !== undefined && date > expected;
}

function idsOf(matches: readonly { readonly matchId: string }[]): string[] {
  return matches.map(({ matchId }) => matchId);
}

// 最後のラウンドにまだ確定が無ければ、そのラウンドを予定した直後と同じ結果を返し、何度呼んでも同じ結果にする
function progressResult(record: BracketRecord): AdvanceResult {
  const round = lastRoundOf(record);
  const current = matchesOfRound(record, round);
  const decided = current.filter(({ status }) => status === 'decided');
  if (round === 0 || decided.length > 0) {
    return {
      kind: 'waiting',
      bracketId: record.bracketId,
      decidedMatchIds: idsOf(decided),
      previewMatchIds: [],
    };
  }
  return {
    kind: 'scheduled',
    bracketId: record.bracketId,
    round,
    late: isLate(record, round),
    decidedMatchIds: idsOf(
      matchesOfRound(record, previousRoundOf(record, round)),
    ),
    previewMatchIds: idsOf(
      current.filter(({ participantNos }) => participantNos.length === 2),
    ),
  };
}

function finishedResult(
  record: BracketRecord,
  championRef: string | null,
  newlyFinished: boolean,
): AdvanceResult {
  return {
    kind: 'finished',
    bracketId: record.bracketId,
    championRef,
    newlyFinished,
    decidedMatchIds: idsOf(
      matchesOfRound(record, lastRoundOf(record)).filter(
        ({ status }) => status === 'decided',
      ),
    ),
  };
}

function refOf(record: BracketRecord, participantNo: number | null): string {
  const participant = record.participants.find(
    (item) => item.participantNo === participantNo,
  );
  if (participant === undefined) {
    throw new RangeError(
      `ブラケット${record.bracketId}に抽選番号${String(participantNo)}の参加者がいません`,
    );
  }
  return participant.ref;
}

function positionRowOf(row: StoredMatchRow): PositionRow {
  return {
    matchId: row.matchId,
    round: row.round,
    position: row.position,
    matchDate: parseBusinessDate(row.matchDate),
    participantNos:
      row.participant2No === null
        ? [row.participant1No]
        : [row.participant1No, row.participant2No],
  };
}

function isSamePosition(a: PositionRow, b: PositionRow): boolean {
  return (
    a.matchDate === b.matchDate &&
    a.participantNos.length === b.participantNos.length &&
    a.participantNos.every((no, index) => b.participantNos[index] === no)
  );
}

// タグは除去処理の対象外のため、識別子の形の値だけを送る
function reportRoundLate(
  logger: Logger,
  bracketId: string,
  matchIds: readonly string[],
): void {
  logger.warn(ROUND_LATE_MESSAGE, { bracketId, matchIds });
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
  captureEvent({
    level: 'warning',
    logentry: { message: ROUND_LATE_MESSAGE },
    fingerprint: ['tournament', 'round-late'],
    tags: {
      tournament_incident: 'round-late',
      bracket_id: isUppercaseUlid(bracketId) ? bracketId : UNSAFE_VALUE,
    },
  });
}

export class D1BracketProgression implements BracketProgression {
  private readonly logger: Logger;

  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly store: BracketStore,
    private readonly directory: MatchDirectory,
    private readonly scheduler: MatchScheduler,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'tournament', 'progression']);
  }

  async advance(
    bracketId: string,
    policy: RoundSchedulePolicy,
    now: Date,
  ): Promise<AdvanceResult> {
    const loaded = await this.read(bracketId);
    if (loaded.status === 'finished') {
      return finishedResult(loaded, loaded.championRef, false);
    }
    const copied = await this.copyResults(loaded, now);
    const record = copied ? await this.read(bracketId) : loaded;
    const plan = planNext(record);
    switch (plan.kind) {
      case 'wait':
        return progressResult(record);
      case 'schedule':
        await this.eliminate(record, plan.dropped, now);
        await this.scheduleRound(record, plan, policy, now);
        return progressResult(await this.read(bracketId));
      case 'finish':
        await this.eliminate(record, plan.dropped, now);
        await this.reconcilePlanned(record, undefined, now);
        return this.finish(record, plan.championNo, now);
    }
  }

  private async read(bracketId: string): Promise<BracketRecord> {
    const record = await this.store.findById(bracketId);
    if (record === undefined) {
      throw new Error(`ブラケットが見つかりません: ${bracketId}`);
    }
    return record;
  }

  // 予定済みのマッチのうち確定したものの勝者と敗者の敗退を、未確定の記録だけを条件に写す。写したものがあれば真を返す
  private async copyResults(
    record: BracketRecord,
    now: Date,
  ): Promise<boolean> {
    const pending = record.matches.filter(
      ({ status }) => status === 'scheduled',
    );
    if (pending.length === 0) {
      return false;
    }
    const found = await this.directory.findMatches(idsOf(pending), now);
    const decided = pending.flatMap((node): DecidedMatch[] => {
      const match = found.get(node.matchId);
      if (match === undefined || match.decidedAt === null) {
        return [];
      }
      return [
        {
          node,
          winnerNo: winnerNoOf(node, match),
          decidedAt: match.decidedAt,
        },
      ];
    });
    for (const part of chunk(decided, MATCHES_PER_BATCH)) {
      const statements = batchOf(
        part.flatMap((result) => this.resultStatements(record, result, now)),
      );
      if (statements !== undefined) {
        await this.db.batch(statements);
      }
    }
    return decided.length > 0;
  }

  private resultStatements(
    record: BracketRecord,
    { node, winnerNo, decidedAt }: DecidedMatch,
    now: Date,
  ): BatchItem<'sqlite'>[] {
    const losers = node.participantNos.filter((no) => no !== winnerNo);
    const decide = this.db
      .update(bracketMatches)
      .set({
        status: 'decided',
        winnerParticipantNo: winnerNo,
        decidedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(bracketMatches.matchId, node.matchId),
          eq(bracketMatches.status, 'scheduled'),
        ),
      );
    if (losers.length === 0) {
      return [decide];
    }
    return [decide, this.eliminationStatement(record, losers, node.round, now)];
  }

  private eliminationStatement(
    record: BracketRecord,
    participantNos: readonly number[],
    round: number,
    now: Date,
  ): BatchItem<'sqlite'> {
    return this.db
      .update(bracketParticipants)
      .set({ eliminatedRound: round, updatedAt: now })
      .where(
        and(
          eq(bracketParticipants.bracketId, record.bracketId),
          inArray(bracketParticipants.participantNo, [...participantNos]),
          isNull(bracketParticipants.eliminatedRound),
        ),
      );
  }

  // 紐付けを解除したため側から除いた参加者は、側になるはずだったラウンドで敗退したものとする
  private async eliminate(
    record: BracketRecord,
    dropped: readonly Elimination[],
    now: Date,
  ): Promise<void> {
    const rounds = [...new Set(dropped.map(({ round }) => round))];
    const statements = rounds.flatMap((round) =>
      chunk(
        dropped
          .filter((item) => item.round === round)
          .map(({ participantNo }) => participantNo),
        IDS_PER_STATEMENT,
      ).map((part) => this.eliminationStatement(record, part, round, now)),
    );
    for (const part of chunk(statements, MATCHES_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
  }

  // 同時に終えても終了を確定した呼び出しを1つにするため、進行中の記録だけを条件に書き込む
  private async finish(
    record: BracketRecord,
    championNo: number | null,
    now: Date,
  ): Promise<AdvanceResult> {
    const finished = await this.db
      .update(tournamentBrackets)
      .set({
        status: 'finished',
        outcome: championNo === null ? 'no_award' : 'champion',
        championParticipantNo: championNo,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tournamentBrackets.id, record.bracketId),
          eq(tournamentBrackets.status, 'active'),
        ),
      )
      .returning({ id: tournamentBrackets.id });
    if (finished.length === 0) {
      const stored = await this.read(record.bracketId);
      return finishedResult(stored, stored.championRef, false);
    }
    return finishedResult(
      record,
      championNo === null ? null : refOf(record, championNo),
      true,
    );
  }

  // 同時に進めても先に挿入した位置のマッチIDにそろうよう、位置は一意索引で重複を無視して挿入し、読み直した位置で予定を作る
  private async scheduleRound(
    record: BracketRecord,
    plan: SchedulePlan,
    policy: RoundSchedulePolicy,
    now: Date,
  ): Promise<void> {
    const matchDate = this.roundDate(record, plan.round, policy, now);
    for (const part of chunk(plan.nodes, MATCHES_PER_BATCH)) {
      const statements = batchOf(
        part.map((node) => this.positionInsert(record, node, matchDate, now)),
      );
      if (statements !== undefined) {
        await this.db.batch(statements);
      }
    }
    const pending = await this.reconcilePlanned(
      record,
      { round: plan.round, nodes: plan.nodes, matchDate },
      now,
    );
    const created = new Set<string>();
    for (const part of chunk(pending, MATCHES_PER_BATCH)) {
      const result = await this.scheduler.schedule(
        part.map((row) => this.scheduleInputOf(record, row)),
        now,
      );
      await this.alignSkipped(result.skipped, now);
      await this.markScheduled(idsOf(part), now);
      for (const matchId of result.created) {
        created.add(matchId);
      }
    }
    const expected = expectedDateOf(record, plan.round);
    const late = pending.filter(
      (row) =>
        created.has(row.matchId) &&
        expected !== undefined &&
        row.matchDate > expected,
    );
    if (late.length > 0) {
      reportRoundLate(this.logger, record.bracketId, idsOf(late));
    }
  }

  private roundDate(
    record: BracketRecord,
    round: number,
    policy: RoundSchedulePolicy,
    now: Date,
  ): BusinessDate {
    const previous = latestDateOf(
      matchesOfRound(record, previousRoundOf(record, round)),
    );
    return previous === undefined
      ? policy.firstRoundDate
      : policy.nextRoundDate(previous, now);
  }

  private positionInsert(
    record: BracketRecord,
    node: PlannedNode,
    matchDate: BusinessDate,
    now: Date,
  ): BatchItem<'sqlite'> {
    const [participant1No, participant2No = null] = node.participants;
    return this.db
      .insert(bracketMatches)
      .values({
        matchId: this.ids.generate(),
        bracketId: record.bracketId,
        round: node.round,
        position: node.position,
        matchDate,
        participant1No,
        participant2No,
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  // 予定を作る前の位置を今回の決定にそろえ、予定を作る位置を返す。中断の前に予定を作り終えていた位置は、そのマッチの実施日のまま予定済みにする。決定に無い位置は消す
  private async reconcilePlanned(
    record: BracketRecord,
    target: RoundTarget | undefined,
    now: Date,
  ): Promise<PositionRow[]> {
    const planned = (
      await this.db
        .select()
        .from(bracketMatches)
        .where(
          and(
            eq(bracketMatches.bracketId, record.bracketId),
            eq(bracketMatches.status, 'planned'),
          ),
        )
        .orderBy(asc(bracketMatches.round), asc(bracketMatches.position))
    ).map(positionRowOf);
    if (planned.length === 0) {
      return [];
    }
    const existing = await this.directory.findMatches(idsOf(planned), now);
    const nodes = new Map(
      (target?.nodes ?? []).map((node) => [node.position, node]),
    );
    const statements: BatchItem<'sqlite'>[] = [];
    const pending: PositionRow[] = [];
    for (const row of planned) {
      const match = existing.get(row.matchId);
      const node =
        row.round === target?.round ? nodes.get(row.position) : undefined;
      if (match !== undefined) {
        statements.push(this.adoptStatement(row, match.matchDate, now));
      } else if (node === undefined || target === undefined) {
        statements.push(this.discardStatement(row));
      } else {
        const aligned = {
          ...row,
          matchDate: target.matchDate,
          participantNos: node.participants,
        };
        if (!isSamePosition(row, aligned)) {
          statements.push(this.realignStatement(aligned, now));
        }
        pending.push(aligned);
      }
    }
    for (const part of chunk(statements, MATCHES_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
    return pending;
  }

  // 別の呼び出しが先に作ったマッチは、そのマッチの実施日に記録をそろえる
  private async alignSkipped(
    matchIds: readonly string[],
    now: Date,
  ): Promise<void> {
    if (matchIds.length === 0) {
      return;
    }
    const found = await this.directory.findMatches(matchIds, now);
    const statements = [...found.values()].map(({ matchId, matchDate }) =>
      this.db
        .update(bracketMatches)
        .set({ matchDate, updatedAt: now })
        .where(eq(bracketMatches.matchId, matchId)),
    );
    for (const part of chunk(statements, MATCHES_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
  }

  private adoptStatement(
    row: PositionRow,
    matchDate: BusinessDate,
    now: Date,
  ): BatchItem<'sqlite'> {
    return this.db
      .update(bracketMatches)
      .set({ status: 'scheduled', matchDate, updatedAt: now })
      .where(this.plannedRowOf(row));
  }

  private discardStatement(row: PositionRow): BatchItem<'sqlite'> {
    return this.db.delete(bracketMatches).where(this.plannedRowOf(row));
  }

  private realignStatement(row: PositionRow, now: Date): BatchItem<'sqlite'> {
    const [participant1No, participant2No = null] = row.participantNos;
    return this.db
      .update(bracketMatches)
      .set({
        matchDate: row.matchDate,
        participant1No,
        participant2No,
        updatedAt: now,
      })
      .where(this.plannedRowOf(row));
  }

  private plannedRowOf(row: PositionRow) {
    return and(
      eq(bracketMatches.matchId, row.matchId),
      eq(bracketMatches.status, 'planned'),
    );
  }

  private scheduleInputOf(
    record: BracketRecord,
    row: PositionRow,
  ): MatchScheduleInput {
    const window = matchWindow(row.matchDate);
    const [first, second] = row.participantNos.map((no) =>
      this.entryOf(record, no),
    );
    if (first === undefined) {
      throw new RangeError(`マッチ${row.matchId}に参加者がいません`);
    }
    return {
      matchId: row.matchId,
      kind: record.kind,
      round: row.round,
      stage: roundStage(record.shape, row.round),
      matchDate: row.matchDate,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      entries: second === undefined ? [first] : [first, second],
    };
  }

  // 側は紐付けのある参加者だけにそろえてあるため、紐付けが無いのは記録の不整合である
  private entryOf(
    record: BracketRecord,
    participantNo: number,
  ): ScheduledEntryInput {
    const participant = record.participants.find(
      (item) => item.participantNo === participantNo,
    );
    if (
      participant === undefined ||
      participant.launchId === null ||
      participant.productId === null ||
      participant.ownerUserId === null
    ) {
      throw new RangeError(
        `ブラケット${record.bracketId}の抽選番号${String(participantNo)}の参加者は予定の側にできません`,
      );
    }
    return {
      launchId: participant.launchId,
      productId: participant.productId,
      ownerUserId: participant.ownerUserId,
    };
  }

  private async markScheduled(
    matchIds: readonly string[],
    now: Date,
  ): Promise<void> {
    for (const part of chunk(matchIds, IDS_PER_STATEMENT)) {
      await this.db
        .update(bracketMatches)
        .set({ status: 'scheduled', updatedAt: now })
        .where(
          and(
            inArray(bracketMatches.matchId, part),
            eq(bracketMatches.status, 'planned'),
          ),
        );
    }
  }
}

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { bracketMatches } from '../../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
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
import {
  type BracketState,
  decideNext,
  type PlannedNode,
  type RecordedNode,
} from '../../core/tournament/bracket-progress-rules.ts';
import { roundStage } from '../../core/tournament/bracket-shape.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type {
  AdvanceResult,
  BracketMatchRecord,
  BracketParticipantRecord,
  BracketProgression,
  BracketRecord,
  BracketStore,
} from '../../core/tournament/ports.ts';
import {
  nextBusinessDate,
  type RoundSchedulePolicy,
} from '../../core/tournament/round-schedule.ts';

// 参加者・マッチの位置の書き込みと予定の作成を、マッチ50件ずつの一括にそろえる
const MATCHES_PER_BATCH = 50;

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

interface DecidedMatch {
  readonly node: BracketMatchRecord;
  readonly winnerNo: number | null;
  readonly decidedAt: Date;
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

// マッチの側は番号の昇順の参加者で作るため、側の番号の順が参加者の番号の順に当たる
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

function outcomeOf(match: BracketMatchRecord): RecordedNode['outcome'] {
  if (match.status !== 'decided') {
    return null;
  }
  return match.winnerNo === null
    ? { kind: 'none' }
    : { kind: 'winner', participantNo: match.winnerNo };
}

// 位置の挿入の後で予定を作る前に中断したラウンドは、前ラウンドの結果から作り直して補う
function stateOf(record: BracketRecord): BracketState {
  const plannedRounds = record.matches
    .filter(({ status }) => status === 'planned')
    .map(({ round }) => round);
  const rebuildFrom = Math.min(...plannedRounds);
  return {
    shape: record.shape,
    nodes: record.matches
      .filter(({ round }) => round < rebuildFrom)
      .map((match) => ({
        round: match.round,
        position: match.position,
        participants: match.participantNos,
        outcome: outcomeOf(match),
      })),
  };
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

function latestDateOf(
  matches: readonly BracketMatchRecord[],
): BusinessDate | undefined {
  let latest: BusinessDate | undefined;
  for (const { matchDate } of matches) {
    if (latest === undefined || matchDate > latest) {
      latest = matchDate;
    }
  }
  return latest;
}

function isLate(record: BracketRecord, round: number): boolean {
  const date = latestDateOf(matchesOfRound(record, round));
  if (date === undefined) {
    return false;
  }
  if (round === 1) {
    return record.firstRoundDate !== null && date > record.firstRoundDate;
  }
  const previous = latestDateOf(matchesOfRound(record, round - 1));
  return previous !== undefined && date > nextBusinessDate(previous);
}

function idsOf(matches: readonly BracketMatchRecord[]): string[] {
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
    decidedMatchIds: idsOf(matchesOfRound(record, round - 1)),
    previewMatchIds: idsOf(
      current.filter(({ participantNos }) => participantNos.length === 2),
    ),
  };
}

function finishedResult(record: BracketRecord): AdvanceResult {
  return {
    kind: 'finished',
    bracketId: record.bracketId,
    championRef: record.championRef,
    newlyFinished: false,
    decidedMatchIds: idsOf(
      matchesOfRound(record, lastRoundOf(record)).filter(
        ({ status }) => status === 'decided',
      ),
    ),
  };
}

function ascendingParticipants(
  node: PlannedNode,
): BracketMatchRecord['participantNos'] {
  const [first, second] = node.participants;
  if (second === undefined) {
    return [first];
  }
  return first < second ? [first, second] : [second, first];
}

function participantNosOf(
  row: StoredMatchRow,
): BracketMatchRecord['participantNos'] {
  return row.participant2No === null
    ? [row.participant1No]
    : [row.participant1No, row.participant2No];
}

@injectable()
export class D1BracketProgression implements BracketProgression {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly store: BracketStore,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly directory: MatchDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchScheduler)
    private readonly scheduler: MatchScheduler,
  ) {}

  async advance(
    bracketId: string,
    policy: RoundSchedulePolicy,
    now: Date,
  ): Promise<AdvanceResult> {
    const loaded = await this.read(bracketId);
    if (loaded.status === 'finished') {
      return finishedResult(loaded);
    }
    const copied = await this.copyResults(loaded, now);
    const record = copied ? await this.read(bracketId) : loaded;
    const decision = decideNext(stateOf(record));
    switch (decision.kind) {
      case 'wait':
        return progressResult(record);
      case 'schedule':
        await this.scheduleRound(record, decision, policy, now);
        return progressResult(await this.read(bracketId));
      case 'finish':
        throw new Error(
          `ブラケット${bracketId}の終了の確定には対応していません`,
        );
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
    return [
      decide,
      this.db
        .update(bracketParticipants)
        .set({ eliminatedRound: node.round, updatedAt: now })
        .where(
          and(
            eq(bracketParticipants.bracketId, record.bracketId),
            inArray(bracketParticipants.participantNo, losers),
            isNull(bracketParticipants.eliminatedRound),
          ),
        ),
    ];
  }

  // 同時に進めても先に挿入した位置のマッチIDにそろうよう、位置は一意索引で重複を無視して挿入し、読み直した位置で予定を作る
  private async scheduleRound(
    record: BracketRecord,
    decision: {
      readonly round: number;
      readonly nodes: readonly PlannedNode[];
    },
    policy: RoundSchedulePolicy,
    now: Date,
  ): Promise<void> {
    const matchDate = this.roundDate(record, decision.round, policy, now);
    for (const part of chunk(decision.nodes, MATCHES_PER_BATCH)) {
      const statements = batchOf(
        part.map((node) => this.positionInsert(record, node, matchDate, now)),
      );
      if (statements !== undefined) {
        await this.db.batch(statements);
      }
    }
    const stored = await this.db
      .select()
      .from(bracketMatches)
      .where(
        and(
          eq(bracketMatches.bracketId, record.bracketId),
          eq(bracketMatches.round, decision.round),
          eq(bracketMatches.status, 'planned'),
        ),
      )
      .orderBy(asc(bracketMatches.position));
    for (const part of chunk(stored, MATCHES_PER_BATCH)) {
      await this.scheduler.schedule(
        part.map((row) => this.scheduleInputOf(record, row)),
        now,
      );
      await this.markScheduled(
        part.map(({ matchId }) => matchId),
        now,
      );
    }
  }

  private roundDate(
    record: BracketRecord,
    round: number,
    policy: RoundSchedulePolicy,
    now: Date,
  ): BusinessDate {
    const previous = latestDateOf(matchesOfRound(record, round - 1));
    return previous === undefined
      ? policy.firstRoundDate
      : policy.nextRoundDate(previous, now);
  }

  // マッチの側の順と照合できるよう、参加者の番号は昇順で記録する
  private positionInsert(
    record: BracketRecord,
    node: PlannedNode,
    matchDate: BusinessDate,
    now: Date,
  ): BatchItem<'sqlite'> {
    const [participant1No, participant2No = null] = ascendingParticipants(node);
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

  private scheduleInputOf(
    record: BracketRecord,
    row: StoredMatchRow,
  ): MatchScheduleInput {
    const matchDate = parseBusinessDate(row.matchDate);
    const window = matchWindow(matchDate);
    const [first, second] = participantNosOf(row).map((no) =>
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
      matchDate,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      entries: second === undefined ? [first] : [first, second],
    };
  }

  private entryOf(
    record: BracketRecord,
    participantNo: number,
  ): ScheduledEntryInput {
    const participant: BracketParticipantRecord | undefined =
      record.participants.find((item) => item.participantNo === participantNo);
    if (
      participant === undefined ||
      participant.launchId === null ||
      participant.productId === null ||
      participant.ownerUserId === null
    ) {
      throw new Error(
        `ブラケット${record.bracketId}の抽選番号${String(participantNo)}の参加者は紐付けが無いため予定の側にできません`,
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

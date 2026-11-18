import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { chunk } from '../../core/d1/statement-chunks.ts';
import type { Database } from '../../../db/client.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../db/schema/tournament/tournament-brackets.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  type BracketDrawResult,
  drawBracket,
} from '../../core/tournament/bracket-draw-rules.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type {
  AdvanceResult,
  BracketDraw,
  BracketDrawInput,
  BracketKind,
  BracketParticipantInput,
  BracketProgression,
} from '../../core/tournament/ports.ts';

// 参加者の書き込みを、進行の位置の書き込みと同じ50件ずつの一括にそろえる
const PARTICIPANTS_PER_BATCH = 50;

function batchOf(
  statements: readonly BatchItem<'sqlite'>[],
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] | undefined {
  const [first, ...rest] = statements;
  return first === undefined ? undefined : [first, ...rest];
}

@injectable()
export class D1BracketDraw implements BracketDraw {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketProgression)
    private readonly progression: BracketProgression,
  ) {}

  // 同時の実行や中断の後の再実行でも記録が1つにそろうよう、ブラケットと参加者は一意索引で重複を無視して挿入し、予定の作成は進行に任せる
  async create<T>(input: BracketDrawInput<T>): Promise<AdvanceResult> {
    const drawn = drawBracket(input.candidates, input.order);
    const bracketId = await this.ensureBracket(input, drawn);
    await this.insertParticipants(bracketId, input, drawn);
    return this.progression.advance(bracketId, input.policy, input.now);
  }

  private async ensureBracket<T>(
    input: BracketDrawInput<T>,
    { shape }: BracketDrawResult,
  ): Promise<string> {
    await this.db
      .insert(tournamentBrackets)
      .values({
        kind: input.kind,
        tournamentId: input.tournamentId,
        participantCount: shape.participantCount,
        seedCount: shape.seedCount,
        secondRoundSize: shape.secondRoundSize,
        roundCount: shape.roundCount,
        // 参加1以下はマッチを作らないため1回戦の日を持たない
        firstRoundDate:
          shape.roundCount === 0 ? null : input.policy.firstRoundDate,
        status: 'active',
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing();
    return this.bracketIdOf(input.kind, input.tournamentId);
  }

  private async bracketIdOf(
    kind: BracketKind,
    tournamentId: string,
  ): Promise<string> {
    const [bracket] = await this.db
      .select({ id: tournamentBrackets.id })
      .from(tournamentBrackets)
      .where(
        and(
          eq(tournamentBrackets.kind, kind),
          eq(tournamentBrackets.tournamentId, tournamentId),
        ),
      );
    if (bracket === undefined) {
      throw new Error(
        `ブラケットを記録できませんでした: ${kind} ${tournamentId}`,
      );
    }
    return bracket.id;
  }

  private async insertParticipants<T>(
    bracketId: string,
    input: BracketDrawInput<T>,
    { participants }: BracketDrawResult,
  ): Promise<void> {
    const inputs = new Map<string, BracketParticipantInput>(
      input.candidates.map(({ ref, participant }) => [ref, participant]),
    );
    const statements = participants.map(({ ref, participantNo }) => {
      const participant = inputs.get(ref);
      if (participant === undefined) {
        throw new RangeError(`候補にrefがありません: ${ref}`);
      }
      return this.db
        .insert(bracketParticipants)
        .values({
          bracketId,
          participantNo,
          entryRef: ref,
          launchId: participant.launchId,
          productId: participant.productId,
          ownerUserId: participant.ownerUserId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing();
    });
    for (const part of chunk(statements, PARTICIPANTS_PER_BATCH)) {
      const batch = batchOf(part);
      if (batch !== undefined) {
        await this.db.batch(batch);
      }
    }
  }
}

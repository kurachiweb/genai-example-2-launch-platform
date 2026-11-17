import { and, asc, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { bracketMatches } from '../../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../db/schema/tournament/tournament-brackets.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { bracketShape } from '../../core/tournament/bracket-shape.ts';
import type {
  BracketKind,
  BracketMatchRecord,
  BracketOfMatch,
  BracketParticipantStanding,
  BracketRecord,
  BracketStore,
} from '../../core/tournament/ports.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function participantNosOf(
  participant1No: number,
  participant2No: number | null,
): BracketMatchRecord['participantNos'] {
  return participant2No === null
    ? [participant1No]
    : [participant1No, participant2No];
}

@injectable()
export class D1BracketStore implements BracketStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  findByTournament(
    kind: BracketKind,
    tournamentId: string,
  ): Promise<BracketRecord | undefined> {
    return this.readRecord(
      and(
        eq(tournamentBrackets.kind, kind),
        eq(tournamentBrackets.tournamentId, tournamentId),
      ),
    );
  }

  findById(bracketId: string): Promise<BracketRecord | undefined> {
    return this.readRecord(eq(tournamentBrackets.id, bracketId));
  }

  async findByMatchIds(
    matchIds: readonly string[],
  ): Promise<ReadonlyMap<string, BracketOfMatch>> {
    const pages = await Promise.all(
      chunk([...new Set(matchIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            matchId: bracketMatches.matchId,
            bracketId: tournamentBrackets.id,
            kind: tournamentBrackets.kind,
            tournamentId: tournamentBrackets.tournamentId,
          })
          .from(bracketMatches)
          .innerJoin(
            tournamentBrackets,
            eq(tournamentBrackets.id, bracketMatches.bracketId),
          )
          .where(inArray(bracketMatches.matchId, page)),
      ),
    );
    return new Map(
      pages
        .flat()
        .map(({ matchId, ...bracket }) => [matchId, bracket] as const),
    );
  }

  async findAliveRefs(
    kind: BracketKind,
    refs: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const pages = await Promise.all(
      chunk([...new Set(refs)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({ ref: bracketParticipants.entryRef })
          .from(bracketParticipants)
          .innerJoin(
            tournamentBrackets,
            eq(tournamentBrackets.id, bracketParticipants.bracketId),
          )
          .where(
            and(
              eq(tournamentBrackets.kind, kind),
              eq(tournamentBrackets.status, 'active'),
              isNull(bracketParticipants.eliminatedRound),
              or(
                isNull(tournamentBrackets.championParticipantNo),
                ne(
                  tournamentBrackets.championParticipantNo,
                  bracketParticipants.participantNo,
                ),
              ),
              inArray(bracketParticipants.entryRef, page),
            ),
          ),
      ),
    );
    return new Set(pages.flat().map(({ ref }) => ref));
  }

  async findParticipantStandings(
    kind: BracketKind,
    refs: readonly string[],
  ): Promise<ReadonlyMap<string, BracketParticipantStanding>> {
    const pages = await Promise.all(
      chunk([...new Set(refs)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            ref: bracketParticipants.entryRef,
            bracketId: tournamentBrackets.id,
            participantCount: tournamentBrackets.participantCount,
            status: tournamentBrackets.status,
            championParticipantNo: tournamentBrackets.championParticipantNo,
            participantNo: bracketParticipants.participantNo,
            eliminatedRound: bracketParticipants.eliminatedRound,
          })
          .from(bracketParticipants)
          .innerJoin(
            tournamentBrackets,
            eq(tournamentBrackets.id, bracketParticipants.bracketId),
          )
          .where(
            and(
              eq(tournamentBrackets.kind, kind),
              inArray(bracketParticipants.entryRef, page),
            ),
          ),
      ),
    );
    return new Map(
      pages.flat().map(
        ({ ref, participantCount, championParticipantNo, ...standing }) =>
          [
            ref,
            {
              bracketId: standing.bracketId,
              shape: bracketShape(participantCount),
              status: standing.status,
              participantNo: standing.participantNo,
              eliminatedRound: standing.eliminatedRound,
              champion: championParticipantNo === standing.participantNo,
            },
          ] as const,
      ),
    );
  }

  async unlinkProduct(productId: string): Promise<number> {
    const result = await this.db
      .update(bracketParticipants)
      .set({ productId: null, launchId: null, ownerUserId: null })
      .where(eq(bracketParticipants.productId, productId));
    return result.meta.changes;
  }

  // ブラケット・参加者・マッチを同じ時点の状態で読むため1回の一括で読む
  private async readRecord(
    bracketCondition: SQL | undefined,
  ): Promise<BracketRecord | undefined> {
    const [brackets, participants, matches] = await this.db.batch([
      this.db
        .select({
          bracketId: tournamentBrackets.id,
          kind: tournamentBrackets.kind,
          tournamentId: tournamentBrackets.tournamentId,
          participantCount: tournamentBrackets.participantCount,
          firstRoundDate: tournamentBrackets.firstRoundDate,
          status: tournamentBrackets.status,
          outcome: tournamentBrackets.outcome,
          championParticipantNo: tournamentBrackets.championParticipantNo,
        })
        .from(tournamentBrackets)
        .where(bracketCondition),
      this.db
        .select({
          participantNo: bracketParticipants.participantNo,
          ref: bracketParticipants.entryRef,
          productId: bracketParticipants.productId,
          launchId: bracketParticipants.launchId,
          ownerUserId: bracketParticipants.ownerUserId,
          eliminatedRound: bracketParticipants.eliminatedRound,
        })
        .from(bracketParticipants)
        .innerJoin(
          tournamentBrackets,
          eq(tournamentBrackets.id, bracketParticipants.bracketId),
        )
        .where(bracketCondition)
        .orderBy(asc(bracketParticipants.participantNo)),
      this.db
        .select({
          matchId: bracketMatches.matchId,
          round: bracketMatches.round,
          position: bracketMatches.position,
          matchDate: bracketMatches.matchDate,
          participant1No: bracketMatches.participant1No,
          participant2No: bracketMatches.participant2No,
          status: bracketMatches.status,
          winnerNo: bracketMatches.winnerParticipantNo,
        })
        .from(bracketMatches)
        .innerJoin(
          tournamentBrackets,
          eq(tournamentBrackets.id, bracketMatches.bracketId),
        )
        .where(bracketCondition)
        .orderBy(asc(bracketMatches.round), asc(bracketMatches.position)),
    ]);
    const [bracket] = brackets;
    if (bracket === undefined) {
      return undefined;
    }
    const champion = participants.find(
      ({ participantNo }) => participantNo === bracket.championParticipantNo,
    );
    return {
      bracketId: bracket.bracketId,
      kind: bracket.kind,
      tournamentId: bracket.tournamentId,
      shape: bracketShape(bracket.participantCount),
      firstRoundDate:
        bracket.firstRoundDate === null
          ? null
          : parseBusinessDate(bracket.firstRoundDate),
      status: bracket.status,
      outcome: bracket.outcome,
      championRef: champion?.ref ?? null,
      participants,
      matches: matches.map(
        ({ participant1No, participant2No, matchDate, ...match }) => ({
          ...match,
          matchDate: parseBusinessDate(matchDate),
          participantNos: participantNosOf(participant1No, participant2No),
        }),
      ),
    };
  }
}

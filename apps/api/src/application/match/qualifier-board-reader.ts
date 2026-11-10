import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { qualifierWindow } from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import {
  type BoardMatch,
  type ByeReason,
  orderBoard,
  placementOf,
} from '../../domain/match/board-order.ts';
import { MATCH_TYPES } from './match-types.ts';
import type { MatchView, MatchViewReader } from './match-view-reader.ts';
import type { PairingStore } from './ports.ts';

export interface QualifierBoardBye {
  readonly view: MatchView;
  // 不戦勝で勝ち上がる側
  readonly entryId: string;
  readonly reason: ByeReason;
}

export interface QualifierBoard {
  readonly date: BusinessDate;
  readonly serverTime: Date;
  readonly phase: 'live' | 'result';
  readonly fullTimeAt: Date;
  readonly nextKickoffAt: Date;
  // 当日のペアリングが未完了、または開始の日時を過ぎて開始も確定もしていない当日の予選がある
  readonly awaitingKickoff: boolean;
  // 対戦カードと即時の終了の不戦勝の数
  readonly heldCount: number;
  readonly cards: readonly MatchView[];
  readonly byes: readonly QualifierBoardBye[];
}

export interface QualifierBoardReader {
  read(input: {
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<QualifierBoard>;
}

const MILLISECONDS_PER_DAY = 86_400_000;

const logger = getAppLogger(['api', 'application', 'match']);

function boardMatchOf(record: MatchRecord): BoardMatch {
  return {
    matchId: record.matchId,
    totalUpvotes: record.entries.reduce(
      (total, entry) => total + entry.upvoteCount,
      0,
    ),
    decision: record.decision,
    endedEarly: record.endedEarly,
    entryCount: record.entries.length === 1 ? 1 : 2,
  };
}

// 不整合な1件でトップページ全体をエラーにしないため、置き場所を決められないマッチは除く
function placeableMatches(records: readonly MatchRecord[]): BoardMatch[] {
  return records.flatMap((record) => {
    const match = boardMatchOf(record);
    try {
      placementOf(match);
      return [match];
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      logger.warn('予選の一覧に置けないマッチを除きました', {
        matchId: record.matchId,
      });
      return [];
    }
  });
}

function byeEntryIdOf(record: MatchRecord): string | undefined {
  const winner =
    record.entries.find(
      (entry) => entry.result === 'bye' || entry.result === 'walkover',
    ) ?? (record.entries.length === 1 ? record.entries[0] : undefined);
  return winner?.entryId;
}

// 開始の日時の直後は0:00のジョブの完了を待って取り直すため、開始の前の状態が残っているかを示す
function hasPendingKickoff(
  records: readonly MatchRecord[],
  now: Date,
): boolean {
  return records.some(
    (record) =>
      record.startedAt === null &&
      record.decidedAt === null &&
      record.startsAt.getTime() <= now.getTime(),
  );
}

@injectable()
export class DirectoryQualifierBoardReader implements QualifierBoardReader {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(MATCH_TYPES.PairingStore)
    private readonly pairing: PairingStore,
    @inject(MATCH_TYPES.MatchViewReader)
    private readonly views: MatchViewReader,
  ) {}

  async read(input: {
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<QualifierBoard> {
    const { viewer, now } = input;
    const date = toBusinessDateTime(now).date;
    const window = qualifierWindow(date);
    const [records, pairingCompleted] = await Promise.all([
      this.matches.listForDate({ date, kinds: ['qualifier'], now }),
      this.pairing.isDayCompleted(date),
    ]);
    const started = records.filter((record) => record.startedAt !== null);
    const order = orderBoard(placeableMatches(started));
    const shown = new Set([
      ...order.cards,
      ...order.byes.map((bye) => bye.matchId),
    ]);
    const views = await this.views.assemble({
      records: started.filter((record) => shown.has(record.matchId)),
      viewer,
    });
    return {
      date,
      serverTime: now,
      phase: now.getTime() < window.endsAt.getTime() ? 'live' : 'result',
      fullTimeAt: window.endsAt,
      nextKickoffAt: new Date(window.startsAt.getTime() + MILLISECONDS_PER_DAY),
      awaitingKickoff: !pairingCompleted || hasPendingKickoff(records, now),
      heldCount: order.heldCount,
      cards: order.cards.flatMap((matchId) => {
        const view = views.get(matchId);
        return view === undefined ? [] : [view];
      }),
      byes: order.byes.flatMap(({ matchId, reason }) => {
        const view = views.get(matchId);
        const entryId =
          view === undefined ? undefined : byeEntryIdOf(view.record);
        return view === undefined || entryId === undefined
          ? []
          : [{ view, entryId, reason }];
      }),
    };
  }
}

import type { MatchKind } from '../match/match-model.ts';
import type { BusinessDate } from '../time/business-time.ts';
import type { DrawCandidate, DrawOrder } from './bracket-draw-rules.ts';
import type { BracketShape } from './bracket-shape.ts';
import type { RoundSchedulePolicy } from './round-schedule.ts';

export type BracketKind = Exclude<MatchKind, 'qualifier'>;

export interface BracketParticipantInput {
  readonly ref: string;
  readonly tieBreaker: string;
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
}

export interface BracketParticipantRecord {
  readonly participantNo: number;
  readonly ref: string;
  // 物理削除で紐付けを解除した参加者はnull
  readonly productId: string | null;
  readonly launchId: string | null;
  readonly ownerUserId: string | null;
  readonly eliminatedRound: number | null;
}

export interface BracketMatchRecord {
  readonly matchId: string;
  readonly round: number;
  readonly position: number;
  readonly matchDate: BusinessDate;
  readonly participantNos: readonly [number] | readonly [number, number];
  readonly status: 'planned' | 'scheduled' | 'decided';
  readonly winnerNo: number | null;
}

export interface BracketRecord {
  readonly bracketId: string;
  readonly kind: BracketKind;
  readonly tournamentId: string;
  readonly shape: BracketShape;
  readonly firstRoundDate: BusinessDate | null;
  readonly status: 'active' | 'finished';
  readonly outcome: 'champion' | 'no_award' | null;
  readonly championRef: string | null;
  // 参加者は番号の昇順、マッチはラウンドと位置の昇順
  readonly participants: readonly BracketParticipantRecord[];
  readonly matches: readonly BracketMatchRecord[];
}

export interface BracketOfMatch {
  readonly bracketId: string;
  readonly kind: BracketKind;
  readonly tournamentId: string;
}

export interface BracketStore {
  findByTournament(
    kind: BracketKind,
    tournamentId: string,
  ): Promise<BracketRecord | undefined>;
  findById(bracketId: string): Promise<BracketRecord | undefined>;
  // ブラケットのマッチでないIDは結果に含めない
  findByMatchIds(
    matchIds: readonly string[],
  ): Promise<ReadonlyMap<string, BracketOfMatch>>;
  // 進行中のブラケットで敗退しておらず優勝でもない参加者のrefだけを返す
  findAliveRefs(
    kind: BracketKind,
    refs: readonly string[],
  ): Promise<ReadonlySet<string>>;
  // 参加者のプロダクト・ローンチ・投稿者の紐付けを解除し、解除した参加者の数を返す
  unlinkProduct(productId: string): Promise<number>;
}

export type AdvanceResult =
  | {
      readonly kind: 'waiting';
      readonly bracketId: string;
      readonly decidedMatchIds: readonly string[];
      readonly previewMatchIds: readonly string[];
    }
  | {
      readonly kind: 'scheduled';
      readonly bracketId: string;
      readonly round: number;
      readonly late: boolean;
      readonly decidedMatchIds: readonly string[];
      readonly previewMatchIds: readonly string[];
    }
  | {
      readonly kind: 'finished';
      readonly bracketId: string;
      readonly championRef: string | null;
      readonly newlyFinished: boolean;
      readonly decidedMatchIds: readonly string[];
    };

export interface BracketDrawCandidate<T> extends DrawCandidate<T> {
  // refとtieBreakerはDrawCandidateと同じ値にする
  readonly participant: BracketParticipantInput;
}

export interface BracketDraw {
  // 既にあれば記録を再利用して進行だけ行う
  create<T>(input: {
    readonly kind: BracketKind;
    readonly tournamentId: string;
    readonly candidates: readonly BracketDrawCandidate<T>[];
    readonly order: DrawOrder<T>;
    readonly policy: RoundSchedulePolicy;
    readonly now: Date;
  }): Promise<AdvanceResult>;
}

export interface BracketProgression {
  // 何度呼んでも同じ結果になる
  advance(
    bracketId: string,
    policy: RoundSchedulePolicy,
    now: Date,
  ): Promise<AdvanceResult>;
}

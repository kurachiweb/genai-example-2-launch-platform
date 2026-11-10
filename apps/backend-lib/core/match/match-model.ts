import { PAIRING_TIME } from '../product/launch-status.ts';
import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
} from '../time/business-time.ts';

export const MATCH_KINDS = Object.freeze([
  'qualifier',
  'week',
  'year',
] as const);

export type MatchKind = (typeof MATCH_KINDS)[number];

export const MATCH_STAGES = Object.freeze([
  'quarterfinal',
  'semifinal',
  'final',
] as const);

export type MatchStage = (typeof MATCH_STAGES)[number];

export const ENTRY_RESULTS = Object.freeze([
  'won',
  'lost',
  'bye',
  'walkover',
] as const);

export type EntryResult = (typeof ENTRY_RESULTS)[number];

export const MATCH_DECISIONS = Object.freeze([
  'votes',
  'last_upvote',
  'no_votes',
  'bye',
  'walkover',
  'both_forfeited',
] as const);

export type MatchDecision = (typeof MATCH_DECISIONS)[number];

export const MATCH_PHASES = Object.freeze([
  'scheduled',
  'live',
  'tallying',
  'finished',
] as const);

export type MatchPhase = (typeof MATCH_PHASES)[number];

export interface MatchTimes {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly startedAt: Date | null;
  readonly decidedAt: Date | null;
}

export interface MatchWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface QualifierSchedule {
  readonly kickoff: BusinessTimeOfDay;
  readonly fullTime: BusinessTimeOfDay;
  readonly pairing: BusinessTimeOfDay;
}

export const QUALIFIER_SCHEDULE: QualifierSchedule = Object.freeze({
  kickoff: Object.freeze({ hour: 0, minute: 0 }),
  fullTime: Object.freeze({ hour: 23, minute: 40 }),
  pairing: PAIRING_TIME,
});

// 開始の日時を過ぎても開始の記録が無いマッチは、0:00のジョブが開始するまで予定のまま扱いUpvoteを受け付けない
export function deriveMatchPhase(match: MatchTimes, now: Date): MatchPhase {
  if (match.decidedAt !== null) {
    return 'finished';
  }
  if (match.startedAt === null) {
    return 'scheduled';
  }
  if (now.getTime() >= match.endsAt.getTime()) {
    return 'tallying';
  }
  return 'live';
}

export function qualifierWindow(date: BusinessDate): MatchWindow {
  return {
    startsAt: fromBusinessDateTime(date, QUALIFIER_SCHEDULE.kickoff),
    endsAt: fromBusinessDateTime(date, QUALIFIER_SCHEDULE.fullTime),
  };
}

export function isWinningResult(result: EntryResult): boolean {
  return result !== 'lost';
}

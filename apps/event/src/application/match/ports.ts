import type {
  MatchEventHandler,
  MatchEventRegistration,
} from '../../../lib/core/match/match-events.ts';

export interface MatchEventHandlerResolver {
  resolve(registration: MatchEventRegistration): MatchEventHandler;
}

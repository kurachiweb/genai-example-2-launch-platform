import { startTournamentCheckoutArgsOf } from '../tournament/inputs.ts';
import { LAUNCH_ID_INVALID_MESSAGE } from './errors.ts';

export const START_WEEK_TOURNAMENT_CHECKOUT_ARGS =
  startTournamentCheckoutArgsOf(LAUNCH_ID_INVALID_MESSAGE);

import type { UltrasActivationHandlerRegistration } from '../../lib/core/ultras/activation-contract.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';

// 加入が有効になった知らせを受け取る機能(tournament-week・tournament-year)が登録をここへ追記する。
// orderは100以上を各機能のspecが使い、本specは登録を持たない
export const ULTRAS_ACTIVATION_HANDLERS: readonly UltrasActivationHandlerRegistration[] =
  Object.freeze([
    {
      name: 'tournament-week.ultras-entry-exemption',
      order: 1500,
      handler: EVENT_WEEK_TOURNAMENT_TYPES.WeekUltrasEntryExemptionHandler,
    },
    {
      name: 'tournament-week.open-entry-checkout-expiry',
      order: 1510,
      handler: EVENT_WEEK_TOURNAMENT_TYPES.WeekOpenEntryCheckoutExpiryHandler,
    },
  ]);

import type { YEAR_TOURNAMENT_TYPES } from '../../../core/year-tournament/identifiers.ts';
import { D1YearAwardExport } from '../d1-year-award-export.ts';
import { D1YearEntryStore } from '../d1-year-entry-store.ts';
import { D1YearTournamentStore } from '../d1-year-tournament-store.ts';
import { YearTournamentCalendar } from '../year-calendar.ts';
import { YearTournamentDrawService } from '../year-draw-service.ts';
import { YearEntryRefundFollowUp } from '../year-entry-follow-up.ts';
import { YearEntryFulfillment } from '../year-entry-fulfillment.ts';
import { YearEntryOfferPolicy } from '../year-entry-offer-policy.ts';
import { ChampionYearEntryRegistrar } from '../year-entry-registrar.ts';
import { YearTournamentNotificationPublisher } from '../year-notification-publisher.ts';
import { YearTournamentProgressionService } from '../year-progression-service.ts';

type YearTournamentTypeName = keyof typeof YEAR_TOURNAMENT_TYPES;

// 3つの経路の解決の検査が同じ対応を確かめるよう、識別子の名前と束縛する実装の対応を1か所に置く
export const YEAR_TOURNAMENT_IMPLEMENTATIONS = [
  ['YearTournamentStore', D1YearTournamentStore],
  ['YearEntryStore', D1YearEntryStore],
  ['YearCalendar', YearTournamentCalendar],
  ['YearEntryRegistrar', ChampionYearEntryRegistrar],
  ['YearEntryOfferPolicy', YearEntryOfferPolicy],
  ['YearEntryFulfillment', YearEntryFulfillment],
  ['YearDrawService', YearTournamentDrawService],
  ['YearProgressionService', YearTournamentProgressionService],
  ['YearEntryFollowUp', YearEntryRefundFollowUp],
  ['YearNotificationPublisher', YearTournamentNotificationPublisher],
  ['YearAwardExport', D1YearAwardExport],
] as const satisfies readonly (readonly [YearTournamentTypeName, unknown])[];

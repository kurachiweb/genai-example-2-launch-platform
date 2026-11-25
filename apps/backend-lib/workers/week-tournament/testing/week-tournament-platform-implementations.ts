import type { WEEK_TOURNAMENT_TYPES } from '../../../core/week-tournament/identifiers.ts';
import { D1WeekAwardExport } from '../d1-week-award-export.ts';
import { D1WeekChampionDirectory } from '../d1-week-champion-directory.ts';
import { D1WeekTournamentStore } from '../d1-week-tournament-store.ts';
import { WeekTournamentDrawService } from '../week-draw-service.ts';
import { WeekEntryRefundFollowUp } from '../week-entry-follow-up.ts';
import { WeekEntryFulfillment } from '../week-entry-fulfillment.ts';
import { WeekEntryOfferPolicy } from '../week-entry-offer-policy.ts';
import { QualifierWeekEntryRegistrar } from '../week-entry-registrar.ts';
import { WeekTournamentNotificationPublisher } from '../week-notification-publisher.ts';
import { WeekTournamentProgressionService } from '../week-progression-service.ts';

type WeekTournamentTypeName = keyof typeof WEEK_TOURNAMENT_TYPES;

// 3つの経路の解決の検査が同じ対応を確かめるよう、識別子の名前と束縛する実装の対応を1か所に置く
export const WEEK_TOURNAMENT_IMPLEMENTATIONS = [
  ['WeekTournamentStore', D1WeekTournamentStore],
  ['WeekEntryRegistrar', QualifierWeekEntryRegistrar],
  ['WeekEntryOfferPolicy', WeekEntryOfferPolicy],
  ['WeekEntryFulfillment', WeekEntryFulfillment],
  ['WeekDrawService', WeekTournamentDrawService],
  ['WeekProgressionService', WeekTournamentProgressionService],
  ['WeekEntryFollowUp', WeekEntryRefundFollowUp],
  ['WeekNotificationPublisher', WeekTournamentNotificationPublisher],
  ['WeekChampionDirectory', D1WeekChampionDirectory],
  ['WeekAwardExport', D1WeekAwardExport],
] as const satisfies readonly (readonly [WeekTournamentTypeName, unknown])[];

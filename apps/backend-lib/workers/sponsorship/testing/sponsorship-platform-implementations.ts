import type { SPONSORSHIP_PLATFORM_TYPES } from '../../../core/sponsorship/identifiers.ts';
import { D1DisplayStopStore } from '../d1-display-stop-store.ts';
import { D1EligibleProductReader } from '../d1-eligible-product-reader.ts';
import { D1NoticeScheduler } from '../d1-notice-scheduler.ts';
import { D1PlacementReader } from '../d1-placement-reader.ts';
import { D1SponsorshipExport } from '../d1-sponsorship-export.ts';
import { D1SponsorshipStore } from '../d1-sponsorship-store.ts';
import { D1DisplayStopStatements } from '../display-stop-statements.ts';
import { QueueNoticeRequester } from '../queue-notice-requester.ts';
import { D1RefundSettlement } from '../refund-settlement.ts';
import { SponsorshipFulfillment } from '../sponsorship-fulfillment.ts';
import { SponsorshipOfferPolicy } from '../sponsorship-offer-policy.ts';

type SponsorshipTypeName = keyof typeof SPONSORSHIP_PLATFORM_TYPES;

// 3つの経路の解決の検査が同じ対応を確かめるよう、識別子の名前と束縛する実装の対応を1か所に置く
export const SPONSORSHIP_IMPLEMENTATIONS = [
  ['SponsorshipStore', D1SponsorshipStore],
  ['EligibleProductReader', D1EligibleProductReader],
  ['PlacementReader', D1PlacementReader],
  ['SponsorshipOfferPolicy', SponsorshipOfferPolicy],
  ['SponsorshipFulfillment', SponsorshipFulfillment],
  ['NoticeScheduler', D1NoticeScheduler],
  ['NoticeRequester', QueueNoticeRequester],
  ['DisplayStopStore', D1DisplayStopStore],
  ['DisplayStopStatements', D1DisplayStopStatements],
  ['RefundEstimator', D1RefundSettlement],
  ['RefundSettlement', D1RefundSettlement],
  ['SponsorshipExport', D1SponsorshipExport],
] as const satisfies readonly (readonly [SponsorshipTypeName, unknown])[];

import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { RandomSource } from '../../lib/core/match/qualifier-pairing.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMatchPlatformModule } from '../../lib/workers/match/match-platform-module.ts';
import { DirectoryEntryEligibilityChecker } from '../application/match/entry-eligibility.ts';
import {
  MatchEventCleanupJob,
  MatchEventRedispatchJob,
  MatchKickoffJob,
  MatchSettlementJob,
  QualifierPairingJob,
} from '../application/match/match-jobs.ts';
import {
  type MatchKickoff,
  StoreMatchKickoff,
} from '../application/match/match-kickoff.ts';
import {
  type MatchSettlement,
  StoreMatchSettlement,
} from '../application/match/match-settlement.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import {
  DirectoryMatchViewReader,
  type MatchViewReader,
} from '../application/match/match-view-reader.ts';
import type {
  EntryEligibilityChecker,
  KickoffStore,
  MatchBoardStore,
  MatchIncidentReporter,
  PairingStore,
  SettlementStore,
  UpvoteStore,
} from '../application/match/ports.ts';
import {
  DirectoryQualifierBoardReader,
  type QualifierBoardReader,
} from '../application/match/qualifier-board-reader.ts';
import {
  type QualifierPairingService,
  StoreQualifierPairingService,
} from '../application/match/qualifier-pairing-service.ts';
import {
  StoreUpvoteService,
  type UpvoteService,
} from '../application/match/upvote-service.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { AccountMatchClosureSyncHandler } from '../infrastructure/match/account-match-closure-sync-handler.ts';
import { CryptoRandomSource } from '../infrastructure/match/crypto-random-source.ts';
import { D1KickoffStore } from '../infrastructure/match/d1-kickoff-store.ts';
import { D1MatchBoardStore } from '../infrastructure/match/d1-match-board-store.ts';
import { D1PairingStore } from '../infrastructure/match/d1-pairing-store.ts';
import { D1SettlementStore } from '../infrastructure/match/d1-settlement-store.ts';
import { D1UpvoteStore } from '../infrastructure/match/d1-upvote-store.ts';
import { ProductMatchClosureSyncHandler } from '../infrastructure/match/product-match-closure-sync-handler.ts';
import { SentryMatchIncidentReporter } from '../infrastructure/match/sentry-match-incident-reporter.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';

export const API_MATCH_PLATFORM_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> =
  createMatchPlatformModule('api');

// データベースとID生成(PLATFORM_TYPES)は基盤の束縛を使う
export const API_MATCH_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-match',
  bindings: new ContainerModule(({ bind }) => {
    bind<UpvoteStore>(MATCH_TYPES.UpvoteStore).to(D1UpvoteStore);
    bind<UpvoteService>(MATCH_TYPES.UpvoteService).to(StoreUpvoteService);
    bind<UserLifecycleSyncHandler>(
      MATCH_TYPES.AccountMatchClosureSyncHandler,
    ).to(AccountMatchClosureSyncHandler);
    bind<ProductLifecycleSyncHandler>(
      MATCH_TYPES.ProductMatchClosureSyncHandler,
    ).to(ProductMatchClosureSyncHandler);
    bind<SettlementStore>(MATCH_TYPES.SettlementStore).to(D1SettlementStore);
    bind<MatchSettlement>(MATCH_TYPES.MatchSettlement).to(StoreMatchSettlement);
    bind<PairingStore>(MATCH_TYPES.PairingStore).to(D1PairingStore);
    bind<RandomSource>(MATCH_TYPES.RandomSource).to(CryptoRandomSource);
    bind<QualifierPairingService>(MATCH_TYPES.QualifierPairingService).to(
      StoreQualifierPairingService,
    );
    bind<KickoffStore>(MATCH_TYPES.KickoffStore).to(D1KickoffStore);
    bind<EntryEligibilityChecker>(MATCH_TYPES.EntryEligibilityChecker).to(
      DirectoryEntryEligibilityChecker,
    );
    bind<MatchIncidentReporter>(MATCH_TYPES.MatchIncidentReporter).to(
      SentryMatchIncidentReporter,
    );
    bind<MatchKickoff>(MATCH_TYPES.MatchKickoff).to(StoreMatchKickoff);
    bind<ScheduledJobHandler>(MATCH_TYPES.MatchSettlementJob).to(
      MatchSettlementJob,
    );
    bind<ScheduledJobHandler>(MATCH_TYPES.QualifierPairingJob).to(
      QualifierPairingJob,
    );
    bind<ScheduledJobHandler>(MATCH_TYPES.MatchKickoffJob).to(MatchKickoffJob);
    bind<ScheduledJobHandler>(MATCH_TYPES.MatchEventRedispatchJob).to(
      MatchEventRedispatchJob,
    );
    bind<ScheduledJobHandler>(MATCH_TYPES.MatchEventCleanupJob).to(
      MatchEventCleanupJob,
    );
    bind<MatchBoardStore>(MATCH_TYPES.MatchBoardStore).to(D1MatchBoardStore);
    bind<MatchViewReader>(MATCH_TYPES.MatchViewReader).to(
      DirectoryMatchViewReader,
    );
    bind<QualifierBoardReader>(MATCH_TYPES.QualifierBoardReader).to(
      DirectoryQualifierBoardReader,
    );
  }),
};

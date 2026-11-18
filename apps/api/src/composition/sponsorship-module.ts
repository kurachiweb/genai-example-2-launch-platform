import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type AdminSponsorshipsReader,
  DefaultAdminSponsorshipsReader,
} from '../application/sponsorship/admin-sponsorships-reader.ts';
import { DailyNoticesJob } from '../application/sponsorship/jobs/daily-notices-job.ts';
import { MaintenanceJob } from '../application/sponsorship/jobs/maintenance-job.ts';
import {
  DefaultMySponsorshipsReader,
  type MySponsorshipsReader,
} from '../application/sponsorship/my-sponsorships-reader.ts';
import {
  DefaultSponsorshipApplication,
  type SponsorshipApplication,
} from '../application/sponsorship/sponsorship-application.ts';
import {
  DefaultSponsorshipOfferReader,
  type SponsorshipOfferReader,
} from '../application/sponsorship/sponsorship-offer-reader.ts';
import {
  DefaultSponsorshipTermination,
  type SponsorshipTermination,
  type SponsorshipTerminationWriter,
} from '../application/sponsorship/sponsorship-termination.ts';
import { SPONSORSHIP_TYPES } from '../application/sponsorship/sponsorship-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import type { ProductLifecycleSyncHandler } from '../infrastructure/product/product-lifecycle-sync-handler.ts';
import { AccountWithdrawalSyncHandler } from '../infrastructure/sponsorship/account-withdrawal-sync-handler.ts';
import { D1TerminationWriter } from '../infrastructure/sponsorship/d1-termination-writer.ts';
import {
  AccountDisplayStopSyncHandler,
  ProductDisplayStopSyncHandler,
} from '../infrastructure/sponsorship/display-stop-sync-handlers.ts';
import { ProductDeletionSyncHandler } from '../infrastructure/sponsorship/product-deletion-sync-handler.ts';

// スポンサー広告の共通の束縛(createSponsorshipPlatformModule)と、利用者の確認・決済の開始・価格・プロダクト・利用者のプロフィールの束縛は他のモジュールの束縛を使う
export const SPONSORSHIP_API_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-sponsorship',
  bindings: new ContainerModule(({ bind }) => {
    bind<SponsorshipApplication>(SPONSORSHIP_TYPES.SponsorshipApplication).to(
      DefaultSponsorshipApplication,
    );
    bind<SponsorshipOfferReader>(SPONSORSHIP_TYPES.SponsorshipOfferReader).to(
      DefaultSponsorshipOfferReader,
    );
    bind<MySponsorshipsReader>(SPONSORSHIP_TYPES.MySponsorshipsReader).to(
      DefaultMySponsorshipsReader,
    );
    bind<AdminSponsorshipsReader>(SPONSORSHIP_TYPES.AdminSponsorshipsReader).to(
      DefaultAdminSponsorshipsReader,
    );
    bind<SponsorshipTermination>(SPONSORSHIP_TYPES.SponsorshipTermination).to(
      DefaultSponsorshipTermination,
    );
    bind<SponsorshipTerminationWriter>(
      SPONSORSHIP_TYPES.SponsorshipTerminationWriter,
    ).to(D1TerminationWriter);
    bind<ScheduledJobHandler>(SPONSORSHIP_TYPES.DailyNoticesJob).to(
      DailyNoticesJob,
    );
    bind<ScheduledJobHandler>(SPONSORSHIP_TYPES.MaintenanceJob).to(
      MaintenanceJob,
    );
    bind<UserLifecycleSyncHandler>(
      SPONSORSHIP_TYPES.AccountWithdrawalSyncHandler,
    ).to(AccountWithdrawalSyncHandler);
    bind<ProductLifecycleSyncHandler>(
      SPONSORSHIP_TYPES.ProductDeletionSyncHandler,
    ).to(ProductDeletionSyncHandler);
    bind<UserLifecycleSyncHandler>(
      SPONSORSHIP_TYPES.AccountDisplayStopSyncHandler,
    ).to(AccountDisplayStopSyncHandler);
    bind<ProductLifecycleSyncHandler>(
      SPONSORSHIP_TYPES.ProductDisplayStopSyncHandler,
    ).to(ProductDisplayStopSyncHandler);
  }),
};

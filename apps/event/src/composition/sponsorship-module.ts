import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { EmailSender } from '../../lib/core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../lib/core/identity/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../lib/core/product/ports.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { AccountPurgeHandler } from '../application/sponsorship/account-purge-handler.ts';
import { EVENT_SPONSORSHIP_TYPES } from '../application/sponsorship/event-sponsorship-types.ts';
import { NoticeDispatchHandler } from '../application/sponsorship/notice-dispatch-handler.ts';
import type {
  NoticeClaimStore,
  SponsorshipPurgeStore,
} from '../application/sponsorship/ports.ts';
import { ProductPurgeHandler } from '../application/sponsorship/product-purge-handler.ts';
import { D1NoticeClaimStore } from '../infrastructure/sponsorship/d1-notice-claim-store.ts';
import { D1SponsorshipPurgeStore } from '../infrastructure/sponsorship/d1-sponsorship-purge-store.ts';
import type { EventEnv } from './env-schema.ts';

// スポンサー広告・アカウント・プロダクト・メールの共通の束縛が登録されている前提で、通知の送信と物理削除の処理とそのポートを束縛する
export const EVENT_SPONSORSHIP_MODULE: AppModule<
  Hono<PlatformHonoEnv<EventEnv>>
> = {
  name: 'event-sponsorship',
  bindings: new ContainerModule(({ bind }) => {
    bind<NoticeClaimStore>(EVENT_SPONSORSHIP_TYPES.NoticeClaimStore).to(
      D1NoticeClaimStore,
    );
    bind<NoticeDispatchHandler>(
      EVENT_SPONSORSHIP_TYPES.NoticeDispatchHandler,
    ).toDynamicValue(
      (context) =>
        new NoticeDispatchHandler({
          claims: context.get<NoticeClaimStore>(
            EVENT_SPONSORSHIP_TYPES.NoticeClaimStore,
          ),
          contacts: context.get<UserContactDirectory>(
            IDENTITY_PLATFORM_TYPES.UserContactDirectory,
          ),
          products: context.get<ProductDirectory>(
            PRODUCT_PLATFORM_TYPES.ProductDirectory,
          ),
          emails: context.get<EmailSender>(EMAIL_TYPES.EmailSender),
          clock: context.get<Clock>(PLATFORM_TYPES.Clock),
          clientSiteOrigin: context.get<EventEnv>(PLATFORM_TYPES.Env)
            .CLIENT_SITE_ORIGIN,
        }),
    );
    bind<SponsorshipPurgeStore>(
      EVENT_SPONSORSHIP_TYPES.SponsorshipPurgeStore,
    ).to(D1SponsorshipPurgeStore);
    bind<AccountPurgeHandler>(EVENT_SPONSORSHIP_TYPES.AccountPurgeHandler).to(
      AccountPurgeHandler,
    );
    bind<ProductPurgeHandler>(EVENT_SPONSORSHIP_TYPES.ProductPurgeHandler).to(
      ProductPurgeHandler,
    );
  }),
};

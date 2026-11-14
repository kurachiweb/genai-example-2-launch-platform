import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import type { UserLifecycleAsyncHandler } from '../../lib/core/identity/user-lifecycle.ts';
import { INQUIRY_EXPORT_TYPES } from '../../lib/core/inquiry/identifiers.ts';
import type { InquiryExport } from '../../lib/core/inquiry/ports.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { D1InquiryExport } from '../../lib/workers/inquiry/d1-inquiry-export.ts';
import { EVENT_INQUIRY_TYPES } from '../application/inquiry/event-inquiry-types.ts';
import { MemberInquiryPurgeHandler } from '../application/inquiry/member-inquiry-purge-handler.ts';
import type { MemberInquiryPurgeStore } from '../application/inquiry/ports.ts';
import { D1MemberInquiryPurgeStore } from '../infrastructure/inquiry/d1-member-inquiry-purge-store.ts';
import type { EventEnv } from './env-schema.ts';

export const EVENT_INQUIRY_MODULE: AppModule<Hono<PlatformHonoEnv<EventEnv>>> =
  {
    name: 'event-inquiry',
    bindings: new ContainerModule(({ bind }) => {
      bind<MemberInquiryPurgeStore>(
        EVENT_INQUIRY_TYPES.MemberInquiryPurgeStore,
      ).to(D1MemberInquiryPurgeStore);
      bind<UserLifecycleAsyncHandler>(
        EVENT_INQUIRY_TYPES.MemberInquiryPurgeHandler,
      ).to(MemberInquiryPurgeHandler);
      bind<InquiryExport>(INQUIRY_EXPORT_TYPES.InquiryExport).to(
        D1InquiryExport,
      );
    }),
  };

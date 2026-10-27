import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { Database } from '../../db/client.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  SuppressionMaintenance,
  UserAddressDirectory,
} from '../../lib/core/email/ports.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createSendRecordRepository } from '../../lib/workers/email/send-record-repository.ts';
import { createSuppressionMaintenance } from '../../lib/workers/email/suppression-maintenance.ts';
import { createSuppressionRepository } from '../../lib/workers/email/suppression-repository.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  API_EMAIL_TYPES,
  EmailCleanupJob,
} from '../application/email/email-cleanup-job.ts';
import { USER_ADDRESS_DIRECTORY } from './email-registrations.ts';

export const API_EMAIL_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'api-email',
  bindings: new ContainerModule(({ bind }) => {
    bind<UserAddressDirectory>(EMAIL_TYPES.UserAddressDirectory).to(
      USER_ADDRESS_DIRECTORY,
    );
    bind<SuppressionMaintenance>(EMAIL_TYPES.SuppressionMaintenance)
      .toDynamicValue((context) => {
        const db = context.get<Database>(PLATFORM_TYPES.Database);
        return createSuppressionMaintenance(
          createSuppressionRepository(
            db,
            context.get<Clock>(PLATFORM_TYPES.Clock),
          ),
          createSendRecordRepository(db),
          context.get<UserAddressDirectory>(EMAIL_TYPES.UserAddressDirectory),
        );
      })
      .inSingletonScope();
    bind<ScheduledJobHandler>(API_EMAIL_TYPES.EmailCleanupJob).to(
      EmailCleanupJob,
    );
  }),
};

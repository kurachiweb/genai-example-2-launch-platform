import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { MEDIA_TYPES } from '../../lib/core/media/identifiers.ts';
import {
  createUploadPurposeRegistry,
  type UploadPurpose,
  type UploadPurposeRegistry,
} from '../../lib/core/media/upload-purpose.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { createMediaPlatformModule } from '../../lib/workers/media/media-platform-module.ts';
import {
  assertFileReadPolicyRegistrations,
  type FileAccessAuthorizer,
  PolicyFileAccessAuthorizer,
} from '../application/media/file-access-authorizer.ts';
import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
  type FileReadPolicy,
  type FileReadPolicyRegistration,
} from '../application/media/file-access-policies.ts';
import {
  ExpiredFileErasureJob,
  LocationReconciliationJob,
  MEDIA_JOB_TYPES,
  ModerationRequeueJob,
} from '../application/media/media-daily-jobs.ts';
import { OwnerOnlyFileReadPolicy } from '../infrastructure/media/owner-only-file-read-policy.ts';
import { FILE_READ_POLICIES } from './file-read-policies.ts';
import { UPLOAD_PURPOSES } from './upload-purposes.ts';

type ApiAppModule = AppModule<Hono<PlatformHonoEnv<Env>>>;

export interface ApiMediaRegistrations {
  readonly purposes: readonly UploadPurpose[];
  readonly readPolicies: readonly FileReadPolicyRegistration[];
}

// 登録の誤りをデプロイ前に検出するため、モジュールの読み込み時に用途の登録表を作り、閲覧の方針の登録先を確かめる
export function createApiMediaModule({
  purposes,
  readPolicies,
}: ApiMediaRegistrations): ApiAppModule {
  const registry = createUploadPurposeRegistry(purposes);
  assertFileReadPolicyRegistrations(readPolicies, registry);
  return {
    name: 'api-media',
    bindings: new ContainerModule(({ bind }) => {
      bind<UploadPurposeRegistry>(
        MEDIA_TYPES.UploadPurposeRegistry,
      ).toConstantValue(registry);
      bind<FileReadPolicy>(FILE_ACCESS_TYPES.DefaultFileReadPolicy).to(
        OwnerOnlyFileReadPolicy,
      );
      bind<FileAccessAuthorizer>(FILE_ACCESS_TYPES.FileAccessAuthorizer)
        .toDynamicValue(
          (context) =>
            new PolicyFileAccessAuthorizer({
              registrations: readPolicies,
              resolveReadPolicy: (identifier) =>
                context.get<FileReadPolicy>(identifier),
              defaultReadPolicy: context.get<FileReadPolicy>(
                FILE_ACCESS_TYPES.DefaultFileReadPolicy,
              ),
              adminReviewPolicy: context.get<AdminMediaReviewPolicy>(
                FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
              ),
            }),
        )
        .inSingletonScope();
      bind<ScheduledJobHandler>(MEDIA_JOB_TYPES.ExpiredFileErasureJob).to(
        ExpiredFileErasureJob,
      );
      bind<ScheduledJobHandler>(MEDIA_JOB_TYPES.ModerationRequeueJob).to(
        ModerationRequeueJob,
      );
      bind<ScheduledJobHandler>(MEDIA_JOB_TYPES.LocationReconciliationJob).to(
        LocationReconciliationJob,
      );
    }),
  };
}

export const API_MEDIA_PLATFORM_MODULE: ApiAppModule =
  createMediaPlatformModule('api');

export const API_MEDIA_MODULE: ApiAppModule = createApiMediaModule({
  purposes: UPLOAD_PURPOSES,
  readPolicies: FILE_READ_POLICIES,
});

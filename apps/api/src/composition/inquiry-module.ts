import type { Hono } from 'hono';
import { type Bind, ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { ScheduledJobHandler } from '../../lib/core/scheduling/cron-registry.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  type GuestInquirySubmission,
  StoreGuestInquirySubmission,
} from '../application/inquiry/guest-inquiry-submission.ts';
import {
  type InquiryAdminService,
  StoreInquiryAdminService,
} from '../application/inquiry/inquiry-admin-service.ts';
import {
  type InquiryAttachmentBinder,
  MediaInquiryAttachmentBinder,
} from '../application/inquiry/inquiry-attachment-binder.ts';
import {
  type InquiryCategoryService,
  StoreInquiryCategoryService,
} from '../application/inquiry/inquiry-category-service.ts';
import {
  type InquiryChatService,
  StoreInquiryChatService,
} from '../application/inquiry/inquiry-chat-service.ts';
import {
  type InquiryReplyService,
  StoreInquiryReplyService,
} from '../application/inquiry/inquiry-reply-service.ts';
import {
  type InquiryStatusService,
  StoreInquiryStatusService,
} from '../application/inquiry/inquiry-status-service.ts';
import { INQUIRY_TYPES } from '../application/inquiry/inquiry-types.ts';
import { GuestInquiryRetentionJob } from '../application/inquiry/jobs/guest-inquiry-retention-job.ts';
import {
  type MemberInquirySubmission,
  StoreMemberInquirySubmission,
} from '../application/inquiry/member-inquiry-submission.ts';
import type {
  GuestInquiryRateLimit,
  GuestInquiryStore,
  InquirerProfiles,
  InquiryAdminReader,
  InquiryCategoryStore,
  InquiryIncidentReporter,
  InquiryMailer,
  InquirySettings,
  InquiryStatusStore,
  MemberInquiryStore,
} from '../application/inquiry/ports.ts';
import type { FileReadPolicy } from '../application/media/file-access-policies.ts';
import { PROFILE_TYPES } from '../application/profile/profile-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { CounterGuestInquiryRateLimit } from '../infrastructure/inquiry/counter-guest-inquiry-rate-limit.ts';
import { D1GuestInquiryStore } from '../infrastructure/inquiry/d1-guest-inquiry-store.ts';
import { D1InquiryAdminReader } from '../infrastructure/inquiry/d1-inquiry-admin-reader.ts';
import { D1InquiryCategoryStore } from '../infrastructure/inquiry/d1-inquiry-category-store.ts';
import { D1InquiryStatusStore } from '../infrastructure/inquiry/d1-inquiry-status-store.ts';
import { D1MemberInquiryStore } from '../infrastructure/inquiry/d1-member-inquiry-store.ts';
import { EmailInquiryMailer } from '../infrastructure/inquiry/email-inquiry-mailer.ts';
import { InquiryAttachmentReadPolicy } from '../infrastructure/inquiry/inquiry-attachment-read-policy.ts';
import { MemberInquiryWithdrawalHandler } from '../infrastructure/inquiry/member-inquiry-withdrawal-handler.ts';
import { SentryInquiryIncidentReporter } from '../infrastructure/inquiry/sentry-inquiry-incident-reporter.ts';
import type { ApiEnv } from './env-schema.ts';

function bindStores(bind: Bind): void {
  bind<InquiryCategoryStore>(INQUIRY_TYPES.InquiryCategoryStore).to(
    D1InquiryCategoryStore,
  );
  bind<GuestInquiryStore>(INQUIRY_TYPES.GuestInquiryStore).to(
    D1GuestInquiryStore,
  );
  bind<MemberInquiryStore>(INQUIRY_TYPES.MemberInquiryStore).to(
    D1MemberInquiryStore,
  );
  bind<InquiryStatusStore>(INQUIRY_TYPES.InquiryStatusStore).to(
    D1InquiryStatusStore,
  );
  bind<InquiryAdminReader>(INQUIRY_TYPES.InquiryAdminReader).to(
    D1InquiryAdminReader,
  );
  bind<InquirerProfiles>(INQUIRY_TYPES.InquirerProfiles).toService(
    PROFILE_TYPES.ProfileInquirerProfiles,
  );
}

function bindServices(bind: Bind): void {
  bind<InquirySettings>(INQUIRY_TYPES.InquirySettings)
    .toDynamicValue((context) =>
      Object.freeze({
        clientOrigin: context.get<ApiEnv>(PLATFORM_TYPES.Env)
          .CLIENT_SITE_ORIGIN,
      }),
    )
    .inSingletonScope();
  bind<InquiryMailer>(INQUIRY_TYPES.InquiryMailer).to(EmailInquiryMailer);
  bind<InquiryIncidentReporter>(INQUIRY_TYPES.InquiryIncidentReporter).to(
    SentryInquiryIncidentReporter,
  );
  bind<GuestInquiryRateLimit>(INQUIRY_TYPES.GuestInquiryRateLimit).to(
    CounterGuestInquiryRateLimit,
  );
  bind<InquiryAttachmentBinder>(INQUIRY_TYPES.InquiryAttachmentBinder).to(
    MediaInquiryAttachmentBinder,
  );
}

function bindUseCases(bind: Bind): void {
  bind<InquiryCategoryService>(INQUIRY_TYPES.InquiryCategoryService).to(
    StoreInquiryCategoryService,
  );
  bind<GuestInquirySubmission>(INQUIRY_TYPES.GuestInquirySubmission).to(
    StoreGuestInquirySubmission,
  );
  bind<MemberInquirySubmission>(INQUIRY_TYPES.MemberInquirySubmission).to(
    StoreMemberInquirySubmission,
  );
  bind<InquiryChatService>(INQUIRY_TYPES.InquiryChatService).to(
    StoreInquiryChatService,
  );
  bind<InquiryAdminService>(INQUIRY_TYPES.InquiryAdminService).to(
    StoreInquiryAdminService,
  );
  bind<InquiryReplyService>(INQUIRY_TYPES.InquiryReplyService).to(
    StoreInquiryReplyService,
  );
  bind<InquiryStatusService>(INQUIRY_TYPES.InquiryStatusService).to(
    StoreInquiryStatusService,
  );
}

function bindRegistrations(bind: Bind): void {
  bind<ScheduledJobHandler>(INQUIRY_TYPES.GuestInquiryRetentionJob).to(
    GuestInquiryRetentionJob,
  );
  bind<FileReadPolicy>(INQUIRY_TYPES.InquiryAttachmentReadPolicy).to(
    InquiryAttachmentReadPolicy,
  );
  bind<UserLifecycleSyncHandler>(
    INQUIRY_TYPES.MemberInquiryWithdrawalHandler,
  ).to(MemberInquiryWithdrawalHandler);
}

// 利用者の確認(IDENTITY_PLATFORM_TYPES)・監査ログ(ADMIN_PLATFORM_TYPES)・ファイル(MEDIA_TYPES)・メール(EMAIL_TYPES)は各機能のモジュールの束縛を使い、利用者の表示(InquirerProfiles)はプロフィールのモジュールの束縛へ転送する
export const INQUIRY_MODULE: AppModule<Hono<PlatformHonoEnv<Env>>> = {
  name: 'inquiry',
  bindings: new ContainerModule(({ bind }) => {
    bindStores(bind);
    bindServices(bind);
    bindUseCases(bind);
    bindRegistrations(bind);
  }),
};

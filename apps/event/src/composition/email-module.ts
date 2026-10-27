import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_KINDS } from '../../lib/core/email/kinds/index.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type { SenderInfoProvider } from '../../lib/core/email/ports.ts';
import type { MessageHandler } from '../../lib/core/messaging/message-contract.ts';
import type { RawMessageHandler } from '../../lib/core/messaging/raw-queue.ts';
import type { EmailSendBody } from '../../lib/core/email/send-message.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import { DeliveryEventHandler } from '../application/email/delivery-event-handler.ts';
import { EVENT_EMAIL_TYPES } from '../application/email/email-types.ts';
import type {
  EmailIncidentReporter,
  EmailProvider,
  EmailRenderer,
  EmailRuntimeConfig,
} from '../application/email/ports.ts';
import { SendEmailHandler } from '../application/email/send-email-handler.ts';
import { createEmailProvider } from '../infrastructure/email/providers/create-email-provider.ts';
import { createEmailTemplateRegistry } from '../infrastructure/email/rendering/email-template.ts';
import { ReactEmailRenderer } from '../infrastructure/email/rendering/react-email-renderer.tsx';
import { SentryEmailIncidentReporter } from '../infrastructure/email/sentry-email-incident-reporter.ts';
import { EMAIL_TEMPLATES } from '../infrastructure/email/templates/index.ts';
import { EMAIL_SENDER_INFO_PROVIDER } from './email-registrations.ts';
import type { EventEnv } from './env-schema.ts';

// 種別とテンプレートの対応の誤りを、最初のメッセージではなくisolateの起動時に検出する
const EMAIL_RENDERER = new ReactEmailRenderer(
  createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
);

export const EVENT_EMAIL_MODULE: AppModule<Hono<PlatformHonoEnv<EventEnv>>> = {
  name: 'event-email',
  bindings: new ContainerModule(({ bind }) => {
    bind<EmailProvider>(EVENT_EMAIL_TYPES.EmailProvider)
      .toDynamicValue((context) =>
        createEmailProvider(context.get<EventEnv>(PLATFORM_TYPES.Env), fetch),
      )
      .inSingletonScope();
    bind<EmailRenderer>(EVENT_EMAIL_TYPES.EmailRenderer).toConstantValue(
      EMAIL_RENDERER,
    );
    bind<SenderInfoProvider>(EMAIL_TYPES.SenderInfoProvider).to(
      EMAIL_SENDER_INFO_PROVIDER,
    );
    bind<EmailIncidentReporter>(EVENT_EMAIL_TYPES.EmailIncidentReporter).to(
      SentryEmailIncidentReporter,
    );
    bind<EmailRuntimeConfig>(EVENT_EMAIL_TYPES.EmailRuntimeConfig)
      .toDynamicValue((context) => ({
        fromAddress: context.get<EventEnv>(PLATFORM_TYPES.Env)
          .EMAIL_FROM_ADDRESS,
        fromName: 'Launch Stadium',
      }))
      .inSingletonScope();
    bind<MessageHandler<EmailSendBody>>(EVENT_EMAIL_TYPES.SendEmailHandler).to(
      SendEmailHandler,
    );
    bind<RawMessageHandler>(EVENT_EMAIL_TYPES.DeliveryEventHandler).to(
      DeliveryEventHandler,
    );
  }),
};

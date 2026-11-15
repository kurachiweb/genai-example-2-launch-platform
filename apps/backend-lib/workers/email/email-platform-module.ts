import { ContainerModule } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  createEmailKindRegistry,
  type EmailKindRegistry,
} from '../../core/email/email-kind.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import { EMAIL_KINDS } from '../../core/email/kinds/index.ts';
import type {
  AlertThrottle,
  EmailSender,
  SendRecordStore,
  SuppressionList,
  SuppressionRecorder,
} from '../../core/email/ports.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { MessagePublisher } from '../messaging/queue-publisher.ts';
import { createAlertThrottleRepository } from './alert-throttle-repository.ts';
import { createEmailSender } from './email-sender.ts';
import { createSendRecordRepository } from './send-record-repository.ts';
import { createSuppressionRepository } from './suppression-repository.ts';

// 種別の名前の重複などの登録の誤りを、最初の処理単位ではなくisolateの起動時に検出する
const EMAIL_KIND_REGISTRY = createEmailKindRegistry(EMAIL_KINDS);

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const EMAIL_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'email-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<EmailKindRegistry>(EMAIL_TYPES.EmailKindRegistry).toConstantValue(
      EMAIL_KIND_REGISTRY,
    );
    bind<EmailSender>(EMAIL_TYPES.EmailSender)
      .toDynamicValue((context) =>
        createEmailSender(
          context.get<MessagePublisher>(PLATFORM_TYPES.MessagePublisher),
          context.get<EmailKindRegistry>(EMAIL_TYPES.EmailKindRegistry),
        ),
      )
      .inSingletonScope();
    bind<SuppressionList>(EMAIL_TYPES.SuppressionList)
      .toDynamicValue((context) =>
        createSuppressionRepository(
          context.get<Database>(PLATFORM_TYPES.Database),
          context.get<Clock>(PLATFORM_TYPES.Clock),
        ),
      )
      .inSingletonScope();
    bind<SuppressionRecorder>(EMAIL_TYPES.SuppressionRecorder)
      .toDynamicValue((context) =>
        createSuppressionRepository(
          context.get<Database>(PLATFORM_TYPES.Database),
          context.get<Clock>(PLATFORM_TYPES.Clock),
        ),
      )
      .inSingletonScope();
    bind<SendRecordStore>(EMAIL_TYPES.SendRecordStore)
      .toDynamicValue((context) =>
        createSendRecordRepository(
          context.get<Database>(PLATFORM_TYPES.Database),
        ),
      )
      .inSingletonScope();
    bind<AlertThrottle>(EMAIL_TYPES.AlertThrottle)
      .toDynamicValue((context) =>
        createAlertThrottleRepository(
          context.get<Database>(PLATFORM_TYPES.Database),
        ),
      )
      .inSingletonScope();
  }),
};

import { ContainerModule, type ResolutionContext } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../core/data-export/identifiers.ts';
import type {
  DataExportIncidentReporter,
  DataExportNotifier,
  DataExportStore,
  DataExportTerminator,
  ExportArchiveStorage,
} from '../../core/data-export/ports.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { D1DataExportStore } from './d1-data-export-store.ts';
import {
  type DataExportNotifierEnv,
  EmailDataExportNotifier,
} from './data-export-notifier.ts';
import { StoreDataExportTerminator } from './data-export-terminator.ts';
import { R2ExportArchiveStorage } from './r2-export-archive-storage.ts';
import { SentryDataExportIncidentReporter } from './sentry-data-export-incident-reporter.ts';

const storeOf = (context: ResolutionContext): DataExportStore =>
  context.get<DataExportStore>(DATA_EXPORT_PLATFORM_TYPES.DataExportStore);

const notifierOf = (context: ResolutionContext): DataExportNotifier =>
  context.get<DataExportNotifier>(
    DATA_EXPORT_PLATFORM_TYPES.DataExportNotifier,
  );

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる。通知はユーザー連絡先とメール送信の共通の束縛が同じコンテナにある前提で組み立て、アプリの名前はログのカテゴリの先頭になる
export function createDataExportPlatformModule(
  appName: LoggingOptions['appName'],
): Omit<AppModule, 'routes'> {
  return {
    name: 'data-export-platform',
    bindings: new ContainerModule(({ bind }) => {
      bind<DataExportStore>(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
        .to(D1DataExportStore)
        .inSingletonScope();
      bind<ExportArchiveStorage>(
        DATA_EXPORT_PLATFORM_TYPES.ExportArchiveStorage,
      )
        .to(R2ExportArchiveStorage)
        .inSingletonScope();
      bind<DataExportNotifier>(DATA_EXPORT_PLATFORM_TYPES.DataExportNotifier)
        .toDynamicValue(
          (context) =>
            new EmailDataExportNotifier(
              storeOf(context),
              context.get<UserContactDirectory>(
                IDENTITY_PLATFORM_TYPES.UserContactDirectory,
              ),
              context.get<EmailSender>(EMAIL_TYPES.EmailSender),
              context.get<DataExportNotifierEnv>(PLATFORM_TYPES.Env),
              appName,
            ),
        )
        .inSingletonScope();
      bind<DataExportTerminator>(
        DATA_EXPORT_PLATFORM_TYPES.DataExportTerminator,
      )
        .toDynamicValue(
          (context) =>
            new StoreDataExportTerminator(
              storeOf(context),
              context.get<ExportArchiveStorage>(
                DATA_EXPORT_PLATFORM_TYPES.ExportArchiveStorage,
              ),
              notifierOf(context),
              appName,
            ),
        )
        .inSingletonScope();
      bind<DataExportIncidentReporter>(
        DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter,
      )
        .toDynamicValue(() => new SentryDataExportIncidentReporter(appName))
        .inSingletonScope();
    }),
  };
}

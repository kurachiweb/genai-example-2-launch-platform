import { ContainerModule } from 'inversify';

import type { AppModule } from '../../core/di/app-module.ts';
import { REPORTING_PLATFORM_TYPES } from '../../core/reporting/identifiers.ts';
import type { ReportErasureStore } from '../../core/reporting/ports.ts';
import { D1ReportErasureStore } from './d1-report-erasure-store.ts';
import type { ReportErasureStatements } from './report-erasure-statements.ts';

// 経路を持たないモジュールは、routesを除いた形にすると環境を指定したどのアプリのAppModuleの一覧にも加えられる
export const REPORTING_PLATFORM_MODULE: Omit<AppModule, 'routes'> = {
  name: 'reporting-platform',
  bindings: new ContainerModule(({ bind }) => {
    bind<ReportErasureStore>(REPORTING_PLATFORM_TYPES.ReportErasureStore)
      .to(D1ReportErasureStore)
      .inSingletonScope();
    bind<ReportErasureStatements>(
      REPORTING_PLATFORM_TYPES.ReportErasureStatements,
    )
      .to(D1ReportErasureStore)
      .inSingletonScope();
  }),
};

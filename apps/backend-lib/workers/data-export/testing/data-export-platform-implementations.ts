import type { DATA_EXPORT_PLATFORM_TYPES } from '../../../core/data-export/identifiers.ts';
import { D1DataExportStore } from '../d1-data-export-store.ts';
import { EmailDataExportNotifier } from '../data-export-notifier.ts';
import { StoreDataExportTerminator } from '../data-export-terminator.ts';
import { R2ExportArchiveStorage } from '../r2-export-archive-storage.ts';
import { SentryDataExportIncidentReporter } from '../sentry-data-export-incident-reporter.ts';

type DataExportTypeName = keyof typeof DATA_EXPORT_PLATFORM_TYPES;

// 3つの経路の解決の検査が同じ対応を確かめるよう、識別子の名前と束縛する実装の対応を1か所に置く
export const DATA_EXPORT_IMPLEMENTATIONS = [
  ['DataExportStore', D1DataExportStore],
  ['ExportArchiveStorage', R2ExportArchiveStorage],
  ['DataExportNotifier', EmailDataExportNotifier],
  ['DataExportTerminator', StoreDataExportTerminator],
  ['DataExportIncidentReporter', SentryDataExportIncidentReporter],
] as const satisfies readonly (readonly [DataExportTypeName, unknown])[];

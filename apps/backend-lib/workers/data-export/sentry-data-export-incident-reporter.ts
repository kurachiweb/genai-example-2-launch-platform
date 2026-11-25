import type { Logger } from '@logtape/logtape';
import {
  captureEvent,
  captureException,
  type SeverityLevel,
} from '@sentry/cloudflare';

import type {
  DataExportIncident,
  DataExportIncidentReporter,
} from '../../core/data-export/ports.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

type IncidentKind = DataExportIncident['kind'];

interface IncidentDetails {
  readonly tags?: Readonly<Record<string, string>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const LEVELS: Readonly<Record<IncidentKind, SeverityLevel>> = {
  'generation-failed': 'error',
  'generation-abandoned': 'warning',
  'archive-deletion-failed': 'error',
  'notice-redispatch-failed': 'error',
  'archive-missing': 'warning',
};

const MESSAGES: Readonly<Record<IncidentKind, string>> = {
  'generation-failed': 'データエクスポートの生成が再試行の上限まで失敗しました',
  'generation-abandoned':
    '進んでいないデータエクスポートの要求を失敗として確定しました',
  'archive-deletion-failed':
    '期限切れのデータエクスポートのファイルを削除できませんでした',
  'notice-redispatch-failed':
    'データエクスポートの通知の送り直しに失敗したものがあります',
  'archive-missing':
    'データエクスポートのファイルが保存先に見つかりませんでした',
};

// ジョブの名前は<spec名>.<名詞句>の形で登録される
const JOB_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const UNSAFE_VALUE = 'unknown';

const TAG_NAME = 'data_export_incident';

// タグ・コンテキスト・指紋は除去処理の対象外のため、識別子と分類の形の値だけを送り、メールアドレス・ファイル名・オブジェクトのキーが紛れ込まないようにする
const toExportId = (value: string): string =>
  isUppercaseUlid(value) ? value : UNSAFE_VALUE;

const toJobName = (value: string): string =>
  JOB_NAME_PATTERN.test(value) ? value : UNSAFE_VALUE;

function detailsOf(incident: DataExportIncident): IncidentDetails {
  switch (incident.kind) {
    case 'generation-failed': {
      const exportId = toExportId(incident.exportId);
      return {
        context: { export_id: exportId, attempts: incident.attempts },
        logProperties: {
          exportId,
          attempts: incident.attempts,
          error: incident.error,
        },
      };
    }
    case 'generation-abandoned': {
      const exportId = toExportId(incident.exportId);
      return {
        context: { export_id: exportId, by: incident.by },
        logProperties: { exportId, by: incident.by },
      };
    }
    case 'archive-deletion-failed': {
      const job = toJobName(incident.job);
      return {
        tags: { job },
        context: { count: incident.count },
        logProperties: { job, count: incident.count },
      };
    }
    case 'notice-redispatch-failed':
      return {
        context: { count: incident.count },
        logProperties: { count: incident.count },
      };
    case 'archive-missing': {
      const exportId = toExportId(incident.exportId);
      return {
        context: { export_id: exportId },
        logProperties: { exportId },
      };
    }
  }
}

export class SentryDataExportIncidentReporter implements DataExportIncidentReporter {
  private readonly logger: Logger;

  constructor(appName: LoggingOptions['appName']) {
    this.logger = getAppLogger([appName, 'infrastructure', 'data-export']);
  }

  report(incident: DataExportIncident): void {
    const level = LEVELS[incident.kind];
    const message = MESSAGES[incident.kind];
    const { tags, context, logProperties } = detailsOf(incident);
    const properties = { incident: incident.kind, ...logProperties };
    if (level === 'error') {
      this.logger.error(message, properties);
    } else {
      this.logger.warn(message, properties);
    }
    const eventTags = { [TAG_NAME]: incident.kind, ...tags };
    const contexts = { [TAG_NAME]: context };
    if (
      incident.kind === 'generation-failed' &&
      !(incident.error instanceof AppError)
    ) {
      captureException(incident.error, { level, tags: eventTags, contexts });
      return;
    }
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて起きた同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる。AppErrorの例外は除去処理が捨てるため、この通知で送る
    captureEvent({
      level,
      logentry: { message },
      fingerprint: ['data-export', incident.kind],
      tags: eventTags,
      contexts,
    });
  }
}

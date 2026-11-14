import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type {
  EmailCleanupSummary,
  SuppressionMaintenance,
} from '../../../lib/core/email/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { API_EMAIL_TYPES, EmailCleanupJob } from './email-cleanup-job.ts';

const SCHEDULED_TIME = new Date('2026-11-02T12:21:00.000Z');

const CONTEXT: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: toBusinessDateTime(SCHEDULED_TIME),
};

const SKIPPED_SUMMARY: EmailCleanupSummary = {
  expiredSuppressionsDeleted: 2,
  unlinkedSuppressionsDeleted: 0,
  sendRecordsDeleted: 5,
  unlinkedCheck: 'skipped-directory-unavailable',
};

const CLEANUP_CATEGORY = 'api.application.email-cleanup';

interface RecordingMaintenance {
  readonly maintenance: SuppressionMaintenance;
  readonly cleanupCalls: Date[];
}

function recordingMaintenance(
  summary: EmailCleanupSummary,
): RecordingMaintenance {
  const cleanupCalls: Date[] = [];
  const maintenance: SuppressionMaintenance = {
    deleteByAddress: () =>
      Promise.reject(new Error('日次の後始末では呼ばれない')),
    runDailyCleanup: (now) => {
      cleanupCalls.push(now);
      return Promise.resolve(summary);
    },
  };
  return { maintenance, cleanupCalls };
}

const records: LogRecord[] = [];

function cleanupLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === CLEANUP_CATEGORY,
  );
}

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('EmailCleanupJob', () => {
  test('予定時刻を基準に日次の後始末を1回呼び、要約をinfoのログに出す', async () => {
    const { maintenance, cleanupCalls } = recordingMaintenance(SKIPPED_SUMMARY);

    await new EmailCleanupJob(maintenance).run(CONTEXT);

    expect(cleanupCalls).toEqual([SCHEDULED_TIME]);
    const logs = cleanupLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.properties).toEqual({ ...SKIPPED_SUMMARY });
  });

  test('照会口が使えて削除まで済んだ要約も、そのままの件数でログに出す', async () => {
    const summary: EmailCleanupSummary = {
      expiredSuppressionsDeleted: 0,
      unlinkedSuppressionsDeleted: 3,
      sendRecordsDeleted: 0,
      unlinkedCheck: 'done',
    };
    const { maintenance } = recordingMaintenance(summary);

    await new EmailCleanupJob(maintenance).run(CONTEXT);

    expect(cleanupLogs().map(({ properties }) => properties)).toEqual([
      { ...summary },
    ]);
  });

  test('後始末が失敗すれば要約を出さずに例外を投げ直し、ディスパッチャへ失敗を伝える', async () => {
    const failure = new Error('D1に到達できません');
    const maintenance: SuppressionMaintenance = {
      deleteByAddress: () => Promise.resolve(),
      runDailyCleanup: () => Promise.reject(failure),
    };

    const error: unknown = await new EmailCleanupJob(maintenance)
      .run(CONTEXT)
      .catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(cleanupLogs()).toEqual([]);
  });

  test('識別子に束縛すると、コンテナが後始末のサービスを注入したジョブを返す', async () => {
    const { maintenance, cleanupCalls } = recordingMaintenance(SKIPPED_SUMMARY);
    const container = new Container({ defaultScope: 'Transient' });
    container
      .bind<SuppressionMaintenance>(EMAIL_TYPES.SuppressionMaintenance)
      .toConstantValue(maintenance);
    container
      .bind<ScheduledJobHandler>(API_EMAIL_TYPES.EmailCleanupJob)
      .to(EmailCleanupJob);

    await container
      .get<ScheduledJobHandler>(API_EMAIL_TYPES.EmailCleanupJob)
      .run(CONTEXT);

    expect(cleanupCalls).toEqual([SCHEDULED_TIME]);
  });
});

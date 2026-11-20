import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, test } from 'vitest';

import { withSentryForScheduledAndQueue } from '../../../lib/workers/observability/sentry.ts';
import {
  configureRecordingLogs,
  createRecordingFetch,
  recordingSentryOptions,
} from '../../../test/support/observability-recording.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
} from '../../application/moderation/ports.ts';
import { SentryModerationIncidentReporter } from './sentry-moderation-incident-reporter.ts';

const RECORD_MISSING_MESSAGE =
  '状態を変えた措置の記録と監査ログが、同期の処理で確定されませんでした';

const STATISTICS_FAILED_MESSAGE = '週ごとの統計の集計に失敗しました';

const REDISPATCH_FAILED_MESSAGE =
  '措置の通知の送り直しに失敗したものがあります';

type Report = readonly [ModerationIncident, ModerationIncidentContext];

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  reports: readonly Report[],
): Promise<Record<string, unknown>[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryModerationIncidentReporter();
  const handler = withSentryForScheduledAndQueue<Env>(
    recordingSentryOptions(recording, { tracesSampleRate: 0 }),
    {
      scheduled: () => {
        for (const [incident, context] of reports) {
          reporter.report(incident, context);
        }
      },
    },
  );
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return recording.items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

afterAll(() => {
  resetSync();
});

describe('SentryModerationIncidentReporter(エラートラッキング)', () => {
  test('記録の取り出し漏れを、文言をlogentryに、理由を指紋とタグに置いてerrorで送る', async () => {
    const [event] = await reportWithSentry([['moderation-record-missing', {}]]);

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: RECORD_MISSING_MESSAGE },
      fingerprint: ['moderation', 'moderation-record-missing'],
      tags: { moderation_incident: 'moderation-record-missing' },
    });
    expect(event?.['tags']).not.toHaveProperty('job');
    expect(event?.['contexts']).not.toHaveProperty('moderation_incident');
  });

  test('統計の集計の失敗を、ジョブの名前をタグに添えて送る', async () => {
    const [event] = await reportWithSentry([
      ['statistics-failed', { job: 'ugc-moderation.weekly-statistics' }],
    ]);

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: STATISTICS_FAILED_MESSAGE },
      fingerprint: ['moderation', 'statistics-failed'],
      tags: {
        moderation_incident: 'statistics-failed',
        job: 'ugc-moderation.weekly-statistics',
      },
    });
  });

  test('通知の送り直しの失敗を、ジョブの名前と件数を添えて送る', async () => {
    const [event] = await reportWithSentry([
      [
        'notice-redispatch-failed',
        { job: 'ugc-moderation.maintenance', count: 3 },
      ],
    ]);

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: REDISPATCH_FAILED_MESSAGE },
      fingerprint: ['moderation', 'notice-redispatch-failed'],
      tags: {
        moderation_incident: 'notice-redispatch-failed',
        job: 'ugc-moderation.maintenance',
      },
      contexts: { moderation_incident: { count: 3 } },
    });
  });

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const report: Report = ['moderation-record-missing', {}];

    const events = await reportWithSentry([report, report, report]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryModerationIncidentReporter(ログ)', () => {
  test('報告を、理由・ジョブ・件数だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryModerationIncidentReporter();

    reporter.report('notice-redispatch-failed', {
      job: 'ugc-moderation.maintenance',
      count: 2,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.moderation',
      message: REDISPATCH_FAILED_MESSAGE,
      incident: 'notice-redispatch-failed',
      job: 'ugc-moderation.maintenance',
      count: 2,
    });
  });
});

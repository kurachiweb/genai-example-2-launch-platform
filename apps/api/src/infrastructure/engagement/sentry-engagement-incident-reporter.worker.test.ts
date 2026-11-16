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
import type { EngagementIncident } from '../../application/engagement/ports.ts';
import { SentryEngagementIncidentReporter } from './sentry-engagement-incident-reporter.ts';

const OVERDUE_MESSAGE =
  '削除から14日の匿名化の期限までに匿名化できないおそれのあるコメントが残っています';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly EngagementIncident[],
): Promise<Record<string, unknown>[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryEngagementIncidentReporter();
  const handler = withSentryForScheduledAndQueue<Env>(
    recordingSentryOptions(recording, { tracesSampleRate: 0 }),
    {
      scheduled: () => {
        for (const incident of incidents) {
          reporter.report(incident);
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

describe('SentryEngagementIncidentReporter(エラートラッキング)', () => {
  test('匿名化の期限までに匿名化できないおそれのあるコメントを、errorで件数を添えて送る', async () => {
    const events = await reportWithSentry([
      { kind: 'comment-anonymization-overdue', count: 7 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: { message: OVERDUE_MESSAGE },
      fingerprint: ['engagement', 'comment-anonymization-overdue'],
      tags: { engagement_incident: 'comment-anonymization-overdue' },
      contexts: { engagement_incident: { count: 7 } },
    });
  });

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: EngagementIncident = {
      kind: 'comment-anonymization-overdue',
      count: 1,
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryEngagementIncidentReporter(ログ)', () => {
  test('報告を、種類と件数だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryEngagementIncidentReporter();

    reporter.report({ kind: 'comment-anonymization-overdue', count: 2 });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.engagement',
      message: OVERDUE_MESSAGE,
      incident: 'comment-anonymization-overdue',
      count: 2,
    });
  });
});

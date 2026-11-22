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
  ReportIncident,
  ReportIncidentContext,
} from '../../application/reporting/ports.ts';
import { SentryReportIncidentReporter } from './sentry-report-incident-reporter.ts';

const REDISPATCH_FAILED_MESSAGE =
  '通報の当事者への通知の送り直しに失敗したものがあります';

const INQUIRY_RECORD_FAILED_MESSAGE =
  '権利侵害の照会のメールを依頼した後に、照会を記録できませんでした';

const CASE_ID = '01JE0CASE0000000000000001';

type Report = readonly [ReportIncident, ReportIncidentContext];

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  reports: readonly Report[],
): Promise<Record<string, unknown>[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryReportIncidentReporter();
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

describe('SentryReportIncidentReporter(エラートラッキング)', () => {
  test('通知の送り直しの失敗を、文言をlogentryに、理由を指紋とタグに置き、ジョブの名前をタグに、件数を文脈に添えてerrorで送る', async () => {
    const [event] = await reportWithSentry([
      [
        'notice-redispatch-failed',
        { job: 'content-reporting.notice-redispatch', count: 3 },
      ],
    ]);

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: REDISPATCH_FAILED_MESSAGE },
      fingerprint: ['reporting', 'notice-redispatch-failed'],
      tags: {
        report_incident: 'notice-redispatch-failed',
        job: 'content-reporting.notice-redispatch',
      },
      contexts: { report_incident: { count: 3 } },
    });
    expect(event?.['contexts']).not.toHaveProperty('report_incident.caseId');
  });

  test('照会の記録の失敗を、案件のIDをタグでなく文脈に添えて送る', async () => {
    const [event] = await reportWithSentry([
      ['inquiry-record-failed', { caseId: CASE_ID }],
    ]);

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: INQUIRY_RECORD_FAILED_MESSAGE },
      fingerprint: ['reporting', 'inquiry-record-failed'],
      tags: { report_incident: 'inquiry-record-failed' },
      contexts: { report_incident: { caseId: CASE_ID } },
    });
    expect(event?.['tags']).not.toHaveProperty('job');
    expect(event?.['tags']).not.toHaveProperty('caseId');
  });

  test('ジョブ・案件・件数の無い報告には文脈を付けない', async () => {
    const [event] = await reportWithSentry([['inquiry-record-failed', {}]]);

    expect(event?.['tags']).toMatchObject({
      report_incident: 'inquiry-record-failed',
    });
    expect(event?.['contexts']).not.toHaveProperty('report_incident');
  });

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const report: Report = ['inquiry-record-failed', { caseId: CASE_ID }];

    const events = await reportWithSentry([report, report, report]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryReportIncidentReporter(ログ)', () => {
  test('報告を、理由・ジョブ・案件・件数だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryReportIncidentReporter();

    reporter.report('notice-redispatch-failed', {
      job: 'content-reporting.notice-redispatch',
      count: 2,
    });
    reporter.report('inquiry-record-failed', { caseId: CASE_ID });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.reporting',
      message: REDISPATCH_FAILED_MESSAGE,
      incident: 'notice-redispatch-failed',
      job: 'content-reporting.notice-redispatch',
      count: 2,
    });
    expect(logs[1]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.reporting',
      message: INQUIRY_RECORD_FAILED_MESSAGE,
      incident: 'inquiry-record-failed',
      caseId: CASE_ID,
    });
  });
});

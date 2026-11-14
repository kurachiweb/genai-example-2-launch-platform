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
import type { MatchIncident } from '../../application/match/ports.ts';
import { SentryMatchIncidentReporter } from './sentry-match-incident-reporter.ts';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly MatchIncident[],
): Promise<Record<string, unknown>[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryMatchIncidentReporter();
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

describe('SentryMatchIncidentReporter(エラートラッキング)', () => {
  test('開始の日時から遅れた開始を、errorで件数を添えて送る', async () => {
    const events = await reportWithSentry([
      { kind: 'match-kickoff-late', count: 4 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: {
        message: '開始の日時から10分を過ぎて開始したマッチがあります',
      },
      fingerprint: ['match', 'match-kickoff-late'],
      tags: { match_incident: 'match-kickoff-late' },
      contexts: { match_incident: { count: 4 } },
    });
  });

  test.each([
    [
      'match-settlement-late',
      '終了の時刻のジョブで確定できなかったマッチを、ペアリングの前に確定しました',
    ],
    [
      'qualifier-pairing-late',
      '前日に完了していなかった予選のペアリングを、開始の前に行いました',
    ],
    [
      'match-settlement-overdue',
      '終了の日時から1時間を過ぎても確定していないマッチがあります',
    ],
  ] as const)(
    '日次の処理の遅れ(%s)を、errorで種類ごとの文言・指紋と件数を添えて送る',
    async (kind, message) => {
      const events = await reportWithSentry([{ kind, count: 6 }]);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: 'error',
        logentry: { message },
        fingerprint: ['match', kind],
        tags: { match_incident: kind },
        contexts: { match_incident: { count: 6 } },
      });
    },
  );

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: MatchIncident = { kind: 'match-kickoff-late', count: 1 };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryMatchIncidentReporter(ログ)', () => {
  test('報告を、種類と件数だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryMatchIncidentReporter();

    reporter.report({ kind: 'match-kickoff-late', count: 2 });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.match',
      message: '開始の日時から10分を過ぎて開始したマッチがあります',
      incident: 'match-kickoff-late',
      count: 2,
    });
  });
});

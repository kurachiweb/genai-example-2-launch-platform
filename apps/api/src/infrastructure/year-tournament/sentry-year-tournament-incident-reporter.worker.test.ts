import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, test } from 'vitest';

import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { withSentryForScheduledAndQueue } from '../../../lib/workers/observability/sentry.ts';
import {
  configureRecordingLogs,
  createRecordingFetch,
  recordingSentryOptions,
} from '../../../test/support/observability-recording.ts';
import type { YearTournamentIncident } from '../../application/year-tournament/ports.ts';
import { SentryYearTournamentIncidentReporter } from './sentry-year-tournament-incident-reporter.ts';

interface SentEvent {
  readonly level?: string;
  readonly logentry?: { readonly message?: string };
  readonly fingerprint?: readonly string[];
  readonly tags?: Record<string, string>;
  readonly contexts?: Record<string, Record<string, unknown>>;
  readonly user?: unknown;
  readonly extra?: unknown;
}

const DATE = parseBusinessDate('2026-11-16');

const EVENING_MESSAGE =
  'Yearトーナメントの23:45の夜の処理に失敗し、夜の送り出しの準備の完了を伝えませんでした';

const FOLLOW_UP_MESSAGE =
  'Yearトーナメントの4:21の返金と知らせの再処理に失敗しました';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly YearTournamentIncident[],
): Promise<SentEvent[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryYearTournamentIncidentReporter();
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
    .map(({ payload }) => payload as SentEvent);
}

afterAll(() => {
  resetSync();
});

describe('SentryYearTournamentIncidentReporter(エラートラッキング)', () => {
  test('23:45の夜の処理の失敗を、errorで文言をlogentry・理由を指紋に置き、ジョブと年の識別だけをタグに付けて送る', async () => {
    const events = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['draw'],
        failedYears: [2027],
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: { message: EVENING_MESSAGE },
      fingerprint: ['tournament-year', 'evening-bracket-failed'],
    });
    expect(events[0]?.tags).toEqual({
      tournament_year_incident: 'evening-bracket-failed',
      job: 'tournament-year.evening-bracket',
      year: '2027',
    });
    expect(events[0]?.contexts?.['tournament_year_incident']).toEqual({
      date: '2026-11-16',
      failed_steps: ['draw'],
      failed_year_count: 1,
      failed_years: [2027],
    });
  });

  test('夜の処理で複数の年が失敗したときは、年をタグに付けずコンテキストに並べる', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['draw', 'progression'],
        failedYears: [2026, 2027],
      },
    ]);

    expect(event?.tags).toEqual({
      tournament_year_incident: 'evening-bracket-failed',
      job: 'tournament-year.evening-bracket',
    });
    expect(event?.contexts?.['tournament_year_incident']).toEqual({
      date: '2026-11-16',
      failed_steps: ['draw', 'progression'],
      failed_year_count: 2,
      failed_years: [2026, 2027],
    });
  });

  test('夜の処理で段だけが失敗したときは、年が空のまま段を添えて送る', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['calendar', 'entry-sync', 'evening-notification'],
        failedYears: [],
      },
    ]);

    expect(event?.tags).toEqual({
      tournament_year_incident: 'evening-bracket-failed',
      job: 'tournament-year.evening-bracket',
    });
    expect(event?.contexts?.['tournament_year_incident']).toEqual({
      date: '2026-11-16',
      failed_steps: ['calendar', 'entry-sync', 'evening-notification'],
      failed_year_count: 0,
      failed_years: [],
    });
  });

  test('4:21の再処理の失敗を、errorで文言をlogentry・理由を指紋に置き、ジョブと年の識別と件数を添えて送る', async () => {
    const events = await reportWithSentry([
      { kind: 'entry-follow-up-failed', years: [2027], entryCount: 3 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: { message: FOLLOW_UP_MESSAGE },
      fingerprint: ['tournament-year', 'entry-follow-up-failed'],
    });
    expect(events[0]?.tags).toEqual({
      tournament_year_incident: 'entry-follow-up-failed',
      job: 'tournament-year.entry-follow-up',
      year: '2027',
    });
    expect(events[0]?.contexts?.['tournament_year_incident']).toEqual({
      years: [2027],
      entry_count: 3,
    });
  });

  test('再処理の対象を読めなかったときは、年が空で件数0のまま送る', async () => {
    const [event] = await reportWithSentry([
      { kind: 'entry-follow-up-failed', years: [], entryCount: 0 },
    ]);

    expect(event?.tags).toEqual({
      tournament_year_incident: 'entry-follow-up-failed',
      job: 'tournament-year.entry-follow-up',
    });
    expect(event?.contexts?.['tournament_year_incident']).toEqual({
      years: [],
      entry_count: 0,
    });
  });

  test('年の形でない値は、タグにもコンテキストにも送らず置き換え、利用者の情報を含めない', async () => {
    const events = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['progression'],
        failedYears: [Number.NaN],
      },
      {
        kind: 'entry-follow-up-failed',
        years: [2027.5, 2027],
        entryCount: 2,
      },
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]?.tags?.['year']).toBe('unknown');
    expect(
      events[0]?.contexts?.['tournament_year_incident']?.['failed_years'],
    ).toEqual(['unknown']);
    expect(
      events[1]?.contexts?.['tournament_year_incident']?.['years'],
    ).toEqual(['unknown', 2027]);
    for (const event of events) {
      expect(event.user).toBeUndefined();
      expect(event.extra).toBeUndefined();
    }
  });

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: YearTournamentIncident = {
      kind: 'entry-follow-up-failed',
      years: [2027],
      entryCount: 1,
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryYearTournamentIncidentReporter(ログ)', () => {
  test('夜の処理の失敗を、ジョブ・業務日付・段・年の識別だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryYearTournamentIncidentReporter();

    reporter.report({
      kind: 'evening-bracket-failed',
      date: DATE,
      failedSteps: ['draw'],
      failedYears: [2027, Number.NaN],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.year-tournament',
      message: EVENING_MESSAGE,
      incident: 'evening-bracket-failed',
      job: 'tournament-year.evening-bracket',
      date: '2026-11-16',
      failedSteps: ['draw'],
      failedYears: [2027, 'unknown'],
    });
  });

  test('再処理の失敗を、ジョブ・年の識別と件数だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryYearTournamentIncidentReporter();

    reporter.report({
      kind: 'entry-follow-up-failed',
      years: [2027],
      entryCount: 4,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.year-tournament',
      message: FOLLOW_UP_MESSAGE,
      incident: 'entry-follow-up-failed',
      job: 'tournament-year.entry-follow-up',
      years: [2027],
      entryCount: 4,
    });
  });
});

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
import { weekTournamentIdOf } from '../../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  configureRecordingLogs,
  createRecordingFetch,
  recordingSentryOptions,
} from '../../../test/support/observability-recording.ts';
import type { WeekTournamentIncident } from '../../application/week-tournament/ports.ts';
import { SentryWeekTournamentIncidentReporter } from './sentry-week-tournament-incident-reporter.ts';

interface SentEvent {
  readonly level?: string;
  readonly logentry?: { readonly message?: string };
  readonly fingerprint?: readonly string[];
  readonly tags?: Record<string, string>;
  readonly contexts?: Record<string, Record<string, unknown>>;
}

const DATE = parseBusinessDate('2026-11-16');

const TOURNAMENT_ID = weekTournamentIdOf(1);

const SECOND_TOURNAMENT_ID = weekTournamentIdOf(2);

const EMAIL = 'owner@mail.example';

const HANDLE = 'launch-owner';

const PRODUCT_NAME = 'すごいプロダクト';

const EVENING_MESSAGE =
  'Weekトーナメントの23:45の夜の処理に失敗し、夜の送り出しの準備の完了を伝えませんでした';

const FOLLOW_UP_MESSAGE =
  'Weekトーナメントの4:21の返金と知らせの再処理に失敗しました';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly WeekTournamentIncident[],
): Promise<SentEvent[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryWeekTournamentIncidentReporter();
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

describe('SentryWeekTournamentIncidentReporter(エラートラッキング)', () => {
  test('23:45の夜の処理の失敗を、errorで文言をlogentry・理由を指紋に置き、ジョブとトーナメントの識別だけをタグに付けて送る', async () => {
    const events = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['draw'],
        failedTournamentIds: [TOURNAMENT_ID],
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: { message: EVENING_MESSAGE },
      fingerprint: ['tournament', 'evening-bracket-failed'],
    });
    expect(events[0]?.tags).toEqual({
      tournament_incident: 'evening-bracket-failed',
      job: 'tournament-week.evening-bracket',
      tournament_id: TOURNAMENT_ID,
    });
    expect(events[0]?.contexts?.['tournament_incident']).toEqual({
      date: '2026-11-16',
      failed_steps: ['draw'],
      failed_tournament_count: 1,
      failed_tournament_ids: [TOURNAMENT_ID],
    });
  });

  test('夜の処理で複数のトーナメントが失敗したときは、トーナメントの識別をタグに付けずコンテキストに並べる', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['draw', 'progression'],
        failedTournamentIds: [TOURNAMENT_ID, SECOND_TOURNAMENT_ID],
      },
    ]);

    expect(event?.tags).toEqual({
      tournament_incident: 'evening-bracket-failed',
      job: 'tournament-week.evening-bracket',
    });
    expect(event?.contexts?.['tournament_incident']).toEqual({
      date: '2026-11-16',
      failed_steps: ['draw', 'progression'],
      failed_tournament_count: 2,
      failed_tournament_ids: [TOURNAMENT_ID, SECOND_TOURNAMENT_ID],
    });
  });

  test('夜の処理で手順だけが失敗したときは、トーナメントが空のまま手順を添えて送る', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['entry-catch-up', 'night-notification'],
        failedTournamentIds: [],
      },
    ]);

    expect(event?.tags).toEqual({
      tournament_incident: 'evening-bracket-failed',
      job: 'tournament-week.evening-bracket',
    });
    expect(event?.contexts?.['tournament_incident']).toEqual({
      date: '2026-11-16',
      failed_steps: ['entry-catch-up', 'night-notification'],
      failed_tournament_count: 0,
      failed_tournament_ids: [],
    });
  });

  test('4:21の再処理の失敗を、errorで文言をlogentry・理由を指紋に置き、ジョブとトーナメントの識別と件数を添えて送る', async () => {
    const events = await reportWithSentry([
      {
        kind: 'entry-follow-up-failed',
        tournamentIds: [TOURNAMENT_ID],
        entryCount: 3,
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'error',
      logentry: { message: FOLLOW_UP_MESSAGE },
      fingerprint: ['tournament', 'entry-follow-up-failed'],
    });
    expect(events[0]?.tags).toEqual({
      tournament_incident: 'entry-follow-up-failed',
      job: 'tournament-week.entry-follow-up',
      tournament_id: TOURNAMENT_ID,
    });
    expect(events[0]?.contexts?.['tournament_incident']).toEqual({
      tournament_ids: [TOURNAMENT_ID],
      entry_count: 3,
    });
  });

  test('再処理の対象を読めなかったときは、トーナメントが空で件数0のまま送る', async () => {
    const [event] = await reportWithSentry([
      { kind: 'entry-follow-up-failed', tournamentIds: [], entryCount: 0 },
    ]);

    expect(event?.tags).toEqual({
      tournament_incident: 'entry-follow-up-failed',
      job: 'tournament-week.entry-follow-up',
    });
    expect(event?.contexts?.['tournament_incident']).toEqual({
      tournament_ids: [],
      entry_count: 0,
    });
  });

  test('識別子の形でない値は、タグにもコンテキストにも送らず置き換え、プロダクトの名称・メールアドレス・ハンドルを含めない', async () => {
    const events = await reportWithSentry([
      {
        kind: 'evening-bracket-failed',
        date: DATE,
        failedSteps: ['progression'],
        failedTournamentIds: [EMAIL],
      },
      {
        kind: 'entry-follow-up-failed',
        tournamentIds: [HANDLE, PRODUCT_NAME],
        entryCount: 2,
      },
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]?.tags?.['tournament_id']).toBe('unknown');
    expect(
      events[0]?.contexts?.['tournament_incident']?.['failed_tournament_ids'],
    ).toEqual(['unknown']);
    expect(
      events[1]?.contexts?.['tournament_incident']?.['tournament_ids'],
    ).toEqual(['unknown', 'unknown']);
    const sent = JSON.stringify(events);
    expect(sent).not.toContain(EMAIL);
    expect(sent).not.toContain(HANDLE);
    expect(sent).not.toContain(PRODUCT_NAME);
  });

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: WeekTournamentIncident = {
      kind: 'entry-follow-up-failed',
      tournamentIds: [TOURNAMENT_ID],
      entryCount: 1,
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryWeekTournamentIncidentReporter(ログ)', () => {
  test('夜の処理の失敗を、ジョブ・日付・手順・トーナメントの識別だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryWeekTournamentIncidentReporter();

    reporter.report({
      kind: 'evening-bracket-failed',
      date: DATE,
      failedSteps: ['draw'],
      failedTournamentIds: [TOURNAMENT_ID, EMAIL],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.week-tournament',
      message: EVENING_MESSAGE,
      incident: 'evening-bracket-failed',
      job: 'tournament-week.evening-bracket',
      date: '2026-11-16',
      failedSteps: ['draw'],
      failedTournamentIds: [TOURNAMENT_ID, 'unknown'],
    });
  });

  test('再処理の失敗を、ジョブ・トーナメントの識別と件数だけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryWeekTournamentIncidentReporter();

    reporter.report({
      kind: 'entry-follow-up-failed',
      tournamentIds: [TOURNAMENT_ID],
      entryCount: 4,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.week-tournament',
      message: FOLLOW_UP_MESSAGE,
      incident: 'entry-follow-up-failed',
      job: 'tournament-week.entry-follow-up',
      tournamentIds: [TOURNAMENT_ID],
      entryCount: 4,
    });
  });
});

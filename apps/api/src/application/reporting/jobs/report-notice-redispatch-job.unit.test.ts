import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import type {
  ReportIncident,
  ReportIncidentContext,
  ReportIncidentReporter,
  ReportNoticeStore,
  ReportNotifier,
} from '../ports.ts';
import { REPORTING_TYPES } from '../reporting-types.ts';
import {
  REPORT_NOTICE_REDISPATCH_JOB_DEFINITION,
  REPORT_NOTICE_REDISPATCH_LIMIT,
  ReportNoticeRedispatchJob,
} from './report-notice-redispatch-job.ts';

// 業務日付2026-11-22の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-22T12:21:00.000Z');
const ONE_HOUR_BEFORE = new Date('2026-11-22T11:21:00.000Z');
const JOB_NAME = 'content-reporting.notice-redispatch';
const CATEGORY = 'api.reporting.notice-redispatch';

const CONTEXT: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: {
    date: parseBusinessDate('2026-11-22'),
    weekday: 7,
    hour: 4,
    minute: 21,
  },
};

const caseIdOf = (index: number): string =>
  `01JQ0CAS${String(index).padStart(18, '0')}`;

const NOTHING = { requested: 0, skipped: 0 };

interface FakeOptions {
  readonly caseIds?: readonly string[];
  readonly dispatch?: (
    caseId: string,
  ) => Promise<{ readonly requested: number; readonly skipped: number }>;
  readonly listError?: Error;
}

function createJob(options: FakeOptions = {}) {
  const steps: string[] = [];
  const listCalls: { readonly closedBefore: Date; readonly limit: number }[] =
    [];
  const reports: {
    readonly incident: ReportIncident;
    readonly context: ReportIncidentContext;
  }[] = [];
  const notices: Pick<ReportNoticeStore, 'listCasesWithPendingNotices'> = {
    listCasesWithPendingNotices: (input) => {
      steps.push('list');
      listCalls.push(input);
      return options.listError === undefined
        ? Promise.resolve(options.caseIds ?? [])
        : Promise.reject(options.listError);
    },
  };
  const notifier: ReportNotifier = {
    dispatch: (caseId) => {
      steps.push(`dispatch:${caseId}`);
      return (
        options.dispatch?.(caseId) ??
        Promise.resolve({ requested: 1, skipped: 0 })
      );
    },
  };
  const reporter: ReportIncidentReporter = {
    report: (incident, context) => {
      steps.push(`report:${incident}`);
      reports.push({ incident, context });
    },
  };
  const job = new ReportNoticeRedispatchJob(
    notices as ReportNoticeStore,
    notifier,
    reporter,
  );
  return { job, steps, listCalls, reports };
}

const records: LogRecord[] = [];

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

function logsOfJob() {
  return records
    .filter((record) => record.category.join('.') === CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

describe('REPORT_NOTICE_REDISPATCH_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 2000で通知の送り直しのジョブを登録する凍結した定義である', () => {
    expect(REPORT_NOTICE_REDISPATCH_JOB_DEFINITION).toEqual({
      name: JOB_NAME,
      at: { hour: 4, minute: 21 },
      order: 2000,
      handler: REPORTING_TYPES.ReportNoticeRedispatchJob,
    });
    expect(Object.isFrozen(REPORT_NOTICE_REDISPATCH_JOB_DEFINITION)).toBe(true);
    expect(Object.isFrozen(REPORT_NOTICE_REDISPATCH_JOB_DEFINITION.at)).toBe(
      true,
    );
  });
});

describe('ReportNoticeRedispatchJob', () => {
  test('予定時刻の1時間前までに完了した依頼待ちの案件を100件まで読み、完了の古い順に送り直して件数をinfoで記録する', async () => {
    const counts: Readonly<
      Record<string, { readonly requested: number; readonly skipped: number }>
    > = {
      [caseIdOf(1)]: { requested: 2, skipped: 0 },
      [caseIdOf(2)]: { requested: 0, skipped: 1 },
      [caseIdOf(3)]: { requested: 1, skipped: 2 },
    };
    const { job, steps, listCalls, reports } = createJob({
      caseIds: [caseIdOf(1), caseIdOf(2), caseIdOf(3)],
      dispatch: (caseId) => Promise.resolve(counts[caseId] ?? NOTHING),
    });

    await job.run(CONTEXT);

    expect(REPORT_NOTICE_REDISPATCH_LIMIT).toBe(100);
    expect(listCalls).toEqual([{ closedBefore: ONE_HOUR_BEFORE, limit: 100 }]);
    expect(steps).toEqual([
      'list',
      `dispatch:${caseIdOf(1)}`,
      `dispatch:${caseIdOf(2)}`,
      `dispatch:${caseIdOf(3)}`,
    ]);
    expect(reports).toEqual([]);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          found: 3,
          requested: 3,
          skipped: 3,
          idle: 0,
          failed: 0,
        },
      },
    ]);
  });

  test('送り直しに失敗した案件があっても残りの案件を送り、失敗の件数をエラートラッキングへ1回だけ知らせてジョブは成功で終える', async () => {
    const cause = new Error('メールの送信を依頼できませんでした');
    const { job, steps, reports } = createJob({
      caseIds: [caseIdOf(1), caseIdOf(2), caseIdOf(3)],
      dispatch: (caseId) =>
        caseId === caseIdOf(3)
          ? Promise.resolve({ requested: 1, skipped: 0 })
          : Promise.reject(cause),
    });

    await job.run(CONTEXT);

    expect(steps).toEqual([
      'list',
      `dispatch:${caseIdOf(1)}`,
      `dispatch:${caseIdOf(2)}`,
      `dispatch:${caseIdOf(3)}`,
      'report:notice-redispatch-failed',
    ]);
    expect(reports).toEqual([
      {
        incident: 'notice-redispatch-failed',
        context: { job: JOB_NAME, count: 2 },
      },
    ]);
    expect(logsOfJob()).toEqual([
      {
        level: 'warning',
        properties: { caseId: caseIdOf(1), error: cause },
      },
      {
        level: 'warning',
        properties: { caseId: caseIdOf(2), error: cause },
      },
      {
        level: 'info',
        properties: {
          found: 3,
          requested: 1,
          skipped: 0,
          idle: 0,
          failed: 2,
        },
      },
    ]);
  });

  test('読んだ後に再開や別の送信で依頼待ちが無くなり何も進まなかった案件は、失敗とせず何も進めなかった件数に数える', async () => {
    const { job, reports } = createJob({
      caseIds: [caseIdOf(1), caseIdOf(2)],
      dispatch: (caseId) =>
        Promise.resolve(
          caseId === caseIdOf(1) ? NOTHING : { requested: 1, skipped: 0 },
        ),
    });

    await job.run(CONTEXT);

    expect(reports).toEqual([]);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          found: 2,
          requested: 1,
          skipped: 0,
          idle: 1,
          failed: 0,
        },
      },
    ]);
  });

  test('対象が無ければ何も送らず0件を記録する', async () => {
    const { job, steps } = createJob();

    await job.run(CONTEXT);

    expect(steps).toEqual(['list']);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          found: 0,
          requested: 0,
          skipped: 0,
          idle: 0,
          failed: 0,
        },
      },
    ]);
  });

  test('依頼待ちの案件を読めなければ例外をそのまま定期実行の記録へ投げ、エラートラッキングへの定型の通知は送らない', async () => {
    const cause = new Error('D1に接続できません');
    const { job, steps, reports } = createJob({ listError: cause });

    const failure = await job.run(CONTEXT).catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(steps).toEqual(['list']);
    expect(reports).toEqual([]);
    expect(logsOfJob()).toEqual([]);
  });

  test('起動が遅れても、同じ予定時刻で再び実行すれば同じ閾値で依頼待ちの案件を選ぶ', async () => {
    const { job, listCalls } = createJob();

    await job.run(CONTEXT);
    await job.run(CONTEXT);

    expect(listCalls).toEqual([
      { closedBefore: ONE_HOUR_BEFORE, limit: 100 },
      { closedBefore: ONE_HOUR_BEFORE, limit: 100 },
    ]);
  });
});

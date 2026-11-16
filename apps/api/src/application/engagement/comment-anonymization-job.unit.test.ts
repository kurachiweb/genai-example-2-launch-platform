import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { EngagementErasureStore } from '../../../lib/core/engagement/ports.ts';
import type { ScheduledJobContext } from '../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
  toUtcCronExpression,
} from '../../../lib/core/time/business-time.ts';
import {
  COMMENT_ANONYMIZATION_BATCH_SIZE,
  COMMENT_ANONYMIZATION_JOB_DEFINITION,
  COMMENT_ANONYMIZATION_MAX_BATCHES,
  CommentAnonymizationJob,
} from './comment-anonymization-job.ts';
import { ENGAGEMENT_TYPES } from './engagement-types.ts';
import type { EngagementIncident } from './ports.ts';

const MAINTENANCE_TIME = Object.freeze({ hour: 4, minute: 21 });
const MIDNIGHT = Object.freeze({ hour: 0, minute: 0 });
const JOB_DATE = parseBusinessDate('2026-11-20');
const NEXT_DATE = parseBusinessDate('2026-11-21');
const NOW = new Date(
  fromBusinessDateTime(JOB_DATE, MAINTENANCE_TIME).getTime() + 5_000,
);

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

function engagementLogs() {
  return records
    .filter(
      (record) => record.category.join('.') === 'api.application.engagement',
    )
    .map(({ level, properties }) => ({ level, properties }));
}

function contextOf(date: BusinessDate): ScheduledJobContext {
  const scheduledTime = fromBusinessDateTime(date, MAINTENANCE_TIME);
  return {
    scheduledTime,
    cron: toUtcCronExpression(MAINTENANCE_TIME),
    business: toBusinessDateTime(scheduledTime),
  };
}

function midnightOf(value: string): Date {
  return fromBusinessDateTime(parseBusinessDate(value), MIDNIGHT);
}

interface FakeComment {
  readonly id: number;
  readonly deletedAt: Date | null;
  anonymizedAt: Date | null;
}

interface AnonymizeCall {
  readonly threshold: Date;
  readonly at: Date;
  readonly limit: number;
}

// 削除の日時が閾値より前で未匿名化のコメントを、削除の古い順に上限まで匿名化する偽物
function createFakeErasureStore(
  comments: readonly Pick<FakeComment, 'id' | 'deletedAt'>[],
  options: { readonly anonymizeFailure?: Error } = {},
) {
  const rows: FakeComment[] = comments.map((comment) => ({
    ...comment,
    anonymizedAt: null,
  }));
  const anonymizeCalls: AnonymizeCall[] = [];
  const overdueThresholds: Date[] = [];
  const pending = (threshold: Date) =>
    rows
      .filter(
        (row) =>
          row.deletedAt !== null &&
          row.deletedAt.getTime() < threshold.getTime() &&
          row.anonymizedAt === null,
      )
      .toSorted(
        (left, right) =>
          (left.deletedAt?.getTime() ?? 0) - (right.deletedAt?.getTime() ?? 0),
      );
  const store: EngagementErasureStore = {
    anonymizeDeletedBefore(input) {
      anonymizeCalls.push(input);
      if (options.anonymizeFailure !== undefined) {
        return Promise.reject(options.anonymizeFailure);
      }
      const targets = pending(input.threshold).slice(0, input.limit);
      for (const target of targets) {
        target.anonymizedAt = input.at;
      }
      return Promise.resolve(targets.length);
    },
    countOverdue(threshold) {
      overdueThresholds.push(threshold);
      return Promise.resolve(pending(threshold).length);
    },
    eraseAccount() {
      throw new Error('この偽物では使わない: eraseAccount');
    },
    eraseProduct() {
      throw new Error('この偽物では使わない: eraseProduct');
    },
  };
  const anonymizedIds = () =>
    rows
      .filter((row) => row.anonymizedAt !== null)
      .map(({ id }) => id)
      .toSorted((left, right) => left - right);
  return { store, anonymizeCalls, overdueThresholds, anonymizedIds };
}

function jobOf(
  store: EngagementErasureStore,
  incidents: EngagementIncident[] = [],
) {
  return new CommentAnonymizationJob(
    store,
    {
      report: (incident) => {
        incidents.push(incident);
      },
    },
    { now: () => NOW },
  );
}

function deletedComments(count: number, deletedAt: Date) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    deletedAt: new Date(deletedAt.getTime() + index),
  }));
}

const LONG_AGO = midnightOf('2026-10-01');

describe('COMMENT_ANONYMIZATION_JOB_DEFINITION', () => {
  test('名前engagement.comment-anonymization・業務時刻4:21・order 1400で、匿名化のジョブの識別子を指す', () => {
    expect(COMMENT_ANONYMIZATION_JOB_DEFINITION).toEqual({
      name: 'engagement.comment-anonymization',
      at: { hour: 4, minute: 21 },
      order: 1400,
      handler: ENGAGEMENT_TYPES.CommentAnonymizationJob,
    });
  });

  test('定義と時刻は実行時に書き換えられない', () => {
    expect(Object.isFrozen(COMMENT_ANONYMIZATION_JOB_DEFINITION)).toBe(true);
    expect(Object.isFrozen(COMMENT_ANONYMIZATION_JOB_DEFINITION.at)).toBe(true);
  });

  test('本機能のジョブの順は、割り当てられた1400番台の帯に収まる', () => {
    expect(COMMENT_ANONYMIZATION_JOB_DEFINITION.order).toBeGreaterThanOrEqual(
      1400,
    );
    expect(COMMENT_ANONYMIZATION_JOB_DEFINITION.order).toBeLessThan(1500);
  });
});

describe('CommentAnonymizationJob(4:21)', () => {
  test('業務日付の12日前の0:00を閾値にし、時計の現在の時刻を匿名化の日時として500件ずつ渡す', async () => {
    const { store, anonymizeCalls } = createFakeErasureStore([]);

    await jobOf(store).run(contextOf(JOB_DATE));

    expect(anonymizeCalls).toEqual([
      { threshold: midnightOf('2026-11-08'), at: NOW, limit: 500 },
    ]);
    expect(COMMENT_ANONYMIZATION_BATCH_SIZE).toBe(500);
  });

  test('期限を過ぎた残りは、業務日付の13日前の0:00を閾値にして数える', async () => {
    const { store, overdueThresholds } = createFakeErasureStore([]);

    await jobOf(store).run(contextOf(JOB_DATE));

    expect(overdueThresholds).toEqual([midnightOf('2026-11-07')]);
  });

  test('閾値は業務日付で決まり、月をまたぐ日付も前月の日付の0:00になる', async () => {
    const { store, anonymizeCalls, overdueThresholds } = createFakeErasureStore(
      [],
    );

    await jobOf(store).run(contextOf(parseBusinessDate('2026-12-05')));

    expect(anonymizeCalls[0]?.threshold).toEqual(midnightOf('2026-11-23'));
    expect(overdueThresholds).toEqual([midnightOf('2026-11-22')]);
  });

  test('閾値の直前に削除したコメントはその日に匿名化し、閾値ちょうどに削除したコメントは翌日の実行で匿名化する', async () => {
    const threshold = midnightOf('2026-11-08');
    const { store, anonymizedIds } = createFakeErasureStore([
      { id: 1, deletedAt: new Date(threshold.getTime() - 1) },
      { id: 2, deletedAt: threshold },
      { id: 3, deletedAt: null },
    ]);
    const job = jobOf(store);

    await job.run(contextOf(JOB_DATE));
    const afterFirstDay = anonymizedIds();
    await job.run(contextOf(NEXT_DATE));

    expect(afterFirstDay).toEqual([1]);
    expect(anonymizedIds()).toEqual([1, 2]);
  });

  test('匿名化した件数が500件未満になったら、その回で止める', async () => {
    const { store, anonymizeCalls, anonymizedIds } = createFakeErasureStore(
      deletedComments(COMMENT_ANONYMIZATION_BATCH_SIZE * 2 + 1, LONG_AGO),
    );

    await jobOf(store).run(contextOf(JOB_DATE));

    expect(anonymizeCalls).toHaveLength(3);
    expect(anonymizedIds()).toHaveLength(
      COMMENT_ANONYMIZATION_BATCH_SIZE * 2 + 1,
    );
  });

  test('ちょうど500件の倍数なら、0件を返す回まで続けて止める', async () => {
    const { store, anonymizeCalls } = createFakeErasureStore(
      deletedComments(COMMENT_ANONYMIZATION_BATCH_SIZE, LONG_AGO),
    );

    await jobOf(store).run(contextOf(JOB_DATE));

    expect(anonymizeCalls).toHaveLength(2);
  });

  test('1回の実行で最大10回(5,000件)までに止め、残りを翌日の実行で匿名化する', async () => {
    const total =
      COMMENT_ANONYMIZATION_BATCH_SIZE * COMMENT_ANONYMIZATION_MAX_BATCHES + 7;
    const { store, anonymizeCalls, anonymizedIds } = createFakeErasureStore(
      deletedComments(total, LONG_AGO),
    );
    const job = jobOf(store);

    await job.run(contextOf(JOB_DATE));
    const firstDayCalls = anonymizeCalls.length;
    const afterFirstDay = anonymizedIds().length;
    await job.run(contextOf(NEXT_DATE));

    expect(COMMENT_ANONYMIZATION_MAX_BATCHES).toBe(10);
    expect(firstDayCalls).toBe(10);
    expect(afterFirstDay).toBe(5_000);
    expect(anonymizedIds()).toHaveLength(total);
  });

  test('期限を過ぎた残りがあれば、件数を添えた期限超過の報告を1回だけ送る', async () => {
    const total =
      COMMENT_ANONYMIZATION_BATCH_SIZE * COMMENT_ANONYMIZATION_MAX_BATCHES + 7;
    const { store } = createFakeErasureStore(deletedComments(total, LONG_AGO));
    const incidents: EngagementIncident[] = [];

    await jobOf(store, incidents).run(contextOf(JOB_DATE));

    expect(incidents).toEqual([
      { kind: 'comment-anonymization-overdue', count: 7 },
    ]);
    const summary = engagementLogs().find(({ level }) => level === 'info');
    expect(summary?.properties).toMatchObject({ overdue: 7 });
  });

  test('匿名化が失敗しても期限を過ぎた残りを数えて報告し、匿名化の失敗を投げる', async () => {
    const failure = new Error('匿名化の文が失敗した');
    const { store, overdueThresholds } = createFakeErasureStore(
      deletedComments(3, LONG_AGO),
      { anonymizeFailure: failure },
    );
    const incidents: EngagementIncident[] = [];

    const thrown = await jobOf(store, incidents)
      .run(contextOf(JOB_DATE))
      .catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(overdueThresholds).toEqual([midnightOf('2026-11-07')]);
    expect(incidents).toEqual([
      { kind: 'comment-anonymization-overdue', count: 3 },
    ]);
  });

  test('期限を過ぎた残りが無ければ報告を送らず、件数の要約だけをinfoのログに出す', async () => {
    const { store } = createFakeErasureStore(
      deletedComments(COMMENT_ANONYMIZATION_BATCH_SIZE + 3, LONG_AGO),
    );
    const incidents: EngagementIncident[] = [];

    await jobOf(store, incidents).run(contextOf(JOB_DATE));

    expect(incidents).toEqual([]);

    expect(engagementLogs()).toEqual([
      {
        level: 'info',
        properties: {
          anonymized: COMMENT_ANONYMIZATION_BATCH_SIZE + 3,
          batches: 2,
          limitReached: false,
          overdue: 0,
        },
      },
    ]);
  });

  test('上限の回数に達して止めたことを、要約のlimitReachedで示す', async () => {
    const { store } = createFakeErasureStore(
      deletedComments(
        COMMENT_ANONYMIZATION_BATCH_SIZE * COMMENT_ANONYMIZATION_MAX_BATCHES,
        LONG_AGO,
      ),
    );

    await jobOf(store).run(contextOf(JOB_DATE));

    const summary = engagementLogs().find(({ level }) => level === 'info');
    expect(summary?.properties).toEqual({
      anonymized: 5_000,
      batches: 10,
      limitReached: true,
      overdue: 0,
    });
  });

  test('同じ日に再実行しても、匿名化したコメントは変わらず、新たに匿名化しない', async () => {
    const threshold = midnightOf('2026-11-08');
    const { store, anonymizedIds } = createFakeErasureStore([
      { id: 1, deletedAt: new Date(threshold.getTime() - 60_000) },
      { id: 2, deletedAt: new Date(threshold.getTime() - 1) },
      { id: 3, deletedAt: new Date(threshold.getTime() + 1) },
    ]);
    const job = jobOf(store);

    await job.run(contextOf(JOB_DATE));
    const afterFirstRun = anonymizedIds();
    records.length = 0;
    await job.run(contextOf(JOB_DATE));

    expect(afterFirstRun).toEqual([1, 2]);
    expect(anonymizedIds()).toEqual([1, 2]);
    expect(engagementLogs()).toEqual([
      {
        level: 'info',
        properties: {
          anonymized: 0,
          batches: 1,
          limitReached: false,
          overdue: 0,
        },
      },
    ]);
  });
});

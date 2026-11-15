import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { createCronRegistry } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import { ULTRAS_TYPES } from '../../../../lib/core/ultras/identifiers.ts';
import type {
  ActivationDispatcher,
  ActivationStore,
  NoticeStore,
  UltrasActivationRow,
  UltrasNoticeRow,
  UltrasNotifier,
} from '../../../../lib/core/ultras/ports.ts';
import { API_ULTRAS_TYPES } from '../ultras-types.ts';
import {
  PENDING_DISPATCH_SWEEP_JOB_DEFINITION,
  PENDING_NOTICE_LIMIT,
  PendingDispatchSweepJob,
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_DELETE_MAX_BATCHES,
  UNDISPATCHED_ACTIVATION_LIMIT,
} from './pending-dispatch-sweep-job.ts';

const CRON = '21 12 * * *';
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// 業務時刻(UTC-08:00)の4:21の起動
const SWEEP_TIME = new Date('2027-04-06T12:21:00.000Z');
const TEN_MINUTES_BEFORE = new Date(SWEEP_TIME.getTime() - 10 * MINUTE_MS);
const ONE_DAY_BEFORE = new Date(SWEEP_TIME.getTime() - DAY_MS);
const THIRTY_DAYS_BEFORE = new Date(SWEEP_TIME.getTime() - 30 * DAY_MS);

const LOG_CATEGORY = 'api.application.ultras';

type SendOutcome = Awaited<ReturnType<UltrasNotifier['send']>>;

type Phase =
  'redispatch' | 'notices' | 'activation-retention' | 'notice-retention';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: { memory: (record) => records.push(record) },
    loggers: [
      { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
      { category: ['api'], lowestLevel: 'debug', sinks: ['memory'] },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function ultrasLogs() {
  return records
    .filter((record) => record.category.join('.') === LOG_CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

function summaryOf() {
  return ultrasLogs().find(({ level }) => level === 'info')?.properties;
}

// 使わないメソッドを呼んだら失敗させ、ジョブが想定外のポートに触れたことを検出する。DIコンテナが束縛した値をPromiseか判定するthenは持たないものとして返す
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      if (property === 'then') {
        return undefined;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

function ulidOf(prefix: string, serial: number): string {
  return `${prefix}${String(serial).padStart(26 - prefix.length, '0')}`;
}

function activationOf(serial: number): UltrasActivationRow {
  return {
    id: ulidOf('01ACT', serial),
    userId: ulidOf('01USR', 1),
    stripeSubscriptionId: `sub_${String(serial)}`,
    activatedAt: ONE_DAY_BEFORE,
    dispatchedAt: null,
    completedAt: null,
    createdAt: ONE_DAY_BEFORE,
  };
}

function noticeOf(serial: number): UltrasNoticeRow {
  return {
    id: ulidOf('01NTC', serial),
    userId: ulidOf('01USR', 1),
    stripeSubscriptionId: `sub_${String(serial)}`,
    kind: 'payment_failed',
    dedupeKey: `payment_failed:sub_${String(serial)}`,
    payload: {},
    status: 'pending',
    finishedAt: null,
    createdAt: ONE_DAY_BEFORE,
  };
}

interface ActivationQuery {
  readonly createdBefore: Date;
  readonly redispatchBefore: Date;
  readonly limit: number;
}

interface ThresholdQuery {
  readonly threshold: Date;
  readonly limit: number;
}

interface SweepCalls {
  readonly undispatched: ActivationQuery[];
  readonly dispatched: string[];
  readonly pending: ThresholdQuery[];
  readonly sent: string[];
  readonly activationDeletes: ThresholdQuery[];
  readonly noticeDeletes: ThresholdQuery[];
}

interface SweepSetup {
  readonly undispatched?: readonly UltrasActivationRow[] | Error;
  readonly pending?: readonly UltrasNoticeRow[] | Error;
  readonly sendOutcomes?: ReadonlyMap<string, SendOutcome | Error>;
  // 削除の呼び出しごとに返す件数。尽きたら最後の値を繰り返す
  readonly activationDeleteCounts?: readonly number[] | Error;
  readonly noticeDeleteCounts?: readonly number[] | Error;
}

function countsOf(
  counts: readonly number[] | Error,
  calls: ThresholdQuery[],
): (threshold: Date, limit: number) => Promise<number> {
  let index = 0;
  return (threshold, limit) => {
    if (counts instanceof Error) {
      return Promise.reject(counts);
    }
    calls.push({ threshold, limit });
    const count = counts[Math.min(index, counts.length - 1)] ?? 0;
    index += 1;
    return Promise.resolve(count);
  };
}

function createDependencies(options: SweepSetup = {}) {
  const calls: SweepCalls = {
    undispatched: [],
    dispatched: [],
    pending: [],
    sent: [],
    activationDeletes: [],
    noticeDeletes: [],
  };
  const activations = partialFake<ActivationStore>({
    findUndispatched: (input) => {
      if (options.undispatched instanceof Error) {
        return Promise.reject(options.undispatched);
      }
      calls.undispatched.push(input);
      return Promise.resolve(options.undispatched ?? []);
    },
    deleteCompletedBefore: countsOf(
      options.activationDeleteCounts ?? [0],
      calls.activationDeletes,
    ),
  });
  const notices = partialFake<NoticeStore>({
    findPendingBefore: (threshold, limit) => {
      if (options.pending instanceof Error) {
        return Promise.reject(options.pending);
      }
      calls.pending.push({ threshold, limit });
      return Promise.resolve(options.pending ?? []);
    },
    deleteFinishedBefore: countsOf(
      options.noticeDeleteCounts ?? [0],
      calls.noticeDeletes,
    ),
  });
  const dispatcher = partialFake<ActivationDispatcher>({
    dispatch: (activationId) => {
      calls.dispatched.push(activationId);
      return Promise.resolve();
    },
  });
  const notifier = partialFake<UltrasNotifier>({
    send: (notice) => {
      calls.sent.push(notice.id);
      const outcome = options.sendOutcomes?.get(notice.id) ?? 'requested';
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  });
  return { calls, activations, notices, dispatcher, notifier };
}

function setup(options: SweepSetup = {}) {
  const { calls, activations, notices, dispatcher, notifier } =
    createDependencies(options);
  const job = new PendingDispatchSweepJob(
    activations,
    notices,
    dispatcher,
    notifier,
  );
  return { job, calls };
}

const run = (job: PendingDispatchSweepJob) =>
  job.run({
    scheduledTime: SWEEP_TIME,
    cron: CRON,
    business: toBusinessDateTime(SWEEP_TIME),
  });

const EMPTY_RETENTION = { deleted: 0, batches: 1, limitReached: false };

const EMPTY_SUMMARY = {
  redispatch: { targets: 0 },
  notices: { targets: 0, requested: 0, skipped: 0, failed: 0 },
  retention: { activations: EMPTY_RETENTION, notices: EMPTY_RETENTION },
};

describe('PENDING_DISPATCH_SWEEP_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 500で送り出し直しと後始末のジョブを登録する定義である', () => {
    expect(PENDING_DISPATCH_SWEEP_JOB_DEFINITION).toEqual({
      name: 'ultras-subscription.pending-dispatch-sweep',
      at: { hour: 4, minute: 21 },
      order: 500,
      handler: API_ULTRAS_TYPES.PendingDispatchSweepJob,
    });
  });

  test('ジョブの定義の検証を通り、4:21の起動の式21 12 * * *で動く', () => {
    const registry = createCronRegistry([
      PENDING_DISPATCH_SWEEP_JOB_DEFINITION,
    ]);

    expect(registry.cronExpressions()).toEqual([CRON]);
  });
});

describe('PendingDispatchSweepJob', () => {
  test('作成から10分・送り出しから24時間経った未送り出しの知らせを最大100件、依頼待ちのまま10分経ったメールの依頼を最大100件探し、30日以上前の記録を500件ずつ消す', async () => {
    const { job, calls } = setup();

    await run(job);

    expect([
      UNDISPATCHED_ACTIVATION_LIMIT,
      PENDING_NOTICE_LIMIT,
      RETENTION_DELETE_BATCH_SIZE,
      RETENTION_DELETE_MAX_BATCHES,
    ]).toEqual([100, 100, 500, 20]);
    expect(calls.undispatched).toEqual([
      {
        createdBefore: TEN_MINUTES_BEFORE,
        redispatchBefore: ONE_DAY_BEFORE,
        limit: 100,
      },
    ]);
    expect(calls.pending).toEqual([
      { threshold: TEN_MINUTES_BEFORE, limit: 100 },
    ]);
    expect(calls.activationDeletes).toEqual([
      { threshold: THIRTY_DAYS_BEFORE, limit: 500 },
    ]);
    expect(calls.noticeDeletes).toEqual([
      { threshold: THIRTY_DAYS_BEFORE, limit: 500 },
    ]);
    expect(ultrasLogs()).toEqual([
      { level: 'info', properties: EMPTY_SUMMARY },
    ]);
  });

  test('未送り出しの知らせを見つけた順に1件ずつ送り出す', async () => {
    const first = activationOf(1);
    const second = activationOf(2);
    const { job, calls } = setup({ undispatched: [first, second] });

    await run(job);

    expect(calls.dispatched).toEqual([first.id, second.id]);
    expect(summaryOf()).toEqual({
      ...EMPTY_SUMMARY,
      redispatch: { targets: 2 },
    });
  });

  test('依頼待ちのメールを1件ずつ依頼し、1件の依頼が失敗しても依頼のIDを添えて警告し、残りの依頼を続ける', async () => {
    const failure = new Error('メールの送信を依頼できません');
    const requested = noticeOf(1);
    const throwing = noticeOf(2);
    const skipped = noticeOf(3);
    const { job, calls } = setup({
      pending: [requested, throwing, skipped],
      sendOutcomes: new Map<string, SendOutcome | Error>([
        [throwing.id, failure],
        [skipped.id, 'skipped'],
      ]),
    });

    await run(job);

    expect(calls.sent).toEqual([requested.id, throwing.id, skipped.id]);
    expect(ultrasLogs()).toEqual([
      {
        level: 'warning',
        properties: { noticeId: throwing.id, error: failure },
      },
      {
        level: 'info',
        properties: {
          ...EMPTY_SUMMARY,
          notices: { targets: 3, requested: 1, skipped: 1, failed: 1 },
        },
      },
    ]);
  });

  test('保持期間を過ぎた記録の削除は500件消えた間だけ繰り返し、500件に満たなければ止める', async () => {
    const { job, calls } = setup({
      activationDeleteCounts: [500, 500, 3],
      noticeDeleteCounts: [2],
    });

    await run(job);

    expect(calls.activationDeletes).toHaveLength(3);
    expect(calls.noticeDeletes).toHaveLength(1);
    expect(summaryOf()).toEqual({
      ...EMPTY_SUMMARY,
      retention: {
        activations: { deleted: 1003, batches: 3, limitReached: false },
        notices: { deleted: 2, batches: 1, limitReached: false },
      },
    });
  });

  test('削除の繰り返しは最大20回で止め、上限に達したことを要約に残す', async () => {
    const { job, calls } = setup({
      activationDeleteCounts: [500],
      noticeDeleteCounts: [500],
    });

    await run(job);

    expect(calls.activationDeletes).toHaveLength(20);
    expect(calls.noticeDeletes).toHaveLength(20);
    expect(summaryOf()).toEqual({
      ...EMPTY_SUMMARY,
      retention: {
        activations: { deleted: 10_000, batches: 20, limitReached: true },
        notices: { deleted: 10_000, batches: 20, limitReached: true },
      },
    });
  });

  const failure = new Error('D1に接続できません');

  // 送り出し1件とメールの依頼1件が成功したときの要約
  const FULL_SUMMARY = {
    ...EMPTY_SUMMARY,
    redispatch: { targets: 1 },
    notices: { targets: 1, requested: 1, skipped: 0, failed: 0 },
  };

  function summaryFailingAt(phases: readonly Phase[]) {
    const failedAt = (phase: Phase) => phases.includes(phase);
    return {
      redispatch: failedAt('redispatch') ? 'failed' : FULL_SUMMARY.redispatch,
      notices: failedAt('notices') ? 'failed' : FULL_SUMMARY.notices,
      retention: {
        activations: failedAt('activation-retention')
          ? 'failed'
          : EMPTY_RETENTION,
        notices: failedAt('notice-retention') ? 'failed' : EMPTY_RETENTION,
      },
    };
  }

  function ranPhases(calls: SweepCalls): Record<Phase, boolean> {
    return {
      redispatch: calls.dispatched.length > 0,
      notices: calls.sent.length > 0,
      'activation-retention': calls.activationDeletes.length > 0,
      'notice-retention': calls.noticeDeletes.length > 0,
    };
  }

  const ALL_RAN: Record<Phase, boolean> = {
    redispatch: true,
    notices: true,
    'activation-retention': true,
    'notice-retention': true,
  };

  test.each<{ readonly phase: Phase; readonly options: SweepSetup }>([
    { phase: 'redispatch', options: { undispatched: failure } },
    { phase: 'notices', options: { pending: failure } },
    {
      phase: 'activation-retention',
      options: { activationDeleteCounts: failure },
    },
    { phase: 'notice-retention', options: { noticeDeleteCounts: failure } },
  ])(
    '処理($phase)が失敗しても残りの処理を続け、要約を残した後に失敗した処理の名前を含む例外で終える',
    async ({ phase, options }) => {
      const { job, calls } = setup({
        undispatched: [activationOf(1)],
        pending: [noticeOf(1)],
        ...options,
      });

      const thrown = await run(job).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(phase);
      expect((thrown as Error).cause).toBe(failure);
      expect(ranPhases(calls)).toEqual({ ...ALL_RAN, [phase]: false });
      expect(ultrasLogs()).toEqual([
        { level: 'warning', properties: { phase, error: failure } },
        { level: 'info', properties: summaryFailingAt([phase]) },
      ]);
    },
  );

  test('2つの処理が失敗したら、両方の名前を順に含む例外で終え、causeには最初の失敗を入れる', async () => {
    const laterFailure = new Error('メールの依頼の記録を消せません');
    const { job, calls } = setup({
      undispatched: failure,
      pending: [noticeOf(1)],
      noticeDeleteCounts: laterFailure,
    });

    const thrown = await run(job).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      '日次の確認の処理に失敗しました: redispatch, notice-retention',
    );
    expect((thrown as Error).cause).toBe(failure);
    expect(ranPhases(calls)).toEqual({
      ...ALL_RAN,
      redispatch: false,
      'notice-retention': false,
    });
    expect(summaryOf()).toEqual(
      summaryFailingAt(['redispatch', 'notice-retention']),
    );
  });

  test('DIコンテナから共通の契約の識別子で依存を受け取って解決できる', async () => {
    const activation = activationOf(1);
    const { calls, activations, notices, dispatcher, notifier } =
      createDependencies({ undispatched: [activation] });
    const container = new Container();
    container.bind(ULTRAS_TYPES.ActivationStore).toConstantValue(activations);
    container.bind(ULTRAS_TYPES.NoticeStore).toConstantValue(notices);
    container
      .bind(ULTRAS_TYPES.ActivationDispatcher)
      .toConstantValue(dispatcher);
    container.bind(ULTRAS_TYPES.UltrasNotifier).toConstantValue(notifier);
    container
      .bind(API_ULTRAS_TYPES.PendingDispatchSweepJob)
      .to(PendingDispatchSweepJob);

    const job = container.get<PendingDispatchSweepJob>(
      API_ULTRAS_TYPES.PendingDispatchSweepJob,
    );
    await run(job);

    expect(job).toBeInstanceOf(PendingDispatchSweepJob);
    expect(calls.dispatched).toEqual([activation.id]);
  });
});

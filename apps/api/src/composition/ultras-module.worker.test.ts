import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE } from '../../lib/core/ultras/activation-message.ts';
import { ULTRAS_TYPES } from '../../lib/core/ultras/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { QueueActivationDispatcher } from '../../lib/workers/ultras/activation-dispatcher.ts';
import { D1ActivationStore } from '../../lib/workers/ultras/d1-activation-store.ts';
import { D1NoticeStore } from '../../lib/workers/ultras/d1-notice-store.ts';
import { D1PromotionFlagReader } from '../../lib/workers/ultras/d1-promotion-flag-reader.ts';
import { D1SubscriptionStore } from '../../lib/workers/ultras/d1-subscription-store.ts';
import { PlanStateSink } from '../../lib/workers/ultras/plan-state-sink.ts';
import {
  clearUltrasTables,
  insertActivationRow,
  insertUser,
  newActivationRow,
  readActivationRow,
} from '../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { StoredUltrasEntitlements } from '../../lib/workers/ultras/ultras-entitlements.ts';
import { UltrasFulfillment } from '../../lib/workers/ultras/ultras-fulfillment.ts';
import { EmailUltrasNotifier } from '../../lib/workers/ultras/ultras-notifier.ts';
import { UltrasOfferPolicy } from '../../lib/workers/ultras/ultras-offer-policy.ts';
import { StoredUltrasPlanExport } from '../../lib/workers/ultras/ultras-plan-export.ts';
import { PendingDispatchSweepJob } from '../application/ultras/jobs/pending-dispatch-sweep-job.ts';
import { API_ULTRAS_TYPES } from '../application/ultras/ultras-types.ts';
import * as mainModule from '../index.ts';
import { MODULES } from './modules.ts';

interface LoggedObject {
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

const SWEEP_JOB_NAME = 'ultras-subscription.pending-dispatch-sweep';
const DAILY_CRON = '21 12 * * *';
// 業務日付2026-11-02の業務時刻4:21。フィクスチャの知らせの作成日時(T0)より10分以上後
const DAILY_TIME = new Date(Date.UTC(2026, 10, 3, 12, 21));
// フィクスチャの知らせのIDはCrockford Base32に無い文字を含み、送り出すメッセージの本文のULIDの検証に合わないため、有効なULIDを使う
const UNDISPATCHED_ACTIVATION_ID = '01JC0ACT000000000000000001';

const IMPLEMENTATIONS = [
  ['SubscriptionStore', D1SubscriptionStore],
  ['SubscriptionStatements', D1SubscriptionStore],
  ['ActivationStore', D1ActivationStore],
  ['ActivationStatements', D1ActivationStore],
  ['NoticeStore', D1NoticeStore],
  ['NoticeStatements', D1NoticeStore],
  ['UltrasPromotionFlagReader', D1PromotionFlagReader],
  ['UltrasEntitlements', StoredUltrasEntitlements],
  ['UltrasPlanExport', StoredUltrasPlanExport],
  ['ActivationDispatcher', QueueActivationDispatcher],
  ['UltrasNotifier', EmailUltrasNotifier],
  ['UltrasOfferPolicy', UltrasOfferPolicy],
  ['UltrasFulfillment', UltrasFulfillment],
  ['PlanStateSink', PlanStateSink],
] as const;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-api-ultras-module',
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function recordLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args[0] as LoggedObject);
    });
  }
  return logs;
}

async function runScheduled(
  cron: string,
  scheduledTime: Date,
): Promise<readonly JobSummary[]> {
  const logs = recordLogs();
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();

  await scheduled(
    createScheduledController({ cron, scheduledTime: scheduledTime.getTime() }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const summary = logs.find(
    ({ message }) => message === '定期実行を終えました',
  );
  return (summary?.['jobs'] ?? []) as readonly JobSummary[];
}

function activationMessagesOf(
  sendCalls: readonly (readonly unknown[])[],
): readonly QueueEnvelope[] {
  return sendCalls
    .map(([message]) => message as QueueEnvelope)
    .filter(({ type }) => type === ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type);
}

beforeEach(async () => {
  await clearUltrasTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのモジュールの一覧へのUltrasの登録', () => {
  test('Ultrasの共通の束縛と、それが使う決済・メール・利用者の共通の束縛を1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'ultras-platform',
      'payments-platform',
      'email-platform',
      'identity-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test('解決を確かめる識別子はULTRAS_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(ULTRAS_TYPES).toSorted(),
    );
  });

  test.each(IMPLEMENTATIONS)(
    'モジュールの一覧の処理単位のコンテナから%sを解決する',
    (name, implementation) => {
      expect(createContainer().get(ULTRAS_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );

  test.each([
    ['SubscriptionStore', 'SubscriptionStatements'],
    ['ActivationStore', 'ActivationStatements'],
    ['NoticeStore', 'NoticeStatements'],
  ] as const)(
    '%sと%sは同じインスタンスに解決される',
    (operations, statements) => {
      const container = createContainer();

      expect(container.get(ULTRAS_TYPES[statements])).toBe(
        container.get(ULTRAS_TYPES[operations]),
      );
    },
  );

  test('モジュールの一覧の処理単位のコンテナから送り出し直しと後始末のジョブを解決する', () => {
    expect(
      createContainer().get(API_ULTRAS_TYPES.PendingDispatchSweepJob),
    ).toBeInstanceOf(PendingDispatchSweepJob);
  });
});

describe('Ultrasのジョブの定期実行', () => {
  test('4:21の起動(21 12 * * *)で、送り出し直しと後始末のジョブが束縛から解決されて成功し、未送り出しの知らせを送り出す', async () => {
    await insertUser(1);
    await insertActivationRow(
      newActivationRow(1, { id: UNDISPATCHED_ACTIVATION_ID }),
    );
    const send = vi.spyOn(env.JOBS_QUEUE, 'send');

    const jobs = await runScheduled(DAILY_CRON, DAILY_TIME);

    expect(jobs.filter(({ name }) => name === SWEEP_JOB_NAME)).toEqual([
      expect.objectContaining({ name: SWEEP_JOB_NAME, result: 'succeeded' }),
    ]);
    expect(activationMessagesOf(send.mock.calls)).toEqual([
      expect.objectContaining({
        type: ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
        body: { activationId: UNDISPATCHED_ACTIVATION_ID },
      }),
    ]);
    expect(await readActivationRow(UNDISPATCHED_ACTIVATION_ID)).toMatchObject({
      dispatchedAt: expect.any(Date) as Date,
      completedAt: null,
    });
  });
});

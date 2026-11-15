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

import { FLUSH_NOTIFICATION_SLOT_MESSAGE } from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  eveningSlot,
  morningSlot,
} from '../../lib/core/notifications/notification-slots.ts';
import {
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  parseBusinessDate,
  toUtcCronExpression,
} from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearNotificationTables,
  readSlotRow,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import {
  EveningDispatchJob,
  MorningDispatchJob,
  NotificationMaintenanceJob,
} from '../application/notifications/notification-jobs.ts';
import { NOTIFICATIONS_TYPES } from '../application/notifications/notifications-types.ts';
import * as mainModule from '../index.ts';
import { MODULES } from './modules.ts';

interface LoggedObject {
  readonly level: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
}

interface FlushRequest {
  readonly slotKey: string;
  readonly delaySeconds: number | undefined;
}

const DATE = parseBusinessDate('2026-11-20');
const PREVIOUS_DATE = parseBusinessDate('2026-11-19');

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'scheduled',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

function recordFlushRequests(): FlushRequest[] {
  const requests: FlushRequest[] = [];
  vi.spyOn(env.JOBS_QUEUE, 'send').mockImplementation((message, options) => {
    const envelope = message as QueueEnvelope;
    if (envelope.type === FLUSH_NOTIFICATION_SLOT_MESSAGE.type) {
      const { slotKey } = envelope.body as { readonly slotKey: string };
      requests.push({ slotKey, delaySeconds: options?.delaySeconds });
    }
    return Promise.resolve({ metadata: { metrics: {} } } as QueueSendResponse);
  });
  return requests;
}

async function runScheduled(
  date: typeof DATE,
  time: BusinessTimeOfDay,
): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron: toUtcCronExpression(time),
      scheduledTime: fromBusinessDateTime(date, time).getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

function notificationJobResults(logs: readonly LoggedObject[]): JobSummary[] {
  return logs
    .filter(({ message }) => message === '定期実行を終えました')
    .flatMap((summary) => (summary['jobs'] ?? []) as readonly JobSummary[])
    .filter(({ name }) => name.startsWith('notifications.'))
    .map(({ name, result }) => ({ name, result }));
}

beforeEach(async () => {
  await clearNotificationTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーの通知のモジュールの定期実行のジョブ', () => {
  test('処理単位のコンテナから、夜の枠・朝の枠・保守のジョブをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get(NOTIFICATIONS_TYPES.EveningDispatchJob),
    ).toBeInstanceOf(EveningDispatchJob);
    expect(
      container.get(NOTIFICATIONS_TYPES.MorningDispatchJob),
    ).toBeInstanceOf(MorningDispatchJob);
    expect(
      container.get(NOTIFICATIONS_TYPES.NotificationMaintenanceJob),
    ).toBeInstanceOf(NotificationMaintenanceJob);
  });

  test('23:45の起動で、前提の登録が無い当日の夜の枠を開いて直ちに送り出しを依頼する', async () => {
    const logs = recordConsole();
    const requests = recordFlushRequests();
    const slot = eveningSlot(DATE);

    await runScheduled(DATE, { hour: 23, minute: 45 });

    expect(notificationJobResults(logs)).toEqual([
      { name: 'notifications.evening-dispatch', result: 'succeeded' },
    ]);
    expect(requests).toContainEqual({ slotKey: slot.key, delaySeconds: 0 });
    expect(await readSlotRow(slot.key)).toMatchObject({
      phase: 'waiting',
      requiredParticipants: [],
      dispatchRequestedAt: expect.any(Date) as Date,
    });
  });

  test('0:00の起動で、当日の朝の枠を作って遅らせずに送り出しを依頼する', async () => {
    const logs = recordConsole();
    const requests = recordFlushRequests();
    const slot = morningSlot(DATE);

    await runScheduled(DATE, { hour: 0, minute: 0 });

    expect(notificationJobResults(logs)).toEqual([
      { name: 'notifications.morning-dispatch', result: 'succeeded' },
    ]);
    expect(requests).toEqual([{ slotKey: slot.key, delaySeconds: 0 }]);
    expect(await readSlotRow(slot.key)).toMatchObject({
      kind: 'morning',
      phase: 'waiting',
    });
  });

  test('4:21の起動で、前日の夜の枠と当日の朝の枠を作って送り出しを依頼し、保守のジョブが成功する', async () => {
    const logs = recordConsole();
    const requests = recordFlushRequests();
    const evening = eveningSlot(PREVIOUS_DATE);
    const morning = morningSlot(DATE);

    await runScheduled(DATE, { hour: 4, minute: 21 });

    expect(notificationJobResults(logs)).toEqual([
      { name: 'notifications.maintenance', result: 'succeeded' },
    ]);
    expect(requests.slice(0, 2)).toEqual([
      { slotKey: evening.key, delaySeconds: 0 },
      { slotKey: morning.key, delaySeconds: 0 },
    ]);
    expect(await readSlotRow(evening.key)).toBeDefined();
    expect(await readSlotRow(morning.key)).toBeDefined();
  });
});

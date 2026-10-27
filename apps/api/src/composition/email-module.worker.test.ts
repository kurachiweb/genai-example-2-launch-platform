import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { createDatabase } from '../../db/client.ts';
import { emailSendRecords } from '../../db/schema/email/email-send-records.ts';
import { emailSuppressions } from '../../db/schema/email/email-suppressions.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  SuppressionMaintenance,
  UserAddressDirectory,
} from '../../lib/core/email/ports.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  API_EMAIL_TYPES,
  EmailCleanupJob,
} from '../application/email/email-cleanup-job.ts';
import * as mainModule from '../index.ts';
import { UnavailableUserAddressDirectory } from '../infrastructure/email/unavailable-user-address-directory.ts';
import { MODULES } from './modules.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const MILLISECONDS_PER_DAY = 86_400_000;

// 業務日付2026-11-02の業務時刻4:21
const SCHEDULED_TIME = new Date(Date.UTC(2026, 10, 2, 12, 21));
const CLEANUP_CRON = '21 12 * * *';
const CLEANUP_CATEGORY = 'api.application.email-cleanup';
const RECIPIENT_DOMAIN = '@recipient.example';

const db = createDatabase(env.DB);

function daysBeforeScheduled(days: number): Date {
  return new Date(SCHEDULED_TIME.getTime() - days * MILLISECONDS_PER_DAY);
}

function createContainer() {
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

async function insertSuppression(
  address: string,
  lastEventAt: Date,
  expiresAt: Date | null,
): Promise<void> {
  await db.insert(emailSuppressions).values({
    address,
    lastReason: 'hard_bounce',
    lastEventAt,
    expiresAt,
    createdAt: lastEventAt,
    updatedAt: lastEventAt,
  });
}

async function insertSendRecord(id: string, sentAt: Date): Promise<void> {
  await db.insert(emailSendRecords).values({
    id,
    kind: 'email-delivery.smoke',
    sentAt,
    createdAt: sentAt,
    updatedAt: sentAt,
  });
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

async function runScheduled(cron: string, scheduledTime: Date): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron,
      scheduledTime: scheduledTime.getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await db.delete(emailSendRecords);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーのメールのモジュール', () => {
  test('両サーバー共通の送信の受付と、apiだけの後始末のサービス・照会口・ジョブを束縛する', () => {
    const container = createContainer();

    expect(container.isBound(EMAIL_TYPES.EmailSender)).toBe(true);
    expect(
      container.get<SuppressionMaintenance>(EMAIL_TYPES.SuppressionMaintenance),
    ).toBe(
      container.get<SuppressionMaintenance>(EMAIL_TYPES.SuppressionMaintenance),
    );
    expect(container.get(EMAIL_TYPES.UserAddressDirectory)).toBeInstanceOf(
      UnavailableUserAddressDirectory,
    );
    expect(container.get(API_EMAIL_TYPES.EmailCleanupJob)).toBeInstanceOf(
      EmailCleanupJob,
    );
  });

  test('照会口の既定実装は、どのアドレスにも常に「使えない」を返す', async () => {
    const directory = createContainer().get<UserAddressDirectory>(
      EMAIL_TYPES.UserAddressDirectory,
    );

    expect(
      await directory.findRegistered([`registered${RECIPIENT_DOMAIN}`]),
    ).toEqual({ kind: 'unavailable' });
    expect(await directory.findRegistered([])).toEqual({
      kind: 'unavailable',
    });
  });

  test('日次の後始末のジョブを業務時刻4:21の起動に順序900で登録する', () => {
    const definition = SCHEDULED_JOBS.find(
      ({ name }) => name === 'email-delivery.cleanup',
    );

    expect(definition).toEqual({
      name: 'email-delivery.cleanup',
      at: { hour: 4, minute: 21 },
      order: 900,
      handler: API_EMAIL_TYPES.EmailCleanupJob,
    });
    expect(toUtcCronExpression({ hour: 4, minute: 21 })).toBe(CLEANUP_CRON);
    expect(
      createCronRegistry(SCHEDULED_JOBS)
        .jobsFor(CLEANUP_CRON)
        .map(({ name }) => name),
    ).toContain('email-delivery.cleanup');
  });
});

describe('定期実行からの日次の後始末', () => {
  test('4:21の起動で、期限切れの抑止と14日を過ぎた送信済みの記録を消し、照会口が使えないため紐づかない記録を残して要約をログに出す', async () => {
    await insertSuppression(
      `expired${RECIPIENT_DOMAIN}`,
      daysBeforeScheduled(8),
      daysBeforeScheduled(1),
    );
    await insertSuppression(
      `unlinked${RECIPIENT_DOMAIN}`,
      daysBeforeScheduled(400),
      null,
    );
    await insertSendRecord(
      '01JBD8G7Q3Z6W0K8N5S2X4Y001',
      daysBeforeScheduled(15),
    );
    await insertSendRecord(
      '01JBD8G7Q3Z6W0K8N5S2X4Y002',
      daysBeforeScheduled(1),
    );
    const logs = recordConsole();

    await runScheduled(CLEANUP_CRON, SCHEDULED_TIME);

    const remainingAddresses = await db
      .select({ address: emailSuppressions.address })
      .from(emailSuppressions);
    const remainingRecords = await db
      .select({ id: emailSendRecords.id })
      .from(emailSendRecords);
    expect(remainingAddresses).toEqual([
      { address: `unlinked${RECIPIENT_DOMAIN}` },
    ]);
    expect(remainingRecords).toEqual([{ id: '01JBD8G7Q3Z6W0K8N5S2X4Y002' }]);

    const cleanupLogs = logs.filter(
      ({ category }) => category === CLEANUP_CATEGORY,
    );
    expect(cleanupLogs.map(({ level }) => level)).toEqual(['warning', 'info']);
    expect(cleanupLogs[1]).toMatchObject({
      expiredSuppressionsDeleted: 1,
      unlinkedSuppressionsDeleted: 0,
      sendRecordsDeleted: 1,
      unlinkedCheck: 'skipped-directory-unavailable',
    });
    expect(
      logs.find(({ message }) => message === '定期実行を終えました'),
    ).toMatchObject({
      level: 'info',
      cron: CLEANUP_CRON,
      result: 'succeeded',
      jobs: [expect.objectContaining({ name: 'email-delivery.cleanup' })],
    });
    expect(JSON.stringify(logs)).not.toContain(RECIPIENT_DOMAIN);
  });
});

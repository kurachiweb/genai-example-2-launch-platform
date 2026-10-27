import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { emailAlertThrottles } from '../../../db/schema/email/email-alert-throttles.ts';
import { emailSendRecords } from '../../../db/schema/email/email-send-records.ts';
import { emailSuppressions } from '../../../db/schema/email/email-suppressions.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import type { EmailKindRegistry } from '../../core/email/email-kind.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../core/email/kinds/email-delivery-smoke.ts';
import { EMAIL_KINDS } from '../../core/email/kinds/index.ts';
import type {
  AlertThrottle,
  EmailSender,
  SendRecordStore,
  SuppressionList,
  SuppressionRecorder,
} from '../../core/email/ports.ts';
import { EMAIL_SEND_MESSAGE } from '../../core/email/send-message.ts';
import {
  parseEnvelope,
  type QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { EMAIL_PLATFORM_MODULE } from './email-platform-module.ts';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const RECIPIENT = 'private-recipient@mail.example';

const db = createDatabase(env.DB);

interface RecordingQueue {
  readonly queue: Queue;
  readonly sent: unknown[];
}

function createRecordingQueue(): RecordingQueue {
  const sent: unknown[] = [];
  const queue: Queue = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

function createContainer(jobsQueue: Queue = env.JOBS_QUEUE): Container {
  return createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: jobsQueue },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-email-platform',
        clientIp: undefined,
      },
    },
    [EMAIL_PLATFORM_MODULE],
  );
}

beforeEach(async () => {
  await db.delete(emailSuppressions);
  await db.delete(emailSendRecords);
  await db.delete(emailAlertThrottles);
});

describe('EMAIL_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      EMAIL_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(EMAIL_PLATFORM_MODULE.name).toBe('email-platform');
    expect('routes' in EMAIL_PLATFORM_MODULE).toBe(false);
  });

  test('種別の集約を全メール種別の集約点から組み立てて束縛する', () => {
    const registry = createContainer().get<EmailKindRegistry>(
      EMAIL_TYPES.EmailKindRegistry,
    );

    expect(registry.names()).toEqual(EMAIL_KINDS.map((kind) => kind.name));
    expect(registry.get(EMAIL_DELIVERY_SMOKE_KIND.name)).toBe(
      EMAIL_DELIVERY_SMOKE_KIND,
    );
  });

  test('受付を解決でき、送信要求を処理単位のQueueへemail.sendとして送る', async () => {
    const { queue, sent } = createRecordingQueue();
    const sender = createContainer(queue).get<EmailSender>(
      EMAIL_TYPES.EmailSender,
    );

    const requestId = await sender.send({
      kind: EMAIL_DELIVERY_SMOKE_KIND,
      to: RECIPIENT,
      input: { requestedAt: '2026-10-27T03:04:05.678Z' },
    });

    expect(requestId).toMatch(ULID_PATTERN);
    expect(sent).toHaveLength(1);
    expect(parseEnvelope(sent[0])).toEqual({ ok: true, envelope: sent[0] });
    expect(sent[0]).toMatchObject<Partial<QueueEnvelope>>({
      id: requestId,
      type: EMAIL_SEND_MESSAGE.type,
      body: {
        kind: EMAIL_DELIVERY_SMOKE_KIND.name,
        to: RECIPIENT,
        input: { requestedAt: '2026-10-27T03:04:05.678Z' },
      },
    });
  });

  test('抑止リストの記録と照会を解決でき、同じD1の記録を照合キーで引ける', async () => {
    const container = createContainer();
    const recorder = container.get<SuppressionRecorder>(
      EMAIL_TYPES.SuppressionRecorder,
    );
    const list = container.get<SuppressionList>(EMAIL_TYPES.SuppressionList);
    const lastEventAt = new Date();

    await recorder.record('Suppressed@Recipient.Example', {
      lastReason: 'complaint',
      lastEventAt,
      expiresAt: null,
    });

    await expect(
      list.getStatus('suppressed@recipient.example'),
    ).resolves.toEqual({
      suppressed: true,
      lastReason: 'complaint',
      lastEventAt,
      expiresAt: null,
    });
    await expect(
      list.findSuppressed([
        'SUPPRESSED@recipient.example',
        'other@recipient.example',
      ]),
    ).resolves.toEqual(new Set(['suppressed@recipient.example']));
  });

  test('送信済みの記録と警告の間引きを解決でき、D1に記録する', async () => {
    const container = createContainer();
    const sendRecords = container.get<SendRecordStore>(
      EMAIL_TYPES.SendRecordStore,
    );
    const throttle = container.get<AlertThrottle>(EMAIL_TYPES.AlertThrottle);
    const requestId = '01JBM3Y7Q2M4N5P6R7S8T9V0W1';
    const now = new Date('2026-10-27T03:04:05.678Z');

    await sendRecords.markSent(requestId, EMAIL_DELIVERY_SMOKE_KIND.name, now);

    await expect(sendRecords.hasSent(requestId)).resolves.toBe(true);
    await expect(throttle.tryAcquire('test.alert', now, 60)).resolves.toBe(
      true,
    );
    await expect(throttle.tryAcquire('test.alert', now, 60)).resolves.toBe(
      false,
    );
  });

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const identifiers = [
      EMAIL_TYPES.EmailKindRegistry,
      EMAIL_TYPES.EmailSender,
      EMAIL_TYPES.SuppressionList,
      EMAIL_TYPES.SuppressionRecorder,
      EMAIL_TYPES.SendRecordStore,
      EMAIL_TYPES.AlertThrottle,
    ];
    const first = createContainer();
    const second = createContainer();

    for (const identifier of identifiers) {
      expect(first.get(identifier)).toBe(first.get(identifier));
    }
    for (const identifier of identifiers.slice(1)) {
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });

  test('アプリごとに束縛する後始末・照会口・送信者情報は束縛しない', () => {
    const container = createContainer();

    expect(container.isBound(EMAIL_TYPES.SuppressionMaintenance)).toBe(false);
    expect(container.isBound(EMAIL_TYPES.UserAddressDirectory)).toBe(false);
    expect(container.isBound(EMAIL_TYPES.SenderInfoProvider)).toBe(false);
  });
});

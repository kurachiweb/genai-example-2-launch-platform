import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import type { LogRecord } from '@logtape/logtape';
import { Container } from 'inversify';

import {
  BOUNCED_EVENT_SAMPLE,
  COMPLAINED_EVENT_SAMPLE,
  DEFERRED_EVENT_SAMPLE,
  DELIVERED_EVENT_SAMPLE,
  FAILED_EVENT_SAMPLE,
  REJECTED_EVENT_SAMPLE,
  SAMPLE_EVENT_TIMESTAMP,
  SAMPLE_RECIPIENT,
} from '../../../lib/core/email/delivery-event.fixtures.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type { SuppressionRecorder } from '../../../lib/core/email/ports.ts';
import type { SuppressionState } from '../../../lib/core/email/suppression-policy.ts';
import type {
  RawMessageHandler,
  RawMessageMeta,
} from '../../../lib/core/messaging/raw-queue.ts';
import { DeliveryEventHandler } from './delivery-event-handler.ts';
import {
  capturedLogsOf,
  clearCapturedLogs,
  startLogCapture,
  stopLogCapture,
} from './email-log-capture.fixtures.ts';
import { EVENT_EMAIL_TYPES } from './email-types.ts';
import type { EmailIncident, EmailIncidentReporter } from './ports.ts';

beforeAll(startLogCapture);
afterAll(stopLogCapture);
beforeEach(clearCapturedLogs);

const LOG_CATEGORY = ['event', 'application', 'email-delivery-event'];

const RECEIVED_AT = new Date('2026-06-01T03:00:00.000Z');

const META: RawMessageMeta = {
  id: 'queue-message-1',
  attempts: 1,
  timestamp: RECEIVED_AT,
};

const MILLISECONDS_PER_DAY = 86_400_000;

interface RecordCall {
  readonly address: string;
  readonly state: SuppressionState;
}

interface Harness {
  readonly handler: DeliveryEventHandler;
  readonly records: RecordCall[];
  readonly incidents: EmailIncident[];
  readonly recorder: SuppressionRecorder;
  readonly reporter: EmailIncidentReporter;
}

function createHarness(record?: () => Promise<void>): Harness {
  const records: RecordCall[] = [];
  const incidents: EmailIncident[] = [];
  const recorder: SuppressionRecorder = {
    record: (address, state) => {
      records.push({ address, state });
      return record?.() ?? Promise.resolve();
    },
  };
  const reporter: EmailIncidentReporter = {
    report: (incident) => {
      incidents.push(incident);
    },
  };
  const handler = new DeliveryEventHandler(recorder, reporter);
  return { handler, records, incidents, recorder, reporter };
}

function handlerLogs(): LogRecord[] {
  return capturedLogsOf(LOG_CATEGORY);
}

// 1件の処理ごとに結果のログがちょうど1件出ることも確かめる
function resultLog(): LogRecord {
  const logs = handlerLogs();
  const [log] = logs;
  if (logs.length !== 1 || log === undefined) {
    throw new Error(`結果のログが1件ではありません: ${String(logs.length)}件`);
  }
  return log;
}

function withoutTimestamp(sample: {
  readonly metadata: Readonly<Record<string, unknown>>;
}): unknown {
  const metadata = Object.fromEntries(
    Object.entries(sample.metadata).filter(
      ([name]) => name !== 'eventTimestamp',
    ),
  );
  return { ...sample, metadata };
}

describe('DeliveryEventHandler 抑止の記録', () => {
  test('恒久バウンスは、宛先の照合キーへ期限なしの抑止を記録し、通知しない', async () => {
    const { handler, records, incidents } = createHarness();
    const body = {
      ...BOUNCED_EVENT_SAMPLE,
      payload: {
        ...BOUNCED_EVENT_SAMPLE.payload,
        recipient: 'User@Recipient.Example',
      },
    };

    await handler.handle(body, META);

    expect(records).toEqual([
      {
        address: SAMPLE_RECIPIENT,
        state: {
          lastReason: 'hard_bounce',
          lastEventAt: SAMPLE_EVENT_TIMESTAMP,
          expiresAt: null,
        },
      },
    ]);
    expect(incidents).toEqual([]);
    const log = resultLog();
    expect(log.level).toBe('info');
    expect(log.properties).toMatchObject({
      result: 'suppressed',
      eventKind: 'hard-bounce',
      suppressionReason: 'hard_bounce',
      suppressedUntil: null,
    });
  });

  test('苦情は、期限なしの抑止を記録する', async () => {
    const { handler, records, incidents } = createHarness();

    await handler.handle(COMPLAINED_EVENT_SAMPLE, META);

    expect(records).toEqual([
      {
        address: SAMPLE_RECIPIENT,
        state: {
          lastReason: 'complaint',
          lastEventAt: SAMPLE_EVENT_TIMESTAMP,
          expiresAt: null,
        },
      },
    ]);
    expect(incidents).toEqual([]);
    expect(resultLog().properties).toMatchObject({
      result: 'suppressed',
      eventKind: 'complaint',
      suppressionReason: 'complaint',
    });
  });

  test('受信者側の理由による拒否は、発生から7日間を期限とする抑止を記録する', async () => {
    const { handler, records, incidents } = createHarness();
    const expiresAt = new Date(
      SAMPLE_EVENT_TIMESTAMP.getTime() + 7 * MILLISECONDS_PER_DAY,
    );

    await handler.handle(REJECTED_EVENT_SAMPLE, META);

    expect(records).toEqual([
      {
        address: SAMPLE_RECIPIENT,
        state: {
          lastReason: 'rejected',
          lastEventAt: SAMPLE_EVENT_TIMESTAMP,
          expiresAt,
        },
      },
    ]);
    expect(incidents).toEqual([]);
    expect(resultLog().properties).toMatchObject({
      result: 'suppressed',
      eventKind: 'rejected',
      suppressionReason: 'rejected',
      suppressedUntil: expiresAt.toISOString(),
    });
  });

  test('発生日時が無いイベントは、メッセージの受信時刻を契機の日時にする', async () => {
    const { handler, records } = createHarness();

    await handler.handle(withoutTimestamp(BOUNCED_EVENT_SAMPLE), META);

    expect(records.map(({ state }) => state.lastEventAt)).toEqual([
      RECEIVED_AT,
    ]);
  });

  test('発生日時が無いイベントが重複して届いても、同じ状態を記録する', async () => {
    const { handler, records } = createHarness();
    const body = withoutTimestamp(COMPLAINED_EVENT_SAMPLE);

    await handler.handle(body, META);
    await handler.handle(body, { ...META, attempts: 2 });

    const [first, second] = records;
    expect(records).toHaveLength(2);
    expect(second).toEqual(first);
  });

  test('記録に失敗したら、再試行に任せるため同じ例外を投げ、通知しない', async () => {
    const failure = new Error('D1の障害');
    const { handler, incidents } = createHarness(() => Promise.reject(failure));

    const error = await handler
      .handle(BOUNCED_EVENT_SAMPLE, META)
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(failure);
    expect(incidents).toEqual([]);
  });
});

describe('DeliveryEventHandler 記録しない効果', () => {
  test('送信側の理由による拒否は、記録せずに送信側の拒否として理由とともに通知し、エラーログを出す', async () => {
    const { handler, records, incidents } = createHarness();
    const body = {
      ...REJECTED_EVENT_SAMPLE,
      payload: {
        ...REJECTED_EVENT_SAMPLE.payload,
        rejection: { reason: 'policy_violation', party: 'sender' },
      },
    };

    await handler.handle(body, META);

    expect(records).toEqual([]);
    expect(incidents).toEqual<EmailIncident[]>([
      { kind: 'sender-side-rejection', reason: 'policy_violation' },
    ]);
    const log = resultLog();
    expect(log.level).toBe('error');
    expect(log.properties).toMatchObject({
      result: 'reported',
      eventKind: 'rejected',
      reportKind: 'sender-side-rejection',
      reason: 'policy_violation',
    });
  });

  test('理由を判別できない拒否は、記録せずに理由を不明として通知する', async () => {
    const { handler, records, incidents } = createHarness();
    const body = {
      ...REJECTED_EVENT_SAMPLE,
      payload: { ...REJECTED_EVENT_SAMPLE.payload, rejection: undefined },
    };

    await handler.handle(body, META);

    expect(records).toEqual([]);
    expect(incidents).toEqual<EmailIncident[]>([
      { kind: 'sender-side-rejection', reason: 'unknown' },
    ]);
  });

  test('受け付け後の配送の失敗は、記録せずに配送失敗として通知し、エラーログを出す', async () => {
    const { handler, records, incidents } = createHarness();

    await handler.handle(FAILED_EVENT_SAMPLE, META);

    expect(records).toEqual([]);
    expect(incidents).toEqual<EmailIncident[]>([
      { kind: 'delivery-failed', reason: 'delivery_failed' },
    ]);
    const log = resultLog();
    expect(log.level).toBe('error');
    expect(log.properties).toMatchObject({
      result: 'reported',
      eventKind: 'failed',
      reportKind: 'delivery-failed',
      reason: 'delivery_failed',
    });
  });

  test('一時的な失敗の再試行を使い切ったバウンスは、記録も通知もせずにinfoのログを出す', async () => {
    const { handler, records, incidents } = createHarness();
    const body = {
      ...BOUNCED_EVENT_SAMPLE,
      payload: {
        ...BOUNCED_EVENT_SAMPLE.payload,
        bounce: { ...BOUNCED_EVENT_SAMPLE.payload.bounce, type: 'soft' },
      },
    };

    await handler.handle(body, META);

    expect(records).toEqual([]);
    expect(incidents).toEqual([]);
    const log = resultLog();
    expect(log.level).toBe('info');
    expect(log.properties).toMatchObject({
      result: 'logged',
      eventKind: 'soft-bounce',
    });
  });

  test.each([
    ['配信成功', DELIVERED_EVENT_SAMPLE, 'delivered'],
    ['配送の再試行中', DEFERRED_EVENT_SAMPLE, 'deferred'],
  ])(
    '%sのイベントは、記録も通知もせずにdebugのログを出す',
    async (_label, sample, ignoredType) => {
      const { handler, records, incidents } = createHarness();

      await handler.handle(sample, META);

      expect(records).toEqual([]);
      expect(incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('debug');
      expect(log.properties).toMatchObject({
        result: 'ignored',
        eventKind: 'ignored',
        ignoredType,
      });
    },
  );
});

describe('DeliveryEventHandler 不正なイベント', () => {
  test('未知の種類は、記録せずに種類を付けて通知し、警告のログを出して正常に終える', async () => {
    const { handler, records, incidents } = createHarness();
    const type = 'cf.email.sending.message.opened';

    await handler.handle({ ...DELIVERED_EVENT_SAMPLE, type }, META);

    expect(records).toEqual([]);
    expect(incidents).toEqual<EmailIncident[]>([
      { kind: 'invalid-delivery-event', type },
    ]);
    const log = resultLog();
    expect(log.level).toBe('warning');
    expect(log.properties).toMatchObject({
      result: 'invalid',
      reason: 'unknown-type',
      eventType: type,
    });
  });

  test('形式の不正は、記録せずに種類を付けて通知し、警告のログを出して正常に終える', async () => {
    const { handler, records, incidents } = createHarness();
    const body = {
      ...BOUNCED_EVENT_SAMPLE,
      payload: { ...BOUNCED_EVENT_SAMPLE.payload, recipient: 'not-an-address' },
    };

    await handler.handle(body, META);

    expect(records).toEqual([]);
    expect(incidents).toEqual<EmailIncident[]>([
      { kind: 'invalid-delivery-event', type: BOUNCED_EVENT_SAMPLE.type },
    ]);
    const log = resultLog();
    expect(log.level).toBe('warning');
    expect(log.properties).toMatchObject({
      result: 'invalid',
      reason: 'invalid-format',
      eventType: BOUNCED_EVENT_SAMPLE.type,
    });
  });

  test.each([
    ['null', null],
    ['文字列', 'not-json-object'],
    ['種類の無いオブジェクト', { payload: {} }],
  ])(
    '種類を読めない本文(%s)は、種類なしで通知し、警告のログに種類を含めない',
    async (_label, body) => {
      const { handler, records, incidents } = createHarness();

      await handler.handle(body, META);

      expect(records).toEqual([]);
      expect(incidents).toEqual<EmailIncident[]>([
        { kind: 'invalid-delivery-event', type: undefined },
      ]);
      const log = resultLog();
      expect(log.level).toBe('warning');
      expect(log.properties).toMatchObject({
        result: 'invalid',
        reason: 'invalid-format',
      });
      expect(Object.hasOwn(log.properties, 'eventType')).toBe(false);
    },
  );

  test('長い種類は、ログでは64文字に切り詰める', async () => {
    const { handler, incidents } = createHarness();
    const type = `cf.email.sending.message.${'x'.repeat(200)}`;

    await handler.handle({ ...DELIVERED_EVENT_SAMPLE, type }, META);

    expect(incidents).toEqual<EmailIncident[]>([
      { kind: 'invalid-delivery-event', type },
    ]);
    expect(resultLog().properties).toMatchObject({
      eventType: type.slice(0, 64),
    });
  });
});

describe('DeliveryEventHandler ログと通知の個人情報', () => {
  const SAMPLES = [
    BOUNCED_EVENT_SAMPLE,
    COMPLAINED_EVENT_SAMPLE,
    REJECTED_EVENT_SAMPLE,
    FAILED_EVENT_SAMPLE,
    DELIVERED_EVENT_SAMPLE,
    DEFERRED_EVENT_SAMPLE,
  ];

  test.each(SAMPLES.map((sample) => [sample.type, sample] as const))(
    '%sのログと通知に、宛先・件名・配送サーバーの応答を含めない',
    async (_type, sample) => {
      const { handler, incidents } = createHarness();
      const subject = 'subject' in sample.payload ? sample.payload.subject : '';

      await handler.handle(sample, META);

      expect(handlerLogs()).toHaveLength(1);
      const serialized = JSON.stringify({
        logs: handlerLogs().map(({ message, properties }) => ({
          message,
          properties,
        })),
        incidents,
      });
      expect(serialized).not.toContain('recipient.example');
      expect(serialized).not.toContain('send.mail.example');
      if (subject !== '') {
        expect(serialized).not.toContain(subject);
      }
      expect(serialized).not.toContain('smtp');
      expect(serialized).not.toMatch(/\b[245]\d\d [245]\.\d/u);
      expect(serialized).not.toContain('Recipient is suppressed');
    },
  );
});

describe('DeliveryEventHandler 依存性注入', () => {
  test('識別子に束縛すると、コンテナがポートを注入した処理を返す', async () => {
    const { records, recorder, reporter } = createHarness();
    const container = new Container({ defaultScope: 'Transient' });
    container
      .bind<SuppressionRecorder>(EMAIL_TYPES.SuppressionRecorder)
      .toConstantValue(recorder);
    container
      .bind<EmailIncidentReporter>(EVENT_EMAIL_TYPES.EmailIncidentReporter)
      .toConstantValue(reporter);
    container
      .bind<RawMessageHandler>(EVENT_EMAIL_TYPES.DeliveryEventHandler)
      .to(DeliveryEventHandler);

    const handler = container.get<RawMessageHandler>(
      EVENT_EMAIL_TYPES.DeliveryEventHandler,
    );
    await handler.handle(COMPLAINED_EVENT_SAMPLE, META);

    expect(records).toHaveLength(1);
  });
});

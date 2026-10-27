import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { EmailKindRegistry } from '../../../lib/core/email/email-kind.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type {
  AlertThrottle,
  SenderInfoProvider,
  SendRecordStore,
  SuppressionList,
} from '../../../lib/core/email/ports.ts';
import type { EmailSendBody } from '../../../lib/core/email/send-message.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_EMAIL_TYPES } from './email-types.ts';
import {
  type EmailIncident,
  type EmailIncidentReporter,
  type EmailProvider,
  EmailRenderError,
  type EmailRenderer,
  type EmailRuntimeConfig,
} from './ports.ts';
import {
  bodyOf,
  clearCapturedLogs,
  createHarness,
  metaOf,
  NOTIFICATION_KIND,
  NOW,
  portsOf,
  RECIPIENT,
  REQUEST_ID,
  resultLog,
  SENDER_INFO,
  startLogCapture,
  stopLogCapture,
  TRANSACTIONAL_KIND,
  VALID_INPUT,
} from './send-email-handler.fixtures.ts';
import {
  EmailTransientFailure,
  SendEmailHandler,
} from './send-email-handler.ts';

beforeAll(startLogCapture);
afterAll(stopLogCapture);
beforeEach(clearCapturedLogs);

const SENT_PORTS = ['hasSent', 'senderInfo', 'render', 'send', 'markSent'];

describe('SendEmailHandler', () => {
  describe('送信前の判定', () => {
    test('送信済みの送信要求なら、他のポートを呼ばずに重複として完了する', async () => {
      const { handler, calls, incidents } = createHarness({ sent: true });

      const result = await handler.handle(bodyOf(), metaOf(2));

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(calls).toEqual([{ port: 'hasSent', requestId: REQUEST_ID }]);
      expect(incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toEqual({
        result: 'duplicate',
        kind: TRANSACTIONAL_KIND.name,
        kindCategory: 'transactional',
        requestId: REQUEST_ID,
        attempts: 2,
        durationMs: 0,
      });
    });

    test.each([
      ['過ぎている', '2030-01-15T11:59:59.999Z'],
      ['ちょうど現在の時刻である', NOW.toISOString()],
    ])(
      '送信期限が%sなら、描画も送信もせずに期限切れとして完了する',
      async (_label, deadline) => {
        const { handler, calls, incidents } = createHarness();

        const result = await handler.handle(bodyOf({ deadline }), metaOf());

        expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
        expect(portsOf(calls)).toEqual(['hasSent']);
        expect(incidents).toEqual([]);
        const log = resultLog();
        expect(log.level).toBe('info');
        expect(log.properties).toEqual({
          result: 'expired',
          kind: TRANSACTIONAL_KIND.name,
          kindCategory: 'transactional',
          requestId: REQUEST_ID,
          attempts: 1,
          durationMs: 0,
        });
      },
    );

    test('送信期限が未来なら送信する', async () => {
      const { handler, calls } = createHarness();

      const result = await handler.handle(
        bodyOf({ deadline: '2030-01-15T12:00:00.001Z' }),
        metaOf(),
      );

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(portsOf(calls)).toEqual(SENT_PORTS);
    });

    test('未登録の種別なら、分類の無い送信不能を通知して送らずに完了する', async () => {
      const { handler, calls, incidents } = createHarness();

      const result = await handler.handle(
        bodyOf({ kind: 'test.unregistered' }),
        metaOf(3),
      );

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(portsOf(calls)).toEqual(['hasSent']);
      expect(incidents).toEqual<EmailIncident[]>([
        {
          kind: 'undeliverable',
          emailKind: 'test.unregistered',
          category: undefined,
          requestId: REQUEST_ID,
          code: 'unknown-kind',
        },
      ]);
      const log = resultLog();
      expect(log.level).toBe('error');
      expect(log.properties).toEqual({
        result: 'undeliverable',
        kind: 'test.unregistered',
        requestId: REQUEST_ID,
        attempts: 3,
        durationMs: 0,
        code: 'unknown-kind',
      });
    });

    test('入力が種別の検証規則に合わなければ、送信不能を通知して描画も送信もせずに完了する', async () => {
      const { handler, calls, incidents } = createHarness();

      const result = await handler.handle(
        bodyOf({ kind: NOTIFICATION_KIND.name, input: { title: 1 } }),
        metaOf(),
      );

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(portsOf(calls)).toEqual(['hasSent']);
      expect(incidents).toEqual<EmailIncident[]>([
        {
          kind: 'undeliverable',
          emailKind: NOTIFICATION_KIND.name,
          category: 'notification',
          requestId: REQUEST_ID,
          code: 'invalid-input',
        },
      ]);
      const log = resultLog();
      expect(log.level).toBe('error');
      expect(log.properties).toEqual({
        result: 'undeliverable',
        kind: NOTIFICATION_KIND.name,
        kindCategory: 'notification',
        requestId: REQUEST_ID,
        attempts: 1,
        durationMs: 0,
        code: 'invalid-input',
      });
    });

    test('通知メールの宛先が抑止中なら、描画も送信もせずに抑止中として完了する', async () => {
      const { handler, calls, incidents } = createHarness({ suppressed: true });

      const result = await handler.handle(
        bodyOf({ kind: NOTIFICATION_KIND.name }),
        metaOf(),
      );

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(calls).toEqual([
        { port: 'hasSent', requestId: REQUEST_ID },
        { port: 'getStatus', address: RECIPIENT },
      ]);
      expect(incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toEqual({
        result: 'suppressed',
        kind: NOTIFICATION_KIND.name,
        kindCategory: 'notification',
        requestId: REQUEST_ID,
        attempts: 1,
        durationMs: 0,
      });
    });

    test('通知メールの宛先が抑止中でなければ送信する', async () => {
      const { handler, calls } = createHarness({ suppressed: false });

      await handler.handle(bodyOf({ kind: NOTIFICATION_KIND.name }), metaOf());

      expect(portsOf(calls)).toEqual([
        'hasSent',
        'getStatus',
        'senderInfo',
        'render',
        'send',
        'markSent',
      ]);
    });

    test('トランザクションメールは抑止リストを照会せず、宛先が抑止中でも送信する', async () => {
      const { handler, calls } = createHarness({ suppressed: true });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(portsOf(calls)).toEqual(SENT_PORTS);
      expect(resultLog().properties).toMatchObject({ result: 'sent' });
    });
  });

  describe('描画', () => {
    test.each([
      ['設定されている', SENDER_INFO],
      ['未設定である', undefined],
    ])(
      '送信者情報が%sとき、種別と検証済みの入力とその送信者情報で描画する',
      async (_label, senderInfo) => {
        const { handler, calls } = createHarness({
          senderInfo: () => Promise.resolve(senderInfo),
        });

        await handler.handle(
          bodyOf({ input: { ...VALID_INPUT, extra: '規則に無い値' } }),
          metaOf(),
        );

        expect(calls).toContainEqual({
          port: 'render',
          kind: TRANSACTIONAL_KIND,
          input: VALID_INPUT,
          senderInfo,
        });
      },
    );

    test('描画の失敗なら、送信せずに描画失敗の送信不能を通知して完了する', async () => {
      const { handler, calls, incidents } = createHarness({
        render: () =>
          Promise.reject(new EmailRenderError('テンプレートがありません')),
      });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(portsOf(calls)).toEqual(['hasSent', 'senderInfo', 'render']);
      expect(incidents).toEqual<EmailIncident[]>([
        {
          kind: 'undeliverable',
          emailKind: TRANSACTIONAL_KIND.name,
          category: 'transactional',
          requestId: REQUEST_ID,
          code: 'render-failed',
        },
      ]);
      const log = resultLog();
      expect(log.level).toBe('error');
      expect(log.properties).toEqual({
        result: 'undeliverable',
        kind: TRANSACTIONAL_KIND.name,
        kindCategory: 'transactional',
        requestId: REQUEST_ID,
        attempts: 1,
        durationMs: 0,
        code: 'render-failed',
      });
    });

    test('描画の失敗以外の例外は、送信不能にせずに投げ直して再試行に任せる', async () => {
      const failure = new TypeError('想定外の例外');
      const { handler, calls, incidents } = createHarness({
        render: () => Promise.reject(failure),
      });

      const error: unknown = await handler
        .handle(bodyOf(), metaOf())
        .catch((caught: unknown) => caught);

      expect(error).toBe(failure);
      expect(portsOf(calls)).toEqual(['hasSent', 'senderInfo', 'render']);
      expect(incidents).toEqual([]);
    });

    test('送信者情報の取得に失敗したら、描画も送信もせずに投げ直して再試行に任せる', async () => {
      const failure = new Error('D1に接続できません');
      const { handler, calls, incidents } = createHarness({
        senderInfo: () => Promise.reject(failure),
      });

      const error: unknown = await handler
        .handle(bodyOf(), metaOf())
        .catch((caught: unknown) => caught);

      expect(error).toBe(failure);
      expect(portsOf(calls)).toEqual(['hasSent', 'senderInfo']);
      expect(incidents).toEqual([]);
    });
  });

  test('識別子に束縛すると、コンテナがポートを注入した処理を返す', async () => {
    const { bindings, calls } = createHarness();
    const container = new Container({ defaultScope: 'Transient' });
    container
      .bind<EmailKindRegistry>(EMAIL_TYPES.EmailKindRegistry)
      .toConstantValue(bindings.kinds);
    container
      .bind<SendRecordStore>(EMAIL_TYPES.SendRecordStore)
      .toConstantValue(bindings.sendRecords);
    container
      .bind<SuppressionList>(EMAIL_TYPES.SuppressionList)
      .toConstantValue(bindings.suppressions);
    container
      .bind<SenderInfoProvider>(EMAIL_TYPES.SenderInfoProvider)
      .toConstantValue(bindings.senderInfo);
    container
      .bind<AlertThrottle>(EMAIL_TYPES.AlertThrottle)
      .toConstantValue(bindings.alertThrottle);
    container
      .bind<EmailRenderer>(EVENT_EMAIL_TYPES.EmailRenderer)
      .toConstantValue(bindings.renderer);
    container
      .bind<EmailProvider>(EVENT_EMAIL_TYPES.EmailProvider)
      .toConstantValue(bindings.provider);
    container
      .bind<EmailIncidentReporter>(EVENT_EMAIL_TYPES.EmailIncidentReporter)
      .toConstantValue(bindings.reporter);
    container
      .bind<EmailRuntimeConfig>(EVENT_EMAIL_TYPES.EmailRuntimeConfig)
      .toConstantValue(bindings.config);
    container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(bindings.clock);
    container
      .bind<MessageHandler<EmailSendBody>>(EVENT_EMAIL_TYPES.SendEmailHandler)
      .to(SendEmailHandler);

    const handler = container.get<MessageHandler<EmailSendBody>>(
      EVENT_EMAIL_TYPES.SendEmailHandler,
    );
    const result = await handler.handle(bodyOf(), metaOf());

    expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
    expect(portsOf(calls)).toEqual(SENT_PORTS);
  });
});

describe('EmailTransientFailure', () => {
  test('Errorとして見分けられ、名前とコードで一時的な障害と分かる', () => {
    const error = new EmailTransientFailure('E_INTERNAL');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EmailTransientFailure');
    expect(error.code).toBe('E_INTERNAL');
    expect(error.message).toContain('E_INTERNAL');
  });
});

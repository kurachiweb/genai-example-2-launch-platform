import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { EmailSendBody } from '../../../lib/core/email/send-message.ts';
import type { MessageHandlingResult } from '../../../lib/core/messaging/message-contract.ts';
import { type EmailIncident, EmailRenderError } from './ports.ts';
import {
  clearCapturedLogs,
  startLogCapture,
  stopLogCapture,
} from './email-log-capture.fixtures.ts';
import {
  AFTER_SEND,
  bodyOf,
  createHarness,
  errorLogs,
  handlerLogs,
  type HarnessOptions,
  INPUT_VALUE,
  metaOf,
  NOTIFICATION_KIND,
  portsOf,
  PROVIDER_MESSAGE_ID,
  RECIPIENT,
  RENDERED,
  REQUEST_ID,
  resultLog,
  SECRET_URL,
  SEND_DURATION_MS,
  SENDER_INFO,
  SUBJECT,
  TRANSACTIONAL_KIND,
} from './send-email-handler.fixtures.ts';
import { EmailTransientFailure } from './send-email-handler.ts';

beforeAll(startLogCapture);
afterAll(stopLogCapture);
beforeEach(clearCapturedLogs);

const TRANSACTIONAL_LOG = {
  kind: TRANSACTIONAL_KIND.name,
  kindCategory: 'transactional',
  requestId: REQUEST_ID,
};

describe('SendEmailHandler 送信結果による行動', () => {
  test('送信に成功したら、送信元の設定と描画結果と追加ヘッダーで送り、送信済みを記録して完了する', async () => {
    const headers = { 'List-Unsubscribe': '<https://unsubscribe.example/u>' };
    const { handler, calls, incidents } = createHarness();

    const result = await handler.handle(bodyOf({ headers }), metaOf(2));

    expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
    expect(calls).toContainEqual({
      port: 'send',
      email: {
        from: { address: 'noreply@mail.example', name: 'Launch Stadium' },
        to: RECIPIENT,
        subject: RENDERED.subject,
        html: RENDERED.html,
        text: RENDERED.text,
        headers,
      },
    });
    expect(calls.at(-1)).toEqual({
      port: 'markSent',
      requestId: REQUEST_ID,
      kind: TRANSACTIONAL_KIND.name,
      sentAt: AFTER_SEND,
    });
    expect(incidents).toEqual([]);
    const log = resultLog();
    expect(log.level).toBe('info');
    expect(log.properties).toEqual({
      result: 'sent',
      ...TRANSACTIONAL_LOG,
      attempts: 2,
      durationMs: SEND_DURATION_MS,
      providerMessageId: PROVIDER_MESSAGE_ID,
    });
  });

  test('追加ヘッダーが無ければ空のヘッダーで送る', async () => {
    const { handler, calls } = createHarness();

    await handler.handle(bodyOf(), metaOf());

    const send = calls.find((call) => call.port === 'send');
    expect(send?.port === 'send' ? send.email.headers : undefined).toEqual({});
  });

  test('送信済みの記録に失敗しても、再送を避けるため例外にせずエラーログを出して完了する', async () => {
    const failure = new Error('D1の書き込みに失敗しました');
    const { handler, incidents } = createHarness({
      markSent: () => Promise.reject(failure),
    });

    const result = await handler.handle(bodyOf(), metaOf());

    expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
    expect(incidents).toEqual([]);
    const errors = errorLogs();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.properties).toEqual({
      error: failure,
      ...TRANSACTIONAL_LOG,
    });
    expect(resultLog().properties).toMatchObject({ result: 'sent' });
  });

  test('送信レートの上限なら、警告を出さずに60秒の待機を返す', async () => {
    const { handler, calls, incidents } = createHarness({
      outcome: { kind: 'rate-limited' },
    });

    const result = await handler.handle(bodyOf(), metaOf());

    expect(result).toEqual<MessageHandlingResult>({
      kind: 'defer',
      delaySeconds: 60,
    });
    expect(portsOf(calls)).not.toContain('tryAcquire');
    expect(portsOf(calls)).not.toContain('markSent');
    expect(incidents).toEqual([]);
    const log = resultLog();
    expect(log.level).toBe('info');
    expect(log.properties).toEqual({
      result: 'deferred',
      ...TRANSACTIONAL_LOG,
      attempts: 1,
      durationMs: SEND_DURATION_MS,
      deferCause: 'rate-limited',
      delaySeconds: 60,
    });
  });

  test('日次上限で間引きを取れたら、日次上限を通知して3600秒の待機を返す', async () => {
    const { handler, calls, incidents } = createHarness({
      outcome: { kind: 'daily-limit' },
      tryAcquire: () => Promise.resolve(true),
    });

    const result = await handler.handle(bodyOf(), metaOf());

    expect(result).toEqual<MessageHandlingResult>({
      kind: 'defer',
      delaySeconds: 3600,
    });
    expect(calls).toContainEqual({
      port: 'tryAcquire',
      name: 'email-daily-limit',
      now: AFTER_SEND,
      intervalSeconds: 3600,
    });
    expect(portsOf(calls)).not.toContain('markSent');
    expect(incidents).toEqual<EmailIncident[]>([{ kind: 'daily-limit' }]);
    const log = resultLog();
    expect(log.level).toBe('info');
    expect(log.properties).toEqual({
      result: 'deferred',
      ...TRANSACTIONAL_LOG,
      attempts: 1,
      durationMs: SEND_DURATION_MS,
      deferCause: 'daily-limit',
      delaySeconds: 3600,
    });
  });

  test('日次上限で間引きを取れなければ、通知せずに3600秒の待機を返す', async () => {
    const { handler, incidents } = createHarness({
      outcome: { kind: 'daily-limit' },
      tryAcquire: () => Promise.resolve(false),
    });

    const result = await handler.handle(bodyOf(), metaOf());

    expect(result).toEqual<MessageHandlingResult>({
      kind: 'defer',
      delaySeconds: 3600,
    });
    expect(incidents).toEqual([]);
  });

  test('日次上限の間引きに失敗したら、警告を逃さないよう日次上限を通知し、待機を試行に数えないため例外にせず3600秒の待機を返す', async () => {
    const failure = new Error('D1に接続できません');
    const { handler, incidents } = createHarness({
      outcome: { kind: 'daily-limit' },
      tryAcquire: () => Promise.reject(failure),
    });

    const result = await handler.handle(bodyOf(), metaOf());

    expect(result).toEqual<MessageHandlingResult>({
      kind: 'defer',
      delaySeconds: 3600,
    });
    expect(incidents).toEqual<EmailIncident[]>([{ kind: 'daily-limit' }]);
    const errors = errorLogs();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.properties).toEqual({
      error: failure,
      ...TRANSACTIONAL_LOG,
    });
    expect(resultLog().properties).toMatchObject({ result: 'deferred' });
  });

  test.each([1, 2, 3, 4])(
    '一時的な障害の試行%i回目は、通知せずに障害のコードを持つ例外を投げて再試行に任せる',
    async (attempts) => {
      const { handler, calls, incidents } = createHarness({
        outcome: { kind: 'temporary', code: 'E_INTERNAL' },
      });

      const error: unknown = await handler
        .handle(bodyOf(), metaOf(attempts))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EmailTransientFailure);
      expect(error).toMatchObject({ code: 'E_INTERNAL' });
      expect(portsOf(calls)).not.toContain('markSent');
      expect(incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('warning');
      expect(log.properties).toEqual({
        result: 'retrying',
        ...TRANSACTIONAL_LOG,
        attempts,
        durationMs: SEND_DURATION_MS,
        code: 'E_INTERNAL',
      });
    },
  );

  test('一時的な障害の試行5回目は、送信不能を通知して完了する', async () => {
    const { handler, incidents } = createHarness({
      outcome: { kind: 'temporary', code: 'E_INTERNAL' },
    });

    const result = await handler.handle(bodyOf(), metaOf(5));

    expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
    expect(incidents).toEqual<EmailIncident[]>([
      {
        kind: 'undeliverable',
        emailKind: TRANSACTIONAL_KIND.name,
        category: 'transactional',
        requestId: REQUEST_ID,
        code: 'E_INTERNAL',
      },
    ]);
    const log = resultLog();
    expect(log.level).toBe('error');
    expect(log.properties).toEqual({
      result: 'undeliverable',
      ...TRANSACTIONAL_LOG,
      attempts: 5,
      durationMs: SEND_DURATION_MS,
      code: 'E_INTERNAL',
    });
  });

  test('再試行しても変わらない失敗は、初回でも送信不能を通知して完了する', async () => {
    const { handler, calls, incidents } = createHarness({
      outcome: { kind: 'permanent', code: 'E_SENDER_NOT_VERIFIED' },
    });

    const result = await handler.handle(
      bodyOf({ kind: NOTIFICATION_KIND.name }),
      metaOf(1),
    );

    expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
    expect(portsOf(calls)).not.toContain('markSent');
    expect(incidents).toEqual<EmailIncident[]>([
      {
        kind: 'undeliverable',
        emailKind: NOTIFICATION_KIND.name,
        category: 'notification',
        requestId: REQUEST_ID,
        code: 'E_SENDER_NOT_VERIFIED',
      },
    ]);
    expect(resultLog().properties).toMatchObject({
      result: 'undeliverable',
      kindCategory: 'notification',
      code: 'E_SENDER_NOT_VERIFIED',
    });
  });

  test.each(['recipient-suppressed', 'recipient-not-allowed'] as const)(
    '送信結果が%sなら、通知も再試行もせずにその結果のログを出して完了する',
    async (kind) => {
      const { handler, calls, incidents } = createHarness({
        outcome: { kind },
      });

      const result = await handler.handle(bodyOf(), metaOf());

      expect(result).toEqual<MessageHandlingResult>({ kind: 'done' });
      expect(portsOf(calls)).not.toContain('markSent');
      expect(incidents).toEqual([]);
      const log = resultLog();
      expect(log.level).toBe('info');
      expect(log.properties).toEqual({
        result: kind,
        ...TRANSACTIONAL_LOG,
        attempts: 1,
        durationMs: SEND_DURATION_MS,
      });
    },
  );
});

describe('SendEmailHandler ログと通知の個人情報', () => {
  const failing = (): Promise<never> => Promise.reject(new Error('失敗'));
  const scenarios: readonly [string, HarnessOptions, Partial<EmailSendBody>][] =
    [
      ['送信', {}, {}],
      ['送信済みの記録の失敗', { markSent: failing }, {}],
      ['重複', { sent: true }, {}],
      ['期限切れ', {}, { deadline: '2030-01-01T00:00:00.000Z' }],
      ['入力の不正', {}, { input: { title: INPUT_VALUE } }],
      ['抑止中', { suppressed: true }, { kind: NOTIFICATION_KIND.name }],
      [
        '描画の失敗',
        { render: () => Promise.reject(new EmailRenderError('失敗')) },
        {},
      ],
      ['待機', { outcome: { kind: 'daily-limit' } }, {}],
      [
        '間引きの失敗',
        { outcome: { kind: 'daily-limit' }, tryAcquire: failing },
        {},
      ],
      ['再試行', { outcome: { kind: 'temporary', code: 'E_INTERNAL' } }, {}],
      [
        '送信不能',
        { outcome: { kind: 'permanent', code: 'E_VALIDATION_ERROR' } },
        {},
      ],
      ['宛先の抑止', { outcome: { kind: 'recipient-suppressed' } }, {}],
      ['宛先制限', { outcome: { kind: 'recipient-not-allowed' } }, {}],
    ];

  test.each(scenarios)(
    '%sのログと通知に、宛先・件名・本文・入力・URL・送信者情報を含めない',
    async (_label, options, overrides) => {
      const { handler, incidents } = createHarness(options);

      await handler.handle(bodyOf(overrides), metaOf()).catch(() => undefined);

      expect(handlerLogs().length).toBeGreaterThan(0);
      const serialized = JSON.stringify([
        handlerLogs().map((record) => ({
          message: record.message,
          properties: record.properties,
        })),
        incidents,
      ]);
      for (const secret of [
        RECIPIENT,
        RECIPIENT.toLowerCase(),
        SUBJECT,
        INPUT_VALUE,
        SECRET_URL,
        'link.example',
        SENDER_INFO.businessName,
        SENDER_INFO.contactEmail,
      ]) {
        expect(serialized).not.toContain(secret);
      }
    },
  );
});

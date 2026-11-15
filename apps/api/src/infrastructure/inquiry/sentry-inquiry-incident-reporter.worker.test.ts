import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, test } from 'vitest';

import { withSentryForScheduledAndQueue } from '../../../lib/workers/observability/sentry.ts';
import {
  configureRecordingLogs,
  createRecordingFetch,
  recordingSentryOptions,
} from '../../../test/support/observability-recording.ts';
import type { InquiryIncidentKind } from '../../application/inquiry/ports.ts';
import { SentryInquiryIncidentReporter } from './sentry-inquiry-incident-reporter.ts';

interface Incident {
  readonly kind: InquiryIncidentKind;
  readonly error: unknown;
  readonly attributes: { readonly inquiryId?: string };
}

interface ExceptionEvent {
  readonly level?: string;
  readonly tags?: Record<string, string>;
  readonly exception?: {
    readonly values?: readonly { readonly value?: string }[];
  };
}

const INQUIRY_ID = '01JC0MNQ7Q2M4N5P6R7S8T9V0W';

const EMAIL = 'taro.yamada@mail.example';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly Incident[],
): Promise<ExceptionEvent[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryInquiryIncidentReporter();
  const handler = withSentryForScheduledAndQueue<Env>(
    recordingSentryOptions(recording, { tracesSampleRate: 0 }),
    {
      scheduled: () => {
        for (const { kind, error, attributes } of incidents) {
          reporter.report(kind, error, attributes);
        }
      },
    },
  );
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return recording.items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload as ExceptionEvent);
}

async function reportOne(incident: Incident): Promise<ExceptionEvent> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

afterAll(() => {
  resetSync();
});

describe('SentryInquiryIncidentReporter', () => {
  test('返信の通知メールの送信要求の失敗を、errorで種類と問い合わせのIDのタグを付けて例外として送る', async () => {
    const failure = new Error('Queueへの送信に失敗しました');

    const event = await reportOne({
      kind: 'reply-notification-failed',
      error: failure,
      attributes: { inquiryId: INQUIRY_ID },
    });

    expect(event.level).toBe('error');
    expect(event.tags).toStrictEqual({
      inquiry_incident: 'reply-notification-failed',
      inquiry_id: INQUIRY_ID,
    });
    expect(event.exception?.values?.[0]?.value).toBe(failure.message);
  });

  test('添付の解放の失敗を、warningで種類のタグだけを付けて例外として送る', async () => {
    const failure = new Error('D1に書き込めません');

    const event = await reportOne({
      kind: 'attachment-release-failed',
      error: failure,
      attributes: {},
    });

    expect(event.level).toBe('warning');
    expect(event.tags).toStrictEqual({
      inquiry_incident: 'attachment-release-failed',
    });
    expect(event.exception?.values?.[0]?.value).toBe(failure.message);
  });

  test('識別子の形でない問い合わせのIDは、タグに入れずunknownに置き換える', async () => {
    const event = await reportOne({
      kind: 'reply-notification-failed',
      error: new Error('送信の失敗'),
      attributes: { inquiryId: EMAIL },
    });

    expect(event.tags).toMatchObject({ inquiry_id: 'unknown' });
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });

  test('例外のメッセージに紛れたメールアドレスは、送信前の除去処理で伏せる', async () => {
    const event = await reportOne({
      kind: 'reply-notification-failed',
      error: new Error(`宛先 ${EMAIL} へ送れません`),
      attributes: { inquiryId: INQUIRY_ID },
    });

    expect(JSON.stringify(event)).not.toContain(EMAIL);
    expect(event.exception?.values?.[0]?.value).toContain('[REDACTED]');
  });

  test.each([
    {
      kind: 'reply-notification-failed',
      level: 'error',
      message: '返信の通知メールの送信要求に失敗しました',
    },
    {
      kind: 'attachment-release-failed',
      level: 'warning',
      message: '送信に失敗したメッセージの添付ファイルを解放できませんでした',
    },
  ] as const)(
    '$kindをログにも同じレベルで、例外と問い合わせのIDを添えて残す',
    async ({ kind, level, message }) => {
      const logs = configureRecordingLogs();
      const failure = new Error('想定外の失敗');

      await reportWithSentry([
        { kind, error: failure, attributes: { inquiryId: INQUIRY_ID } },
      ]);

      const reported = logs.filter(
        (log) => log.category === 'api.inquiry.incident',
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({
        level,
        message,
        incident: kind,
        inquiryId: INQUIRY_ID,
        error: { name: 'Error', message: failure.message },
      });
    },
  );
});

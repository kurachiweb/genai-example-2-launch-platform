import { resetSync } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, test } from 'vitest';

import type { NotificationIncident } from '../../core/notifications/ports.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import { SentryNotificationIncidentReporter } from './sentry-notification-incident-reporter.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const EVENING_SLOT_KEY = 'evening:2026-11-20';

const EVENT_ID = '01JC0EVNT00000000000000001';

const EMAIL = 'taro.yamada@mail.example';

const PRODUCT_NAME = 'ローンチ太郎のノートアプリ';

const UNSUBSCRIBE_TOKEN = 'u1.0123456789abcdef0123456789abcdef';

const LEAKED_VALUES = [EMAIL, PRODUCT_NAME, UNSUBSCRIBE_TOKEN];

function decodeBody(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError('想定外の送信本文の形式です');
}

// エンベロープは改行区切りのJSONで、先頭のヘッダーの後に項目のヘッダーと本体が交互に並ぶ
function parseEnvelope(text: string): SentItem[] {
  const [, ...lines] = text.split('\n').filter((line) => line !== '');
  const items: SentItem[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? '') as { type: string };
    const payload = JSON.parse(lines[index + 1] ?? '') as Record<
      string,
      unknown
    >;
    items.push({ type: header.type, payload });
  }
  return items;
}

// 実際の初期化(重複の除外と除去処理を含む)を通し、送信先だけを差し替えて計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly NotificationIncident[],
): Promise<Record<string, unknown>[]> {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const options = (): CloudflareOptions => ({
    ...buildSentryOptions({
      dsn: TEST_DSN,
      environment: 'test',
      tracesSampleRate: 0,
    }),
    cacheClient: false,
    transportOptions: { fetch: recordingFetch as typeof fetch },
  });
  const reporter = new SentryNotificationIncidentReporter('api');
  const handler = withSentryForScheduledAndQueue<typeof env>(options, {
    scheduled: () => {
      for (const incident of incidents) {
        reporter.report(incident);
      }
    },
  });
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

async function reportOne(
  incident: NotificationIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

function configureRecordingLogs(
  appName: LoggingOptions['appName'],
): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

afterAll(() => {
  resetSync();
});

describe('SentryNotificationIncidentReporter(エラートラッキング)', () => {
  test('送り出しの遅れた送信枠を、errorで枠のキーのタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'slot-overdue',
      slotKey: EVENING_SLOT_KEY,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '送り出しが遅れている通知の送信枠があります' },
      fingerprint: ['notifications', 'slot-overdue'],
    });
    expect(event.tags).toStrictEqual({
      notifications_incident: 'slot-overdue',
      notification_slot: EVENING_SLOT_KEY,
    });
  });

  test('夜の枠の送り出しの前提の未完了を、warningで枠のキーと準備を終えていない機能の名前を添えて送る', async () => {
    const event = await reportOne({
      kind: 'evening-dispatch-incomplete',
      slotKey: EVENING_SLOT_KEY,
      missing: ['tournament-week.pairing', 'tournament-year.pairing'],
    });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: {
        message:
          '夜の通知の送信枠の送り出しの前提が、期限までにそろいませんでした',
      },
      fingerprint: ['notifications', 'evening-dispatch-incomplete'],
    });
    expect(event.tags).toStrictEqual({
      notifications_incident: 'evening-dispatch-incomplete',
      notification_slot: EVENING_SLOT_KEY,
    });
    expect(event.contexts).toMatchObject({
      notifications_incident: {
        missing_participants: [
          'tournament-week.pairing',
          'tournament-year.pairing',
        ],
      },
    });
  });

  test('前提の一覧が確定しなかった夜の枠は、準備を終えていない機能の名前をnullで送る', async () => {
    const event = await reportOne({
      kind: 'evening-dispatch-incomplete',
      slotKey: EVENING_SLOT_KEY,
      missing: null,
    });

    expect(event).toMatchObject({ level: 'warning' });
    expect(event.contexts).toMatchObject({
      notifications_incident: { missing_participants: null },
    });
  });

  test('送信者情報の未設定を、warningで送らなかった通知の件数を添えて送る', async () => {
    const event = await reportOne({ kind: 'sender-info-missing', skipped: 7 });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: {
        message: '送信者情報が未設定のため、通知メールを送りませんでした',
      },
      fingerprint: ['notifications', 'sender-info-missing'],
    });
    expect(event.tags).toStrictEqual({
      notifications_incident: 'sender-info-missing',
    });
    expect(event.contexts).toMatchObject({
      notifications_incident: { skipped: 7 },
    });
  });

  test('送信の要求の拒否を、errorでメール種別と理由のタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'send-rejected',
      emailKind: 'notifications.match-result',
      reason: 'invalid-input',
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: 'メールの送信の要求が拒否され、通知メールを送りませんでした',
      },
      fingerprint: ['notifications', 'send-rejected'],
    });
    expect(event.tags).toStrictEqual({
      notifications_incident: 'send-rejected',
      email_kind: 'notifications.match-result',
      send_rejected_reason: 'invalid-input',
    });
  });

  test('展開の停滞した通知イベントを、errorで通知イベントのIDのタグを付けて送る', async () => {
    const event = await reportOne({ kind: 'event-stalled', eventId: EVENT_ID });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '展開されないまま残っている通知イベントがあります' },
      fingerprint: ['notifications', 'event-stalled'],
    });
    expect(event.tags).toStrictEqual({
      notifications_incident: 'event-stalled',
      notification_event_id: EVENT_ID,
    });
  });

  test.each(LEAKED_VALUES)(
    '識別子と分類の形でない値(%s)は、タグとコンテキストに入れずunknownに置き換える',
    async (value) => {
      const events = await reportWithSentry([
        { kind: 'slot-overdue', slotKey: value },
        {
          kind: 'evening-dispatch-incomplete',
          slotKey: value,
          missing: [value],
        },
        { kind: 'send-rejected', emailKind: value, reason: value },
        { kind: 'event-stalled', eventId: value },
      ]);

      expect(events.map(({ tags }) => tags)).toStrictEqual([
        {
          notifications_incident: 'slot-overdue',
          notification_slot: 'unknown',
        },
        {
          notifications_incident: 'evening-dispatch-incomplete',
          notification_slot: 'unknown',
        },
        {
          notifications_incident: 'send-rejected',
          email_kind: 'unknown',
          send_rejected_reason: 'unknown',
        },
        {
          notifications_incident: 'event-stalled',
          notification_event_id: 'unknown',
        },
      ]);
      expect(events[1]?.contexts).toMatchObject({
        notifications_incident: { missing_participants: ['unknown'] },
      });
      expect(JSON.stringify(events)).not.toContain(value);
    },
  );

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: NotificationIncident = {
      kind: 'sender-info-missing',
      skipped: 1,
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryNotificationIncidentReporter(ログ)', () => {
  test('報告を、重大度に合わせたレベルで種類と識別子と件数だけを添えてアプリの名前のカテゴリに出す', () => {
    const logs = configureRecordingLogs('event');
    const reporter = new SentryNotificationIncidentReporter('event');

    reporter.report({ kind: 'slot-overdue', slotKey: EVENING_SLOT_KEY });
    reporter.report({
      kind: 'evening-dispatch-incomplete',
      slotKey: EVENING_SLOT_KEY,
      missing: ['tournament-week.pairing'],
    });
    reporter.report({ kind: 'sender-info-missing', skipped: 3 });
    reporter.report({
      kind: 'send-rejected',
      emailKind: 'notifications.match-preview',
      reason: 'too-large',
    });
    reporter.report({ kind: 'event-stalled', eventId: EVENT_ID });

    expect(logs).toStrictEqual([
      expect.objectContaining({
        level: 'error',
        category: 'event.application.notifications',
        message: '送り出しが遅れている通知の送信枠があります',
        incident: 'slot-overdue',
        slot: EVENING_SLOT_KEY,
      }),
      expect.objectContaining({
        level: 'warning',
        category: 'event.application.notifications',
        incident: 'evening-dispatch-incomplete',
        slot: EVENING_SLOT_KEY,
        missingParticipants: ['tournament-week.pairing'],
      }),
      expect.objectContaining({
        level: 'warning',
        category: 'event.application.notifications',
        incident: 'sender-info-missing',
        skipped: 3,
      }),
      expect.objectContaining({
        level: 'error',
        category: 'event.application.notifications',
        incident: 'send-rejected',
        mailKind: 'notifications.match-preview',
        reason: 'too-large',
      }),
      expect.objectContaining({
        level: 'error',
        category: 'event.application.notifications',
        incident: 'event-stalled',
        eventId: EVENT_ID,
      }),
    ]);
  });

  test('識別子と分類の形でない値は、ログにも出さない', () => {
    const logs = configureRecordingLogs('api');
    const reporter = new SentryNotificationIncidentReporter('api');

    for (const value of LEAKED_VALUES) {
      reporter.report({ kind: 'slot-overdue', slotKey: value });
      reporter.report({
        kind: 'evening-dispatch-incomplete',
        slotKey: value,
        missing: [value],
      });
      reporter.report({
        kind: 'send-rejected',
        emailKind: value,
        reason: value,
      });
      reporter.report({ kind: 'event-stalled', eventId: value });
    }

    expect(logs).toHaveLength(LEAKED_VALUES.length * 4);
    for (const value of LEAKED_VALUES) {
      expect(JSON.stringify(logs)).not.toContain(value);
    }
  });
});

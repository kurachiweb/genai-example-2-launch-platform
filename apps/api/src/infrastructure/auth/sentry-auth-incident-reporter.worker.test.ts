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
import type { AuthIncident } from '../../application/auth/ports.ts';
import { SentryAuthIncidentReporter } from './sentry-auth-incident-reporter.ts';

const EVENT_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';

const OTHER_EVENT_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W2';

const EMAIL = 'taro.yamada@mail.example';

const IP_ADDRESS = '203.0.113.7';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で通知する
async function reportWithSentry(
  incidents: readonly AuthIncident[],
): Promise<Record<string, unknown>[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryAuthIncidentReporter();
  const handler = withSentryForScheduledAndQueue<Env>(
    recordingSentryOptions(recording, { tracesSampleRate: 0 }),
    {
      scheduled: () => {
        for (const incident of incidents) {
          reporter.report(incident);
        }
      },
    },
  );
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return recording.items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

async function reportOne(
  incident: AuthIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

afterAll(() => {
  resetSync();
});

describe('SentryAuthIncidentReporter(警告の通知)', () => {
  test('漏洩パスワードの照合を省いたことを、warningで理由のタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'pwned-password-check-unavailable',
      reason: 'timeout',
    });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: {
        message: '漏洩パスワードの照合サービスを使えず、照合を省きました',
      },
      fingerprint: ['identity', 'pwned-password-check-unavailable'],
    });
    expect(event.tags).toStrictEqual({
      auth_incident: 'pwned-password-check-unavailable',
      auth_incident_reason: 'timeout',
    });
  });

  test.each(['timeout', 'network', 'status', 'invalid-response'])(
    '照合できない理由%sをそのままタグに入れる',
    async (reason) => {
      const event = await reportOne({
        kind: 'pwned-password-check-unavailable',
        reason,
      });

      expect(event.tags).toMatchObject({ auth_incident_reason: reason });
    },
  );

  test('想定外の理由は、タグに入れずunknownに置き換える', async () => {
    const event = await reportOne({
      kind: 'pwned-password-check-unavailable',
      reason: `failed for ${EMAIL}`,
    });

    expect(event.tags).toMatchObject({ auth_incident_reason: 'unknown' });
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });

  test.each([
    {
      kind: 'disposable-email-check-unavailable',
      message: '使い捨てメールアドレスの判定サービスを使えず、判定を省きました',
    },
    {
      kind: 'login-throttle-ip-missing',
      message:
        '送信元IPアドレスが不明なため、IPアドレス単位のログイン試行の記録を省きました',
    },
  ] as const)(
    '$kindをwarningで、種類の指紋とタグを付けて送る',
    async ({ kind, message }) => {
      const event = await reportOne({ kind });

      expect(event).toMatchObject({
        level: 'warning',
        logentry: { message },
        fingerprint: ['identity', kind],
      });
      expect(event.tags).toStrictEqual({ auth_incident: kind });
    },
  );
});

describe('SentryAuthIncidentReporter(エラーの通知)', () => {
  test('送り直しが続くライフサイクルイベントを、errorで件数とイベントのIDを添えて送る', async () => {
    const event = await reportOne({
      kind: 'lifecycle-events-redispatched',
      count: 12,
      stuckEventIds: [EVENT_ID, OTHER_EVENT_ID],
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message:
          '送り直しが3回目以降に達したユーザーライフサイクルイベントがあります',
      },
      fingerprint: ['identity', 'lifecycle-events-redispatched'],
    });
    expect(event.tags).toStrictEqual({
      auth_incident: 'lifecycle-events-redispatched',
    });
    expect(event.contexts).toMatchObject({
      auth_incident: {
        count: 12,
        stuck_event_ids: [EVENT_ID, OTHER_EVENT_ID],
      },
    });
  });

  test('物理削除の期限を過ぎた利用者が残っていることを、errorで件数を添えて送る', async () => {
    const event = await reportOne({ kind: 'purge-overdue', count: 3 });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '物理削除の期限を過ぎた退会ユーザーが残っています' },
      fingerprint: ['identity', 'purge-overdue'],
    });
    expect(event.tags).toStrictEqual({ auth_incident: 'purge-overdue' });
    expect(event.contexts).toMatchObject({ auth_incident: { count: 3 } });
  });

  test('ライフサイクルイベントの送信の失敗を、errorでイベントのIDのタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'lifecycle-publish-failed',
      eventId: EVENT_ID,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: 'ユーザーライフサイクルイベントの送信に失敗しました',
      },
      fingerprint: ['identity', 'lifecycle-publish-failed'],
    });
    expect(event.tags).toStrictEqual({
      auth_incident: 'lifecycle-publish-failed',
      lifecycle_event_id: EVENT_ID,
    });
  });

  test('識別子の形でないイベントのIDは、タグとコンテキストに入れずunknownに置き換える', async () => {
    const published = await reportOne({
      kind: 'lifecycle-publish-failed',
      eventId: EMAIL,
    });
    const redispatched = await reportOne({
      kind: 'lifecycle-events-redispatched',
      count: 2,
      stuckEventIds: [EVENT_ID, IP_ADDRESS],
    });

    expect(published.tags).toMatchObject({ lifecycle_event_id: 'unknown' });
    expect(redispatched.contexts).toMatchObject({
      auth_incident: { stuck_event_ids: [EVENT_ID, 'unknown'] },
    });
    expect(JSON.stringify([published, redispatched])).not.toMatch(
      new RegExp(`${EMAIL}|${IP_ADDRESS}`),
    );
  });
});

describe('SentryAuthIncidentReporter(重複の除外)', () => {
  test('同じ通知が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: AuthIncident = {
      kind: 'pwned-password-check-unavailable',
      reason: 'timeout',
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryAuthIncidentReporter(ログ)', () => {
  test('warningの通知を、種類と理由だけを添えてwarningのログに出す', () => {
    const logs = configureRecordingLogs();

    new SentryAuthIncidentReporter().report({
      kind: 'pwned-password-check-unavailable',
      reason: 'status',
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'warning',
      category: 'api.auth.incident',
      message: '漏洩パスワードの照合サービスを使えず、照合を省きました',
      incident: 'pwned-password-check-unavailable',
      reason: 'status',
    });
  });

  test('errorの通知を、種類と件数・イベントのIDだけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryAuthIncidentReporter();

    reporter.report({
      kind: 'lifecycle-events-redispatched',
      count: 5,
      stuckEventIds: [EVENT_ID],
    });
    reporter.report({ kind: 'purge-overdue', count: 1 });
    reporter.report({ kind: 'lifecycle-publish-failed', eventId: EVENT_ID });

    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      level: 'error',
      incident: 'lifecycle-events-redispatched',
      count: 5,
      stuckEventIds: [EVENT_ID],
    });
    expect(logs[1]).toMatchObject({
      level: 'error',
      incident: 'purge-overdue',
      count: 1,
    });
    expect(logs[2]).toMatchObject({
      level: 'error',
      incident: 'lifecycle-publish-failed',
      eventId: EVENT_ID,
    });
  });

  test('想定外の理由やイベントのIDに個人情報が紛れても、ログに出さない', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryAuthIncidentReporter();

    reporter.report({
      kind: 'pwned-password-check-unavailable',
      reason: `failed for ${EMAIL} from ${IP_ADDRESS}`,
    });
    reporter.report({ kind: 'lifecycle-publish-failed', eventId: EMAIL });

    expect(logs.map((log) => log['reason'] ?? log['eventId'])).toStrictEqual([
      'unknown',
      'unknown',
    ]);
    expect(JSON.stringify(logs)).not.toMatch(
      new RegExp(`${EMAIL}|${IP_ADDRESS}`),
    );
  });
});

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
import type { ProductIncident } from '../../application/product/ports.ts';
import { SentryProductIncidentReporter } from './sentry-product-incident-reporter.ts';

const EVENT_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W1';

const OTHER_EVENT_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W2';

const PRODUCT_ID = '01HZX3Y7Q2M4N5P6R7S8T9V0W3';

const EMAIL = 'taro.yamada@mail.example';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly ProductIncident[],
): Promise<Record<string, unknown>[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryProductIncidentReporter();
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
  incident: ProductIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

afterAll(() => {
  resetSync();
});

describe('SentryProductIncidentReporter(エラートラッキング)', () => {
  test('物理削除の期限を過ぎたプロダクトが残っていることを、errorで件数を添えて送る', async () => {
    const event = await reportOne({ kind: 'product-purge-overdue', count: 3 });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: '物理削除の期限を過ぎたプロダクトが残っています',
      },
      fingerprint: ['product', 'product-purge-overdue'],
    });
    expect(event.tags).toStrictEqual({
      product_incident: 'product-purge-overdue',
    });
    expect(event.contexts).toMatchObject({ product_incident: { count: 3 } });
  });

  test('送り直しが続くライフサイクルイベントを、errorで件数とイベントのIDを添えて送る', async () => {
    const event = await reportOne({
      kind: 'product-lifecycle-events-redispatched',
      count: 12,
      stuckEventIds: [EVENT_ID, OTHER_EVENT_ID],
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message:
          '送り直しが3回目以降に達したプロダクトライフサイクルイベントがあります',
      },
      fingerprint: ['product', 'product-lifecycle-events-redispatched'],
    });
    expect(event.tags).toStrictEqual({
      product_incident: 'product-lifecycle-events-redispatched',
    });
    expect(event.contexts).toMatchObject({
      product_incident: {
        count: 12,
        stuck_event_ids: [EVENT_ID, OTHER_EVENT_ID],
      },
    });
  });

  test('識別子の形でないイベントのIDは、コンテキストに入れずunknownに置き換える', async () => {
    const event = await reportOne({
      kind: 'product-lifecycle-events-redispatched',
      count: 2,
      stuckEventIds: [EVENT_ID, EMAIL],
    });

    expect(event.contexts).toMatchObject({
      product_incident: { stuck_event_ids: [EVENT_ID, 'unknown'] },
    });
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });

  test('ライフサイクルイベントの送信の失敗を、errorでイベントとプロダクトのIDのタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'product-lifecycle-publish-failed',
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: 'プロダクトライフサイクルイベントの送信に失敗しました',
      },
      fingerprint: ['product', 'product-lifecycle-publish-failed'],
    });
    expect(event.tags).toStrictEqual({
      product_incident: 'product-lifecycle-publish-failed',
      lifecycle_event_id: EVENT_ID,
      product_id: PRODUCT_ID,
    });
  });

  test('識別子の形でない送信の失敗のイベントとプロダクトのIDは、タグに入れずunknownに置き換える', async () => {
    const event = await reportOne({
      kind: 'product-lifecycle-publish-failed',
      eventId: EMAIL,
      productId: EMAIL,
    });

    expect(event.tags).toStrictEqual({
      product_incident: 'product-lifecycle-publish-failed',
      lifecycle_event_id: 'unknown',
      product_id: 'unknown',
    });
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: ProductIncident = {
      kind: 'product-purge-overdue',
      count: 1,
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryProductIncidentReporter(ログ)', () => {
  test('報告を、種類と件数・イベントのIDだけを添えてerrorのログに出す', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryProductIncidentReporter();

    reporter.report({ kind: 'product-purge-overdue', count: 1 });
    reporter.report({
      kind: 'product-lifecycle-events-redispatched',
      count: 5,
      stuckEventIds: [EVENT_ID],
    });
    reporter.report({
      kind: 'product-lifecycle-publish-failed',
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
    });

    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.product',
      message: '物理削除の期限を過ぎたプロダクトが残っています',
      incident: 'product-purge-overdue',
      count: 1,
    });
    expect(logs[1]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.product',
      incident: 'product-lifecycle-events-redispatched',
      count: 5,
      stuckEventIds: [EVENT_ID],
    });
    expect(logs[2]).toMatchObject({
      level: 'error',
      category: 'api.infrastructure.product',
      message: 'プロダクトライフサイクルイベントの送信に失敗しました',
      incident: 'product-lifecycle-publish-failed',
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
    });
  });

  test('送信の失敗のイベントとプロダクトのIDに個人情報が紛れても、ログに出さない', () => {
    const logs = configureRecordingLogs();
    const reporter = new SentryProductIncidentReporter();

    reporter.report({
      kind: 'product-lifecycle-publish-failed',
      eventId: EMAIL,
      productId: EMAIL,
    });

    expect(logs[0]).toMatchObject({ eventId: 'unknown', productId: 'unknown' });
    expect(JSON.stringify(logs)).not.toContain(EMAIL);
  });
});

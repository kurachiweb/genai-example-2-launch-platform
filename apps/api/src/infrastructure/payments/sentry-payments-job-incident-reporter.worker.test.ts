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
import type { PaymentsJobIncident } from '../../application/payments/jobs/payments-job-incidents.ts';
import { SentryPaymentsJobIncidentReporter } from './sentry-payments-job-incident-reporter.ts';

interface SentEvent {
  readonly level?: string;
  readonly message?: string;
  readonly logentry?: { readonly message?: string };
  readonly fingerprint?: readonly string[];
  readonly tags?: Record<string, string>;
  readonly contexts?: Record<string, Record<string, unknown>>;
}

const JOB = 'payments.checkout-reconciliation';

const SWEEP_JOB = 'payments.pending-checkout-sweep';

const PURCHASE_ID = '01JDPRCH000000000000000001';

const SECOND_PURCHASE_ID = '01JDPRCH000000000000000002';

const REFUND_REQUEST_ID = '01JDRFND000000000000000001';

const EMAIL = 'buyer@mail.example';

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly PaymentsJobIncident[],
): Promise<SentEvent[]> {
  const recording = createRecordingFetch();
  const reporter = new SentryPaymentsJobIncidentReporter();
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
    .map(({ payload }) => payload as SentEvent);
}

afterAll(() => {
  resetSync();
});

describe('SentryPaymentsJobIncidentReporter', () => {
  test('突合に失敗した購入を、errorで定型の文言・ジョブの名前と購入IDのタグ・ジョブごとの指紋の通知として送る', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'reconciliation-failed',
        job: JOB,
        purchaseId: PURCHASE_ID,
        error: new Error('Stripeに接続できません'),
      },
    ]);

    expect(event?.level).toBe('error');
    expect(event?.logentry?.message).toBe(
      '決済セッションとの突合に失敗した購入があります',
    );
    expect(event?.message).toBeUndefined();
    expect(event?.fingerprint).toEqual([
      'payments',
      'reconciliation-failed',
      JOB,
    ]);
    expect(event?.tags).toStrictEqual({
      job: JOB,
      payments_incident: 'reconciliation-failed',
      purchase_id: PURCHASE_ID,
      error_name: 'Error',
    });
  });

  test('同じ文言の通知を続けて送っても、重複として捨てずに購入ごとに届ける', async () => {
    const events = await reportWithSentry(
      [PURCHASE_ID, SECOND_PURCHASE_ID].map((purchaseId) => ({
        kind: 'reconciliation-failed' as const,
        job: JOB,
        purchaseId,
        error: new Error('Stripeに接続できません'),
      })),
    );

    expect(events.map((event) => event.tags?.purchase_id)).toEqual([
      PURCHASE_ID,
      SECOND_PURCHASE_ID,
    ]);
  });

  test('返金の依頼の送信の失敗を、errorで返金の依頼のIDのタグを付けて送る', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'refund-dispatch-failed',
        job: SWEEP_JOB,
        refundRequestId: REFUND_REQUEST_ID,
        error: new TypeError('想定外の値です'),
      },
    ]);

    expect(event?.level).toBe('error');
    expect(event?.logentry?.message).toBe('返金の依頼を送り直せませんでした');
    expect(event?.tags).toStrictEqual({
      job: SWEEP_JOB,
      payments_incident: 'refund-dispatch-failed',
      refund_request_id: REFUND_REQUEST_ID,
      error_name: 'TypeError',
    });
  });

  test('依頼待ちのまま残ったメールを、warningで件数と識別子をコンテキストに入れて送る', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'notice-request-failed',
        job: SWEEP_JOB,
        purchaseIds: [PURCHASE_ID, SECOND_PURCHASE_ID],
        refundRequestIds: [REFUND_REQUEST_ID],
      },
    ]);

    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(
      '依頼待ちのまま依頼できなかった決済のメールがあります',
    );
    expect(event?.fingerprint).toEqual([
      'payments',
      'notice-request-failed',
      SWEEP_JOB,
    ]);
    expect(event?.tags).toStrictEqual({
      job: SWEEP_JOB,
      payments_incident: 'notice-request-failed',
    });
    expect(event?.contexts?.payments_incident).toStrictEqual({
      count: 3,
      purchase_ids: [PURCHASE_ID, SECOND_PURCHASE_ID],
      refund_request_ids: [REFUND_REQUEST_ID],
    });
  });

  test('時間の上限に達して突合しなかった購入を、errorで残った件数をコンテキストに入れ、ジョブごとの指紋で送る', async () => {
    const [event] = await reportWithSentry([
      { kind: 'reconciliation-time-limit-reached', job: JOB, remaining: 12 },
    ]);

    expect(event?.level).toBe('error');
    expect(event?.logentry?.message).toBe(
      '時間の上限に達し、突合しなかった購入があります',
    );
    expect(event?.fingerprint).toEqual([
      'payments',
      'reconciliation-time-limit-reached',
      JOB,
    ]);
    expect(event?.tags).toStrictEqual({
      job: JOB,
      payments_incident: 'reconciliation-time-limit-reached',
    });
    expect(event?.contexts?.payments_incident).toStrictEqual({
      remaining: 12,
    });
  });

  test('送り直した返金の依頼を、warningで件数と返金の依頼のIDをコンテキストに入れて送り、識別子の形でないIDはunknownにする', async () => {
    const [event] = await reportWithSentry([
      {
        kind: 'refund-redispatched',
        job: SWEEP_JOB,
        refundRequestIds: [REFUND_REQUEST_ID, EMAIL],
      },
    ]);

    expect(event?.level).toBe('warning');
    expect(event?.logentry?.message).toBe(
      '依頼中のまま残った返金の依頼を送り直しました',
    );
    expect(event?.fingerprint).toEqual([
      'payments',
      'refund-redispatched',
      SWEEP_JOB,
    ]);
    expect(event?.tags).toStrictEqual({
      job: SWEEP_JOB,
      payments_incident: 'refund-redispatched',
    });
    expect(event?.contexts?.payments_incident).toStrictEqual({
      count: 2,
      refund_request_ids: [REFUND_REQUEST_ID, 'unknown'],
    });
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });

  test('識別子の形でない購入IDと返金の依頼のIDは、unknownに置き換えて送らない', async () => {
    const events = await reportWithSentry([
      {
        kind: 'reconciliation-failed',
        job: JOB,
        purchaseId: EMAIL,
        error: new Error(`宛先 ${EMAIL} が不正です`),
      },
      {
        kind: 'notice-request-failed',
        job: SWEEP_JOB,
        purchaseIds: [EMAIL],
        refundRequestIds: [],
      },
    ]);

    expect(events[0]?.tags?.purchase_id).toBe('unknown');
    expect(events[1]?.contexts?.payments_incident?.purchase_ids).toEqual([
      'unknown',
    ]);
    expect(JSON.stringify(events)).not.toContain(EMAIL);
  });

  test('ログにも同じレベルで、ジョブの名前と識別子と例外を添えて残す', async () => {
    const logs = configureRecordingLogs();
    const failure = new Error('Stripeに接続できません');

    await reportWithSentry([
      {
        kind: 'reconciliation-failed',
        job: JOB,
        purchaseId: PURCHASE_ID,
        error: failure,
      },
      {
        kind: 'notice-request-failed',
        job: SWEEP_JOB,
        purchaseIds: [PURCHASE_ID],
        refundRequestIds: [],
      },
    ]);

    const reported = logs.filter(
      (log) => log.category === 'api.payments.job-incident',
    );
    expect(reported).toHaveLength(2);
    expect(reported[0]).toMatchObject({
      level: 'error',
      message: '決済セッションとの突合に失敗した購入があります',
      incident: 'reconciliation-failed',
      job: JOB,
      purchaseId: PURCHASE_ID,
      error: { name: 'Error', message: failure.message },
    });
    expect(reported[1]).toMatchObject({
      level: 'warning',
      message: '依頼待ちのまま依頼できなかった決済のメールがあります',
      incident: 'notice-request-failed',
      job: SWEEP_JOB,
      purchaseIds: [PURCHASE_ID],
      refundRequestIds: [],
    });
  });
});

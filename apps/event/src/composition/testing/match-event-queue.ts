import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, vi } from 'vitest';

import { RUN_MATCH_EVENT_MESSAGE } from '../../../lib/core/messaging/contracts/match.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import { createQueueDispatcher } from '../../../lib/workers/messaging/queue-consumer.ts';
import { T0 } from '../../../lib/workers/product/testing/product-fixtures.ts';
import { MESSAGE_HANDLERS } from '../message-handlers.ts';
import { MODULES } from '../modules.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

export interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly resentDelaySeconds?: number | undefined;
}

export type QueueHandler = (
  batch: MessageBatch,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
export function matchEventEnvelope(eventId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: RUN_MATCH_EVENT_MESSAGE.type,
    id: `01JD0MMSG${String(envelopeCount).padStart(17, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId },
  };
}

function isMatchEventEnvelope(sent: unknown): boolean {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === RUN_MATCH_EVENT_MESSAGE.type
  );
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で処理する
export const defaultQueueHandler: QueueHandler = (batch, runtimeEnv, ctx) =>
  createQueueDispatcher(MESSAGE_HANDLERS, MODULES).dispatch(
    batch,
    runtimeEnv,
    ctx,
  );

// 遅延の指定(defer)はackして同じ封筒を送り直すため、送り直しの遅延秒数をsendの呼び出しの引数で確かめる
export async function dispatchMatchEvent(
  envelope: QueueEnvelope,
  handler: QueueHandler = defaultQueueHandler,
): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  // 続きの再送が後のテストの途中で届かないよう、実際には送らない
  const resendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const ctx = createExecutionContext();
  try {
    await handler(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const resend = resendSpy.mock.calls
      .filter(([sent]) => isMatchEventEnvelope(sent))
      .at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      ...(resend === undefined
        ? {}
        : { resentDelaySeconds: resend[1]?.delaySeconds }),
    };
  } finally {
    resendSpy.mockRestore();
  }
}

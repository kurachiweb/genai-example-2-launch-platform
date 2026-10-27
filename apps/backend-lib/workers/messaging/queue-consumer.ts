import { withContext } from '@logtape/logtape';
import { captureException, withScope } from '@sentry/cloudflare';

import type { AppModule } from '../../core/di/app-module.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type DeadLetterNotice,
  type DeadLetterReason,
  parseEnvelope,
  type QueueEnvelope,
} from '../../core/messaging/envelope.ts';
import type {
  MessageHandler,
  MessageHandlerRegistration,
  MessageHandlingResult,
} from '../../core/messaging/message-contract.ts';
import {
  assertRawQueueRegistrations,
  type RawMessageHandler,
  type RawQueueRegistration,
  toRawMessageType,
} from '../../core/messaging/raw-queue.ts';
import {
  assertRetryPolicy,
  DEFAULT_RETRY_POLICY,
  decideOnFailure,
  type RetryPolicy,
} from '../../core/messaging/retry-policy.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import { handleDeadLetterBatch } from './dead-letter-consumer.ts';
import { invalidDelayMessage, isValidDelaySeconds } from './queue-publisher.ts';

export interface QueueDispatcher<E extends PlatformEnv> {
  dispatch(batch: MessageBatch, env: E, ctx: ExecutionContext): Promise<void>;
}

export type QueueConsumerEnv = PlatformEnv & {
  readonly JOBS_DLQ: Queue<DeadLetterNotice>;
  readonly JOBS_QUEUE_NAME: string;
  readonly JOBS_DLQ_NAME: string;
};

export interface QueueDispatcherOptions<E> {
  readonly rawQueues?: readonly RawQueueRegistration<E>[];
}

type MessageResult = 'done' | 'deferred' | 'retried' | 'dead-lettered';

interface Outcome {
  readonly result: MessageResult;
  readonly reason?: DeadLetterReason;
  readonly errorName?: string;
}

interface ResolvedRegistration {
  readonly registration: MessageHandlerRegistration<unknown>;
  readonly policy: RetryPolicy;
}

interface ResolvedRawQueue<E> {
  readonly registration: RawQueueRegistration<E>;
  readonly policy: RetryPolicy;
  readonly messageType: string;
}

interface ConsumeContext<E extends QueueConsumerEnv> {
  readonly registrations: ReadonlyMap<string, ResolvedRegistration>;
  readonly modules: readonly Pick<AppModule, 'bindings'>[];
  readonly env: E;
  readonly ctx: ExecutionContext;
}

type RawConsumeContext<E extends QueueConsumerEnv> = Omit<
  ConsumeContext<E>,
  'registrations'
>;

const logger = getAppLogger(['event', 'queue', 'consumer']);

function indexRegistrations(
  registrations: readonly MessageHandlerRegistration<unknown>[],
): ReadonlyMap<string, ResolvedRegistration> {
  const indexed = new Map<string, ResolvedRegistration>();
  for (const registration of registrations) {
    const { type } = registration.contract;
    if (indexed.has(type)) {
      throw new RangeError(
        `メッセージの種別が重複して登録されています: ${JSON.stringify(type)}`,
      );
    }
    const policy = { ...DEFAULT_RETRY_POLICY, ...registration.retry };
    assertRetryPolicy(policy);
    indexed.set(type, { registration, policy });
  }
  return indexed;
}

function resolveRawQueues<E>(
  registrations: readonly RawQueueRegistration<E>[],
): readonly ResolvedRawQueue<E>[] {
  return registrations.map((registration) => {
    const policy = { ...DEFAULT_RETRY_POLICY, ...registration.retry };
    assertRetryPolicy(policy);
    return {
      registration,
      policy,
      messageType: toRawMessageType(registration.name),
    };
  });
}

function errorNameOf(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

async function sendDeadLetterNotice(
  message: Message,
  env: QueueConsumerEnv,
  notice: Pick<DeadLetterNotice, 'messageId' | 'type' | 'reason' | 'errorName'>,
): Promise<Outcome> {
  const { reason, errorName } = notice;
  try {
    await env.JOBS_DLQ.send({
      v: 1,
      kind: 'dead-letter-notice',
      ...notice,
      attempts: message.attempts,
      failedAt: new Date().toISOString(),
    });
  } catch (error) {
    // 通知を送れないまま破棄すると失敗の記録が残らないため、元のメッセージをQueuesの再試行に任せる
    logger.error('デッドレターへの通知の送信に失敗しました', { error });
    message.retry();
    return {
      result: 'retried',
      reason,
      ...(errorName === undefined ? {} : { errorName }),
    };
  }
  message.ack();
  return {
    result: 'dead-lettered',
    reason,
    ...(errorName === undefined ? {} : { errorName }),
  };
}

function assertDeferDelay(delaySeconds: number): void {
  if (!isValidDelaySeconds(delaySeconds)) {
    throw new RangeError(invalidDelayMessage(delaySeconds));
  }
}

async function completeHandling(
  message: Message,
  envelope: QueueEnvelope,
  env: QueueConsumerEnv,
  result: MessageHandlingResult,
): Promise<Outcome> {
  if (result.kind === 'done') {
    message.ack();
    return { result: 'done' };
  }
  assertDeferDelay(result.delaySeconds);
  // 同じIDで送り直すと新しいメッセージとして届き、試行回数を数えずに遅らせられる
  await env.JOBS_QUEUE.send(envelope, { delaySeconds: result.delaySeconds });
  message.ack();
  return { result: 'deferred' };
}

async function handleEnvelope<E extends QueueConsumerEnv>(
  message: Message,
  envelope: QueueEnvelope,
  resolved: ResolvedRegistration,
  context: ConsumeContext<E>,
): Promise<Outcome> {
  const { registration, policy } = resolved;
  const parsed = registration.contract.schema.safeParse(envelope.body);
  if (!parsed.success) {
    return sendDeadLetterNotice(message, context.env, {
      messageId: envelope.id,
      type: envelope.type,
      reason: 'invalid-body',
      errorName: undefined,
    });
  }
  try {
    const container = createInvocationContainer(
      {
        env: context.env,
        executionCtx: context.ctx,
        info: {
          kind: 'queue',
          correlationId: envelope.id,
          clientIp: undefined,
        },
      },
      context.modules,
    );
    const handler = container.get<MessageHandler<unknown>>(
      registration.handler,
    );
    const result = await handler.handle(parsed.data, {
      id: envelope.id,
      type: envelope.type,
      attempts: message.attempts,
      sentAt: new Date(envelope.sentAt),
    });
    return await completeHandling(message, envelope, context.env, result);
  } catch (error) {
    return handleFailure(message, context.env, policy, error, {
      messageId: envelope.id,
      type: envelope.type,
    });
  }
}

async function handleFailure(
  message: Message,
  env: QueueConsumerEnv,
  policy: RetryPolicy,
  error: unknown,
  identity: Pick<DeadLetterNotice, 'messageId' | 'type'>,
): Promise<Outcome> {
  logger.warn('メッセージの処理に失敗しました', { error });
  const errorName = errorNameOf(error);
  const decision = decideOnFailure(policy, message.attempts);
  if (decision.kind === 'retry') {
    message.retry({ delaySeconds: decision.delaySeconds });
    return {
      result: 'retried',
      ...(errorName === undefined ? {} : { errorName }),
    };
  }
  return sendDeadLetterNotice(message, env, {
    ...identity,
    reason: 'handler-failed',
    errorName,
  });
}

async function consumeMessage<E extends QueueConsumerEnv>(
  message: Message,
  envelope: QueueEnvelope,
  context: ConsumeContext<E>,
): Promise<void> {
  const startedAt = Date.now();
  const resolved = context.registrations.get(envelope.type);
  const outcome =
    resolved === undefined
      ? await sendDeadLetterNotice(message, context.env, {
          messageId: envelope.id,
          type: envelope.type,
          reason: 'unknown-type',
          errorName: undefined,
        })
      : await handleEnvelope(message, envelope, resolved, context);
  logger.info('メッセージを処理しました', {
    ...outcome,
    messageType: envelope.type,
    attempts: message.attempts,
    durationMs: Date.now() - startedAt,
  });
}

async function consumeInvalidEnvelope(
  message: Message,
  env: QueueConsumerEnv,
): Promise<void> {
  const startedAt = Date.now();
  const outcome = await sendDeadLetterNotice(message, env, {
    messageId: undefined,
    type: undefined,
    reason: 'invalid-envelope',
    errorName: undefined,
  });
  logger.info('メッセージを処理しました', {
    ...outcome,
    attempts: message.attempts,
    durationMs: Date.now() - startedAt,
  });
}

async function consumeOne<E extends QueueConsumerEnv>(
  message: Message,
  context: ConsumeContext<E>,
): Promise<void> {
  const parsed = parseEnvelope(message.body);
  if (!parsed.ok) {
    await consumeInvalidEnvelope(message, context.env);
    return;
  }
  const { envelope } = parsed;
  // バッチ全体の相関IDはハンドラーが付けるため、処理単位であるメッセージごとのスコープで封筒のIDに置き換え、ログとエラーレポートを結び付ける
  await withScope((scope) => {
    scope.setTag('correlation_id', envelope.id);
    return withContext({ correlationId: envelope.id }, () =>
      retryOnUnexpectedError(message, () =>
        consumeMessage(message, envelope, context),
      ),
    );
  });
}

async function retryOnUnexpectedError(
  message: Message,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    // 1件の想定外の失敗で残りのメッセージの処理を止めないよう、そのメッセージだけをQueuesの再試行に任せる。例外を投げ直さないため、計装の代わりにエラートラッキングへ送る
    logger.error('メッセージの処理中に想定外のエラーが発生しました', {
      error,
    });
    captureException(error);
    message.retry();
  }
}

async function consumeJobsBatch<E extends QueueConsumerEnv>(
  batch: MessageBatch,
  context: ConsumeContext<E>,
): Promise<void> {
  for (const message of batch.messages) {
    // 封筒を読めたメッセージはその相関IDの文脈の中で受け止めるため、ここで受け止めるのは封筒を読む前と読めなかった場合の失敗だけになる
    await retryOnUnexpectedError(message, () => consumeOne(message, context));
  }
}

async function handleRawMessage<E extends QueueConsumerEnv>(
  message: Message,
  rawQueue: ResolvedRawQueue<E>,
  context: RawConsumeContext<E>,
): Promise<Outcome> {
  try {
    const container = createInvocationContainer(
      {
        env: context.env,
        executionCtx: context.ctx,
        info: { kind: 'queue', correlationId: message.id, clientIp: undefined },
      },
      context.modules,
    );
    const handler = container.get<RawMessageHandler>(
      rawQueue.registration.handler,
    );
    await handler.handle(message.body, {
      id: message.id,
      attempts: message.attempts,
      timestamp: message.timestamp,
    });
    message.ack();
    return { result: 'done' };
  } catch (error) {
    // 本文は送信元が決めた形式で個人情報を含み得るため、通知にはQueuesのメッセージIDと登録の種別だけを載せる
    return handleFailure(message, context.env, rawQueue.policy, error, {
      messageId: message.id,
      type: rawQueue.messageType,
    });
  }
}

async function consumeRawMessage<E extends QueueConsumerEnv>(
  message: Message,
  rawQueue: ResolvedRawQueue<E>,
  context: RawConsumeContext<E>,
): Promise<void> {
  const startedAt = Date.now();
  const outcome = await handleRawMessage(message, rawQueue, context);
  logger.info('メッセージを処理しました', {
    ...outcome,
    messageType: rawQueue.messageType,
    attempts: message.attempts,
    durationMs: Date.now() - startedAt,
  });
}

async function consumeRawBatch<E extends QueueConsumerEnv>(
  batch: MessageBatch,
  rawQueue: ResolvedRawQueue<E>,
  context: RawConsumeContext<E>,
): Promise<void> {
  for (const message of batch.messages) {
    // 封筒が無いため、QueuesのメッセージIDを相関IDにしてログとエラーレポートを結び付ける
    await withScope((scope) => {
      scope.setTag('correlation_id', message.id);
      return withContext({ correlationId: message.id }, () =>
        retryOnUnexpectedError(message, () =>
          consumeRawMessage(message, rawQueue, context),
        ),
      );
    });
  }
}

// 環境を指定したAppModuleは既定のAppModuleへ代入できないため、コンテナに必要なbindingsだけを受け取る
export function createQueueDispatcher<E extends QueueConsumerEnv>(
  registrations: readonly MessageHandlerRegistration<unknown>[],
  modules: readonly Pick<AppModule, 'bindings'>[],
  options: QueueDispatcherOptions<E> = {},
): QueueDispatcher<E> {
  const indexed = indexRegistrations(registrations);
  const rawRegistrations = options.rawQueues ?? [];
  const rawQueues = resolveRawQueues(rawRegistrations);
  let rawQueuesVerified = false;
  return {
    async dispatch(batch, env, ctx) {
      // Queue名は環境の値で決まるため、本体とデッドレターとの重複は最初のバッチを受けた時点で確かめる
      if (!rawQueuesVerified) {
        assertRawQueueRegistrations(
          rawRegistrations,
          [env.JOBS_QUEUE_NAME, env.JOBS_DLQ_NAME],
          env,
        );
        rawQueuesVerified = true;
      }
      if (batch.queue === env.JOBS_QUEUE_NAME) {
        await consumeJobsBatch(batch, {
          registrations: indexed,
          modules,
          env,
          ctx,
        });
        return;
      }
      if (batch.queue === env.JOBS_DLQ_NAME) {
        handleDeadLetterBatch(batch);
        return;
      }
      const rawQueue = rawQueues.find(
        ({ registration }) => registration.queueName(env) === batch.queue,
      );
      if (rawQueue !== undefined) {
        await consumeRawBatch(batch, rawQueue, { modules, env, ctx });
        return;
      }
      logger.error('本体とデッドレターのどちらでもないQueueのバッチです', {
        queue: batch.queue,
      });
      throw new Error(
        `本体とデッドレターのどちらでもないQueueのバッチです: ${batch.queue}`,
      );
    },
  };
}

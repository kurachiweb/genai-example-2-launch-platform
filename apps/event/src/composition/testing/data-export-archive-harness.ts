import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { unzipSync } from 'fflate';
import { type MockInstance, vi } from 'vitest';

import { dataExports } from '../../../db/schema/data-export/data-exports.ts';
import {
  DATA_EXPORT_GENERATE_MESSAGE,
  DATA_EXPORT_WATCHDOG_MESSAGE,
} from '../../../lib/core/data-export/data-export-messages.ts';
import { EMAIL_SEND_MESSAGE } from '../../../lib/core/email/send-message.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import { exportIdOf } from '../../../lib/workers/data-export/testing/data-export-fixtures.ts';
import { T0 } from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { createQueueDispatcher } from '../../../lib/workers/messaging/queue-consumer.ts';
import { MESSAGE_HANDLERS } from '../message-handlers.ts';
import { MODULES } from '../modules.ts';
import { db, exportRowOf, OWNER } from './data-export-archive-seed.ts';
import { readZipEntries } from './zip-entries.ts';

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

export const EXPORT = 1;

export const OWNER_EMAIL = 'exporter@mail.example';

export const BUSY_DEFER_SECONDS = 1200;

export const HOUR_MS = 3_600_000;

// エントリのqueueハンドラーはSentryの計装が記録用のクライアントを置き換えるため、計装の内側の振り分けを直接呼ぶ
const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, MODULES);

let envelopeCount = 0;

let sendSpy: MockInstance<typeof env.JOBS_QUEUE.send> | undefined;

let deadLetterSpy: MockInstance<typeof env.JOBS_DLQ.send> | undefined;

// Queueへの送信を実際には送らずに記録し、続きの再送や完了のメールの依頼が後のテストの途中で届かないようにする
export function installQueueSpies(): MockInstance<typeof env.JOBS_QUEUE.send> {
  const spy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  sendSpy = spy;
  deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  return spy;
}

export function deadLetterCount(): number {
  return deadLetterSpy?.mock.calls.length ?? 0;
}

function envelopeOf(type: string, exportId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type,
    id: `01JE0DXENV${String(envelopeCount).padStart(16, '0')}`,
    sentAt: T0.toISOString(),
    body: { exportId },
  };
}

export function generateEnvelope(exportId = exportIdOf(EXPORT)): QueueEnvelope {
  return envelopeOf(DATA_EXPORT_GENERATE_MESSAGE.type, exportId);
}

export function watchdogEnvelope(exportId = exportIdOf(EXPORT)): QueueEnvelope {
  return envelopeOf(DATA_EXPORT_WATCHDOG_MESSAGE.type, exportId);
}

export interface DispatchOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
}

export interface DispatchOptions {
  readonly attempts?: number;
  readonly runtimeEnv?: Env;
}

export async function dispatch(
  envelope: QueueEnvelope,
  options: DispatchOptions = {},
): Promise<DispatchOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    {
      id: envelope.id,
      timestamp: T0,
      attempts: options.attempts ?? 1,
      body: envelope,
    },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const ctx = createExecutionContext();
  await dispatcher.dispatch(batch, options.runtimeEnv ?? env, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  return {
    acked: explicitAcks.includes(message.id),
    retried: retryMessages.some(({ msgId }) => msgId === message.id),
  };
}

export interface SentEmail {
  readonly kind: string;
  readonly to: string;
  readonly idempotencyKey: string | undefined;
}

function sentCalls(): readonly (readonly [QueueEnvelope, unknown])[] {
  return (sendSpy?.mock.calls ?? []).map(
    ([sent, options]) => [sent as QueueEnvelope, options] as const,
  );
}

export function sentEmails(): SentEmail[] {
  return sentCalls()
    .filter(([{ type }]) => type === EMAIL_SEND_MESSAGE.type)
    .map(([{ body }]) => {
      const { kind, to, idempotencyKey } = body as SentEmail;
      return { kind, to, idempotencyKey };
    });
}

export function deferredGenerationDelays(): (number | undefined)[] {
  return sentCalls()
    .filter(([{ type }]) => type === DATA_EXPORT_GENERATE_MESSAGE.type)
    .map(([, options]) => (options as { delaySeconds?: number }).delaySeconds);
}

export function archiveKeyOf(index = EXPORT): string {
  return `data-exports/${exportIdOf(index)}.zip`;
}

export async function listArchiveKeys(): Promise<string[]> {
  const listed = await env.FILES_BUCKET.list({ prefix: 'data-exports/' });
  return listed.objects.map(({ key }) => key);
}

export async function readArchive(index = EXPORT) {
  const object = await env.FILES_BUCKET.get(archiveKeyOf(index));
  if (object === null) {
    throw new Error('ZIPが保存されていない');
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  return {
    object,
    bytes,
    files: unzipSync(bytes),
    entries: readZipEntries(bytes),
  };
}

export async function seedQueuedExport(): Promise<void> {
  await db.insert(dataExports).values(exportRowOf(EXPORT, OWNER));
}

function passThrough(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property);
  return typeof value === 'function'
    ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
    : value;
}

export function failingUploadEnv(): Env {
  const bucket = new Proxy(env.FILES_BUCKET, {
    get(target, property) {
      if (property === 'createMultipartUpload') {
        return () => Promise.reject(new Error('R2の障害'));
      }
      return passThrough(target, property);
    },
  });
  return { ...env, FILES_BUCKET: bucket };
}

function interruptingUpload(
  upload: R2MultipartUpload,
  interrupt: () => Promise<void>,
): R2MultipartUpload {
  return new Proxy(upload, {
    get(target, property) {
      if (property !== 'complete') {
        return passThrough(target, property);
      }
      return async (parts: R2UploadedPart[]): Promise<R2Object> => {
        const completed = await target.complete(parts);
        await interrupt();
        return completed;
      };
    },
  });
}

// ZIPの保存の完了の直後、要求の状態の確定の前に割り込み、完了を待つ間に状況が変わる場合を再現する
export function envInterruptingAfterUpload(
  interrupt: () => Promise<void>,
): Env {
  const bucket = new Proxy(env.FILES_BUCKET, {
    get(target, property) {
      if (property !== 'createMultipartUpload') {
        return passThrough(target, property);
      }
      return async (
        ...args: Parameters<R2Bucket['createMultipartUpload']>
      ): Promise<R2MultipartUpload> =>
        interruptingUpload(
          await target.createMultipartUpload(...args),
          interrupt,
        );
    },
  });
  return { ...env, FILES_BUCKET: bucket };
}

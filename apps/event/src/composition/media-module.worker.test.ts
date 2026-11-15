import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import {
  IMAGE_CACHE_CONTROL,
  type ImageVariantName,
} from '../../common-lib/media/image-variants.ts';
import {
  encodeFileNameHeader,
  UPLOAD_FILE_NAME_HEADER,
  type UploadedFile,
} from '../../common-lib/media/upload-protocol.ts';
import type { ModerationFinding } from '../../lib/core/media/media-file.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  PURGE_IMAGE_CACHE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../lib/core/media/media-messages.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { decideOnFailure } from '../../lib/core/messaging/retry-policy.ts';
import {
  clearMediaState,
  createRecordingQueue,
  listObjectKeys,
  type RecordingQueue,
} from '../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import { MODERATION_RETRY_POLICY } from '../application/media/moderate-image-handler.ts';
import { PURGE_IMAGE_CACHE_RETRY_POLICY } from '../application/media/purge-image-cache-handler.ts';
import {
  pngOf,
  RED,
} from '../infrastructure/media/wasm-moderation-image-renderer.fixtures.ts';
import worker from '../index.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';

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

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds?: number;
}

interface SmokeStatus {
  readonly moderationStatus: string;
  readonly location: string;
  readonly quarantineReasons: readonly string[];
  readonly findings: readonly ModerationFinding[];
}

const EVENT_ORIGIN = 'https://event.launch.example';

// Workers統合テストの変数の画像配信のホスト名(専用のホスト)
const IMAGES_ORIGIN = 'https://images.test.example';

const SMOKE_IMAGES_PATH = '/internal/media/smoke/images';
const SMOKE_TOKEN = 'media-smoke-token-for-media-pipeline-tests';
const DELIVERED_VARIANT: ImageVariantName = 'square-sm';
const MESSAGE_TIMESTAMP = new Date('2026-11-01T03:04:05.678Z');

// 代替の判定は判定用画像の寸法で結果を決める(99×99は不適切、98×98は一時的な失敗)
const FLAGGED_SIDE = 99;
const TRANSIENT_SIDE = 98;

// 最初の要求でエントリと画像の変換・判定用画像のwasmを読み込むため、カバレッジの計測中は既定の5秒を超えることがある
const PIPELINE_TEST_TIMEOUT_MILLISECONDS = 60_000;

const alwaysAllowedRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

let queue: RecordingQueue;
let handledEnvelopes: number;

// 送られたメッセージを実際のQueueへ流さずに記録し、テストが順にバッチとして処理させる
function runtimeEnv(): Env {
  return {
    ...env,
    MEDIA_SMOKE_TOKEN: SMOKE_TOKEN,
    JOBS_QUEUE: queue.queue,
    IP_RATE_LIMITER: alwaysAllowedRateLimiter,
  };
}

async function fetchWorker(
  url: string,
  init: RequestInit<IncomingRequestCfProperties> = {},
): Promise<Response> {
  const { fetch } = worker;
  if (fetch === undefined) {
    throw new Error('イベントサーバーのエントリにfetchハンドラーが無い');
  }
  const ctx = createExecutionContext();
  const response = await fetch(
    new Request<unknown, IncomingRequestCfProperties>(url, init),
    runtimeEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function sendSmoke(
  path: string,
  init: { readonly method: string; readonly body?: Uint8Array },
): Promise<Response> {
  const headers = new Headers({ Authorization: `Bearer ${SMOKE_TOKEN}` });
  if (init.body !== undefined) {
    headers.set('Content-Length', String(init.body.length));
    headers.set('Content-Type', 'image/png');
    headers.set(UPLOAD_FILE_NAME_HEADER, encodeFileNameHeader('smoke.png'));
  }
  return fetchWorker(`${EVENT_ORIGIN}${SMOKE_IMAGES_PATH}${path}`, {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

async function uploadPng(width: number, height: number): Promise<UploadedFile> {
  const response = await sendSmoke('', {
    method: 'POST',
    body: await pngOf(width, height, () => RED),
  });
  expect(response.status).toBe(201);
  const { data } = await response.json<{ data: UploadedFile }>();
  return data;
}

async function statusOf(fileId: string): Promise<SmokeStatus> {
  const response = await sendSmoke(`/${fileId}`, { method: 'GET' });
  expect(response.status).toBe(200);
  const { data } = await response.json<{ data: SmokeStatus }>();
  return data;
}

async function changeQuarantine(
  fileId: string,
  action: 'quarantine' | 'release',
): Promise<void> {
  const response = await sendSmoke(`/${fileId}/${action}`, {
    method: 'POST',
  });
  expect(response.status).toBe(202);
}

async function deliver(objectKey: string): Promise<Response> {
  return fetchWorker(`${IMAGES_ORIGIN}/${objectKey}/${DELIVERED_VARIANT}.webp`);
}

async function expectDelivered(objectKey: string): Promise<void> {
  const response = await deliver(objectKey);
  await response.body?.cancel();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('image/webp');
  expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
}

async function expectNotDelivered(objectKey: string): Promise<void> {
  const response = await deliver(objectKey);
  await response.body?.cancel();
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
}

// 記録したメッセージのうち、まだ処理させていない指定の種別のものを取り出す
function takeSent(type: string): QueueEnvelope[] {
  const pending = queue.sent.slice(handledEnvelopes);
  const taken = pending.filter((envelope) => envelope.type === type);
  expect(taken.length).toBeGreaterThan(0);
  handledEnvelopes = queue.sent.length;
  return taken;
}

function pendingTypes(): string[] {
  return queue.sent.slice(handledEnvelopes).map((envelope) => envelope.type);
}

// retry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function dispatch(
  envelopes: readonly QueueEnvelope[],
  attempts = 1,
): Promise<readonly MessageOutcome[]> {
  const { queue: handleQueue } = worker;
  if (handleQueue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  const batch = createMessageBatch(
    env.JOBS_QUEUE_NAME,
    envelopes.map((envelope) => ({
      id: envelope.id,
      timestamp: MESSAGE_TIMESTAMP,
      attempts,
      body: envelope,
    })),
  );
  const retrySpies = batch.messages.map((message) =>
    vi.spyOn(message, 'retry'),
  );
  const ctx = createExecutionContext();
  await handleQueue(batch, runtimeEnv(), ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  return batch.messages.map(({ id }, index) => {
    const retried = retryMessages.some(({ msgId }) => msgId === id);
    const delaySeconds =
      retrySpies[index]?.mock.calls.at(-1)?.[0]?.delaySeconds;
    return {
      acked: explicitAcks.includes(id),
      retried,
      ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
    };
  });
}

async function dispatchAll(type: string): Promise<void> {
  const outcomes = await dispatch(takeSent(type));
  expect(outcomes.every((outcome) => outcome.acked && !outcome.retried)).toBe(
    true,
  );
}

function objectKeyOf(file: UploadedFile): string {
  if (file.objectKey === null) {
    throw new Error('画像用の用途のファイルにオブジェクトキーが無い');
  }
  return file.objectKey;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  queue = createRecordingQueue();
  handledEnvelopes = 0;
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearMediaState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのメディアの結線', () => {
  test(
    '不適切と判定した画像は隔離バケットへ移り、パージの依頼を処理した後の配信は404になる',
    async () => {
      const file = await uploadPng(FLAGGED_SIDE, FLAGGED_SIDE);
      const objectKey = objectKeyOf(file);
      await expectDelivered(objectKey);

      await dispatchAll(MODERATE_IMAGE_MESSAGE.type);

      expect(await statusOf(file.fileId)).toStrictEqual({
        moderationStatus: 'flagged',
        location: 'quarantine',
        quarantineReasons: ['auto'],
        findings: [
          {
            source: 'labels',
            category: 'Explicit',
            label: 'Explicit',
            confidence: 99,
          },
        ],
      });
      expect(await listObjectKeys('images')).toEqual([]);
      expect(await listObjectKeys('quarantine')).toEqual([objectKey]);
      const [purge] = takeSent(PURGE_IMAGE_CACHE_MESSAGE.type);
      expect(purge?.body).toStrictEqual({ objectKeys: [objectKey] });
      expect(await dispatch(purge === undefined ? [] : [purge])).toStrictEqual([
        { acked: true, retried: false },
      ]);
      await expectNotDelivered(objectKey);
    },
    PIPELINE_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '問題の無い画像は判定の前後で配信され続け、移動もパージも依頼しない',
    async () => {
      const file = await uploadPng(120, 90);
      const objectKey = objectKeyOf(file);
      await expectDelivered(objectKey);

      await dispatchAll(MODERATE_IMAGE_MESSAGE.type);

      expect(await statusOf(file.fileId)).toStrictEqual({
        moderationStatus: 'passed',
        location: 'images',
        quarantineReasons: [],
        findings: [],
      });
      expect(pendingTypes()).toEqual([]);
      await expectDelivered(objectKey);
    },
    PIPELINE_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '管理者操作の隔離と解除は、移動の依頼とパージの依頼の処理を経て配信を止め、再び配信する',
    async () => {
      const file = await uploadPng(120, 90);
      const objectKey = objectKeyOf(file);
      await dispatchAll(MODERATE_IMAGE_MESSAGE.type);

      await changeQuarantine(file.fileId, 'quarantine');
      await dispatchAll(RELOCATE_FILES_MESSAGE.type);
      await dispatchAll(PURGE_IMAGE_CACHE_MESSAGE.type);

      expect(await statusOf(file.fileId)).toMatchObject({
        location: 'quarantine',
        quarantineReasons: ['admin_action'],
      });
      await expectNotDelivered(objectKey);

      await changeQuarantine(file.fileId, 'release');
      await dispatchAll(RELOCATE_FILES_MESSAGE.type);

      expect(await statusOf(file.fileId)).toMatchObject({
        location: 'images',
        quarantineReasons: [],
      });
      expect(pendingTypes()).toEqual([]);
      await expectDelivered(objectKey);
    },
    PIPELINE_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '判定サービスの一時的な失敗は判定の再試行の方針の間隔で再試行され、画像を公開したままにする',
    async () => {
      const file = await uploadPng(TRANSIENT_SIDE, TRANSIENT_SIDE);
      const objectKey = objectKeyOf(file);
      const expected = decideOnFailure(MODERATION_RETRY_POLICY, 1);
      if (expected.kind !== 'retry') {
        throw new Error('1回目の失敗は再試行になるはず');
      }

      const outcomes = await dispatch(takeSent(MODERATE_IMAGE_MESSAGE.type));

      expect(outcomes).toStrictEqual([
        { acked: false, retried: true, delaySeconds: expected.delaySeconds },
      ]);
      expect(expected.delaySeconds).toBe(
        MODERATION_RETRY_POLICY.baseDelaySeconds,
      );
      expect(await statusOf(file.fileId)).toMatchObject({
        moderationStatus: 'pending',
        location: 'images',
      });
      await expectDelivered(objectKey);
    },
    PIPELINE_TEST_TIMEOUT_MILLISECONDS,
  );
});

describe('メディアのメッセージの処理の登録', () => {
  test('判定とパージは専用の再試行の方針で、移動は既定の方針で登録する', () => {
    const retryOf = (type: string) =>
      MESSAGE_HANDLERS.find(({ contract }) => contract.type === type)?.retry;
    const registered = new Set(
      MESSAGE_HANDLERS.map(({ contract }) => contract.type),
    );

    expect(registered).toContain(MODERATE_IMAGE_MESSAGE.type);
    expect(registered).toContain(RELOCATE_FILES_MESSAGE.type);
    expect(registered).toContain(PURGE_IMAGE_CACHE_MESSAGE.type);
    expect(retryOf(MODERATE_IMAGE_MESSAGE.type)).toBe(MODERATION_RETRY_POLICY);
    expect(retryOf(PURGE_IMAGE_CACHE_MESSAGE.type)).toBe(
      PURGE_IMAGE_CACHE_RETRY_POLICY,
    );
    expect(retryOf(RELOCATE_FILES_MESSAGE.type)).toBeUndefined();
  });
});

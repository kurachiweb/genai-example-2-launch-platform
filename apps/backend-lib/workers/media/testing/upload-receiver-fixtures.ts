import { resetSync } from '@logtape/logtape';
import {
  CloudflareClient,
  type Event,
  getCurrentScope,
} from '@sentry/cloudflare';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';

import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
} from '../../../../common-lib/media/media-types.ts';
import { createDatabase } from '../../../../db/client.ts';
import { mediaFiles } from '../../../../db/schema/media/media-files.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import type { MediaLocation } from '../../../core/media/media-file.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
  UploadInput,
  UploadOutcome,
} from '../../../core/media/ports.ts';
import type { UploadRejection } from '../../../core/media/upload-precheck.ts';
import {
  defineUploadPurpose,
  type UploadPurpose,
} from '../../../core/media/upload-purpose.ts';
import { MESSAGE_CONTRACTS } from '../../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../core/messaging/envelope.ts';
import type { MessageContract } from '../../../core/messaging/message-contract.ts';
import { systemClock } from '../../../core/time/clock.ts';
import { ensureLoggingConfigured } from '../../logging/configure-logging.ts';
import { createMessagePublisher } from '../../messaging/queue-publisher.ts';
import { D1MediaFileStore } from '../d1-media-file-store.ts';
import { R2MediaObjectStore } from '../r2-media-object-store.ts';
import { MediaUploadReceiver } from '../upload-receiver.ts';

export const IMAGE_PURPOSE: UploadPurpose = defineUploadPurpose({
  name: 'product-image',
  storage: 'images',
  uploaderKinds: ['user'],
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: 5_242_880,
});

export const FILE_PURPOSE: UploadPurpose = defineUploadPurpose({
  name: 'inquiry-attachment',
  storage: 'files',
  uploaderKinds: ['user'],
  allowedTypes: ATTACHMENT_MEDIA_TYPES,
  maxBytes: MAX_UPLOAD_BYTES,
});

export const USER_ID = '01JC0USER00000000000000001';

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

export const OBJECT_KEY_PATTERN = /^[0-9a-f]{32}$/u;

const BUCKETS: Readonly<Record<MediaLocation, R2Bucket>> = {
  images: env.IMAGES_BUCKET,
  files: env.FILES_BUCKET,
  quarantine: env.QUARANTINE_BUCKET,
};

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const encoder = new TextEncoder();

export const db = createDatabase(env.DB);

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

function uint32BE(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

function padTo(header: readonly number[], length: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(length, header.length));
  bytes.set(header);
  return bytes;
}

// 署名とIHDRだけを持つPNG。寸法の読み取りは先頭だけを見るため、残りは0で埋める
export function pngBytes(
  width: number,
  height: number,
  length = 64,
): Uint8Array {
  return padTo(
    [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...uint32BE(13),
      ...Array.from('IHDR', (character) => character.charCodeAt(0)),
      ...uint32BE(width),
      ...uint32BE(height),
      8,
      6,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ],
    length,
  );
}

export function jpegPrefixBytes(length = 64): Uint8Array {
  return padTo([0xff, 0xd8, 0xff, 0xe0], length);
}

export function pdfBytes(): Uint8Array {
  return utf8('%PDF-1.7\n%âã\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
}

export function svgBytes(attributes = 'width="120" height="80"'): Uint8Array {
  return utf8(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="10" height="10"/></svg>`,
  );
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

export interface TrackedStream {
  readonly stream: ReadableStream<Uint8Array>;
  pulledChunks(): number;
}

// 本文を読んだかを確かめるため、取り出された塊の数を数える
export function trackedStreamOf(
  ...chunks: readonly Uint8Array[]
): TrackedStream {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[pulled];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(chunk);
      },
    },
    // 既定の待ち行列の大きさ(1)では作った直後に1つ目の塊を取り出すため、読まれるまで取り出さない
    { highWaterMark: 0 },
  );
  return { stream, pulledChunks: () => pulled };
}

export function streamOf(
  ...chunks: readonly Uint8Array[]
): ReadableStream<Uint8Array> {
  return trackedStreamOf(...chunks).stream;
}

// 1MiBを超える本文を、塊の境界が先頭の検査の範囲をまたぐように分ける
export function chunksOf(bytes: Uint8Array, size: number): Uint8Array[] {
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, (index + 1) * size),
  );
}

export function uploadInputOf(
  bytes: Uint8Array | ReadableStream<Uint8Array> | null,
  overrides: Partial<UploadInput> = {},
): UploadInput {
  const isBytes = bytes instanceof Uint8Array;
  return {
    purpose: IMAGE_PURPOSE,
    uploader: { kind: 'user', id: USER_ID },
    contentLength: isBytes ? String(bytes.length) : null,
    contentType: 'image/png',
    fileNameHeader: encodeURIComponent('photo.png'),
    body: isBytes ? streamOf(bytes) : bytes,
    ...overrides,
  };
}

export interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

export function createRecordingQueue(failure?: Error): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

export interface ReceiverParts {
  readonly files?: MediaFileStore;
  readonly objects?: MediaObjectStore;
  readonly queue?: Queue<QueueEnvelope>;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly appName?: 'api' | 'event';
  readonly contracts?: readonly MessageContract<string, unknown>[];
}

export function createFileStore(): MediaFileStore {
  return new D1MediaFileStore(
    db,
    systemClock,
    createUlidGenerator(systemClock),
  );
}

export function createObjectStore(): MediaObjectStore {
  return new R2MediaObjectStore(env);
}

export function createReceiver(parts: ReceiverParts = {}): MediaUploadReceiver {
  const ids = createUlidGenerator(systemClock);
  return new MediaUploadReceiver({
    files: parts.files ?? createFileStore(),
    objects: parts.objects ?? createObjectStore(),
    publisher: createMessagePublisher(
      parts.queue ?? createRecordingQueue().queue,
      parts.contracts ?? MESSAGE_CONTRACTS,
      ids,
      systemClock,
    ),
    ids,
    appName: parts.appName ?? 'api',
    ...(parts.randomBytes === undefined
      ? {}
      : { randomBytes: parts.randomBytes }),
  });
}

// 採番の衝突を再現するため、決めたバイト列を順に返す乱数源
export function sequenceRandomBytes(
  ...sequence: readonly Uint8Array[]
): (length: number) => Uint8Array {
  let index = 0;
  return (length) => {
    const bytes =
      sequence[index] ?? crypto.getRandomValues(new Uint8Array(length));
    index += 1;
    return bytes;
  };
}

export function keyBytesOf(byte: number): Uint8Array {
  return new Uint8Array(16).fill(byte);
}

export function hexKeyOf(byte: number): string {
  return byte.toString(16).padStart(2, '0').repeat(16);
}

export function acceptedFileOf(outcome: UploadOutcome) {
  if (!outcome.ok) {
    throw new Error(`受付を期待したが拒否された: ${outcome.rejection.code}`);
  }
  return outcome.file;
}

export function rejectionOf(outcome: UploadOutcome): UploadRejection {
  if (outcome.ok) {
    throw new Error('拒否を期待したが受け付けられた');
  }
  return outcome.rejection;
}

export async function readRecord(id: string) {
  const [row] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id));
  return row;
}

export async function countRecords(): Promise<number> {
  return (await db.select({ id: mediaFiles.id }).from(mediaFiles)).length;
}

export async function listObjectKeys(
  location: MediaLocation,
): Promise<string[]> {
  const listed = await BUCKETS[location].list();
  return listed.objects.map((object) => object.key);
}

export async function readObject(
  location: MediaLocation,
  key: string,
): Promise<R2ObjectBody | null> {
  return BUCKETS[location].get(key);
}

export async function putExistingObject(
  location: MediaLocation,
  key: string,
  text: string,
): Promise<void> {
  await BUCKETS[location].put(key, text);
}

export async function clearMediaState(): Promise<void> {
  await db.delete(mediaFiles);
  for (const bucket of Object.values(BUCKETS)) {
    const listed = await bucket.list();
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
    }
  }
}

export async function expectNothingStored(): Promise<boolean> {
  const keys = await Promise.all(
    (['images', 'files', 'quarantine'] as const).map(listObjectKeys),
  );
  return (
    (await countRecords()) === 0 && keys.every((each) => each.length === 0)
  );
}

export interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

export function recordLogs(appName: 'api' | 'event' = 'api'): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

export function installRecordingSentry(): Event[] {
  const events: Event[] = [];
  const client = new CloudflareClient({
    dsn: TEST_DSN,
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
    beforeSend: (event) => {
      events.push(event);
      return null;
    },
  });
  getCurrentScope().setClient(client);
  client.init();
  return events;
}

export function resetObservability(): void {
  getCurrentScope().setClient(undefined);
}

export function resetLogging(): void {
  resetSync();
}

export function failingFileStore(
  overrides: Partial<MediaFileStore>,
  removedIds: string[] = [],
): MediaFileStore {
  const store = createFileStore();
  return new Proxy(store, {
    get(target, property) {
      if (property === 'remove') {
        return async (ids: readonly string[]) => {
          removedIds.push(...ids);
          return (overrides.remove ?? target.remove.bind(target))(ids);
        };
      }
      const override: unknown = Reflect.get(overrides, property);
      if (typeof override === 'function') {
        return override;
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

export function failingObjectStore(
  overrides: Partial<MediaObjectStore>,
): MediaObjectStore {
  const store = createObjectStore();
  return new Proxy(store, {
    get(target, property) {
      const override: unknown = Reflect.get(overrides, property);
      if (typeof override === 'function') {
        return override;
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

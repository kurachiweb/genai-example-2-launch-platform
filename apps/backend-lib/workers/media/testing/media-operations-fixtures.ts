import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { mediaFileQuarantineReasons } from '../../../../db/schema/media/media-file-quarantine-reasons.ts';
import { mediaFiles } from '../../../../db/schema/media/media-files.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import type { MediaLocation } from '../../../core/media/media-file.ts';
import { PURGE_IMAGE_CACHE_MESSAGE } from '../../../core/media/media-messages.ts';
import type {
  MediaEraser,
  MediaFileStore,
  MediaObjectStore,
} from '../../../core/media/ports.ts';
import { MESSAGE_CONTRACTS } from '../../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../core/messaging/envelope.ts';
import { systemClock } from '../../../core/time/clock.ts';
import { createMessagePublisher } from '../../messaging/queue-publisher.ts';
import { MediaFileEraser } from '../media-eraser.ts';
import { MediaFilesService } from '../media-files-service.ts';
import { R2MediaObjectStore } from '../r2-media-object-store.ts';
import {
  createStore,
  db,
  FILE_PURPOSE,
  fileIdOf,
  objectKeyOf,
  T0,
  USER_A,
} from './media-file-store-fixtures.ts';
import { createRecordingQueue } from './upload-receiver-fixtures.ts';

type FileRow = typeof mediaFiles.$inferInsert;

const BUCKETS: Readonly<Record<MediaLocation, R2Bucket>> = {
  images: env.IMAGES_BUCKET,
  files: env.FILES_BUCKET,
  quarantine: env.QUARANTINE_BUCKET,
};

export const LOCATIONS: readonly MediaLocation[] = [
  'images',
  'files',
  'quarantine',
];

// 1行が17個のバインド変数を使うため、D1の上限(100)に収まる行数ずつ追加する
const FILE_ROWS_PER_INSERT = 5;

export interface OperationParts {
  readonly files?: MediaFileStore;
  readonly objects?: MediaObjectStore;
  readonly queue?: Queue<QueueEnvelope>;
  readonly eraser?: MediaEraser;
}

export interface Operations {
  readonly eraser: MediaFileEraser;
  readonly service: MediaFilesService;
  readonly sent: readonly QueueEnvelope[];
}

export function createOperations(parts: OperationParts = {}): Operations {
  const recording = createRecordingQueue();
  const files = parts.files ?? createStore();
  const objects = parts.objects ?? new R2MediaObjectStore(env);
  const eraser = new MediaFileEraser({
    files,
    objects,
    publisher: createMessagePublisher(
      parts.queue ?? recording.queue,
      MESSAGE_CONTRACTS,
      createUlidGenerator(systemClock),
      systemClock,
    ),
  });
  const service = new MediaFilesService({
    files,
    objects,
    eraser: parts.eraser ?? eraser,
    appName: 'api',
  });
  return { eraser, service, sent: recording.sent };
}

export function filePurposeRow(): Partial<FileRow> {
  return {
    purpose: FILE_PURPOSE,
    storage: 'files',
    location: 'files',
    contentType: 'application/pdf',
    originalFileName: 'report.pdf',
    width: null,
    height: null,
    moderationStatus: 'not_required',
  };
}

function fileRowOf(index: number, columns: Partial<FileRow>): FileRow {
  return {
    id: fileIdOf(index),
    objectKey: objectKeyOf(index),
    purpose: 'product-image',
    storage: 'images',
    location: 'images',
    ownerKind: 'user',
    ownerId: USER_A,
    originalFileName: 'photo.png',
    contentType: 'image/png',
    byteSize: 1024,
    width: 640,
    height: 480,
    storedAt: T0,
    attachedAt: null,
    moderationStatus: 'passed',
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  };
}

// 保有者単位の上限件数を超える行を短い時間で用意するため、分割した追加を1つの一括実行にまとめる
export async function insertManyFiles(
  indexes: readonly number[],
  columnsOf: (index: number) => Partial<FileRow> = () => ({}),
): Promise<void> {
  const rows = indexes.map((index) => fileRowOf(index, columnsOf(index)));
  const statements: BatchItem<'sqlite'>[] = [];
  for (let start = 0; start < rows.length; start += FILE_ROWS_PER_INSERT) {
    statements.push(
      db
        .insert(mediaFiles)
        .values(rows.slice(start, start + FILE_ROWS_PER_INSERT)),
    );
  }
  const [first, ...rest] = statements;
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

export function rangeOf(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

export async function putObject(
  location: MediaLocation,
  index: number,
  text = `content-${String(index)}`,
): Promise<void> {
  await BUCKETS[location].put(objectKeyOf(index), text);
}

export async function objectExists(
  location: MediaLocation,
  index: number,
): Promise<boolean> {
  return (await BUCKETS[location].head(objectKeyOf(index))) !== null;
}

export async function listObjectKeys(
  location: MediaLocation,
): Promise<string[]> {
  const listed = await BUCKETS[location].list();
  return listed.objects.map((object) => object.key);
}

export async function clearMediaState(): Promise<void> {
  await db.delete(mediaFileQuarantineReasons);
  await db.delete(mediaFiles);
  for (const bucket of Object.values(BUCKETS)) {
    let listed = await bucket.list();
    while (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key));
      listed = await bucket.list();
    }
  }
}

export async function readAllRows() {
  const files = await db.select().from(mediaFiles).orderBy(asc(mediaFiles.id));
  const reasons = await db
    .select()
    .from(mediaFileQuarantineReasons)
    .orderBy(asc(mediaFileQuarantineReasons.id));
  return { files, reasons };
}

export function purgeMessagesOf(
  sent: readonly QueueEnvelope[],
): (readonly string[])[] {
  return sent
    .filter((envelope) => envelope.type === PURGE_IMAGE_CACHE_MESSAGE.type)
    .map(
      (envelope) =>
        (envelope.body as { objectKeys: readonly string[] }).objectKeys,
    );
}

export function purgedKeysOf(sent: readonly QueueEnvelope[]): string[] {
  return purgeMessagesOf(sent).flat().toSorted();
}

export async function readText(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  return new Response(body).text();
}

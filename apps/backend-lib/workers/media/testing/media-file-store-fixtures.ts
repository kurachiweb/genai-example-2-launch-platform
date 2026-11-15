import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { createDatabase, type Database } from '../../../../db/client.ts';
import { mediaFileQuarantineReasons } from '../../../../db/schema/media/media-file-quarantine-reasons.ts';
import { mediaFiles } from '../../../../db/schema/media/media-files.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import type {
  ModerationFinding,
  QuarantineReason,
} from '../../../core/media/media-file.ts';
import type {
  MediaFileStore,
  NewMediaFileRecord,
} from '../../../core/media/ports.ts';
import type { Clock } from '../../../core/time/clock.ts';
import { D1MediaFileStore } from '../d1-media-file-store.ts';

const MAX_BOUND_PARAMETERS = 100;

// 1行が17個のバインド変数を使うため、上限に収まる行数ずつ追加する
const FILE_ROWS_PER_INSERT = 5;

export const T0 = new Date('2026-11-01T00:00:00.000Z');

export const IMAGE_PURPOSE = 'product-image';
export const FILE_PURPOSE = 'inquiry-attachment';

export const USER_A = '01JC0USER00000000000000001';
export const USER_B = '01JC0USER00000000000000002';
export const USER_C = '01JC0USER00000000000000003';
export const ADMIN_A = '01JC0ADM000000000000000001';

export const FINDINGS: readonly ModerationFinding[] = [
  {
    source: 'labels',
    category: 'Violence',
    label: 'Graphic Violence',
    confidence: 97.5,
  },
  { source: 'svg', violation: 'disallowed_element', target: 'script' },
];

export const db = createDatabase(env.DB);

type FileRow = typeof mediaFiles.$inferInsert;

export interface TestClock extends Clock {
  set(instant: Date): void;
}

export function createTestClock(start: Date): TestClock {
  let current = start;
  return {
    now: () => new Date(current),
    set: (instant) => {
      current = instant;
    },
  };
}

export function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

export function fileIdOf(index: number): string {
  return `01JC0F${String(index).padStart(20, '0')}`;
}

export function objectKeyOf(index: number): string {
  return index.toString(16).padStart(32, '0');
}

export function fileIdsOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => fileIdOf(index + 1));
}

export function createStore(
  clock: Clock = createTestClock(T0),
  database: Database = db,
): MediaFileStore {
  return new D1MediaFileStore(database, clock, createUlidGenerator(clock));
}

export function recordOf(
  index: number,
  overrides: Partial<NewMediaFileRecord> = {},
): NewMediaFileRecord {
  return {
    id: fileIdOf(index),
    objectKey: objectKeyOf(index),
    purpose: IMAGE_PURPOSE,
    storage: 'images',
    owner: { kind: 'user', id: USER_A },
    originalFileName: 'photo.png',
    contentType: 'image/png',
    byteSize: 1024,
    width: 640,
    height: 480,
    moderationStatus: 'pending',
    ...overrides,
  };
}

function fileRowOf(index: number, columns: Partial<FileRow>): FileRow {
  return {
    id: fileIdOf(index),
    objectKey: objectKeyOf(index),
    purpose: IMAGE_PURPOSE,
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

export async function insertFile(
  index: number,
  columns: Partial<FileRow> = {},
): Promise<void> {
  await db.insert(mediaFiles).values(fileRowOf(index, columns));
}

export async function insertFiles(count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, index) =>
    fileRowOf(index + 1, {}),
  );
  for (let start = 0; start < rows.length; start += FILE_ROWS_PER_INSERT) {
    await db
      .insert(mediaFiles)
      .values(rows.slice(start, start + FILE_ROWS_PER_INSERT));
  }
}

export async function insertReason(
  index: number,
  reason: QuarantineReason,
  createdAt: Date = T0,
): Promise<void> {
  await db.insert(mediaFileQuarantineReasons).values({
    fileId: fileIdOf(index),
    reason,
    createdAt,
    updatedAt: createdAt,
  });
}

export async function readFile(index: number) {
  const [row] = await db
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.id, fileIdOf(index)));
  return row;
}

export async function readFileIds(): Promise<string[]> {
  const rows = await db
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .orderBy(asc(mediaFiles.id));
  return rows.map((row) => row.id);
}

export async function readReasons() {
  return db
    .select({
      id: mediaFileQuarantineReasons.id,
      fileId: mediaFileQuarantineReasons.fileId,
      reason: mediaFileQuarantineReasons.reason,
      createdAt: mediaFileQuarantineReasons.createdAt,
    })
    .from(mediaFileQuarantineReasons)
    .orderBy(
      asc(mediaFileQuarantineReasons.fileId),
      asc(mediaFileQuarantineReasons.reason),
    );
}

export async function clearMediaTables(): Promise<void> {
  await db.delete(mediaFileQuarantineReasons);
  await db.delete(mediaFiles);
}

// 問い合わせの有無と分割の仕方を確かめるため、D1へ渡した各文のプレースホルダーの数を記録する
function createRecordingD1(placeholderCounts: number[]): D1Database {
  return {
    prepare: (query) => {
      placeholderCounts.push(query.match(/\?/g)?.length ?? 0);
      return env.DB.prepare(query);
    },
    batch: (statements) => env.DB.batch(statements),
    exec: (query) => env.DB.exec(query),
    withSession: (constraint) => env.DB.withSession(constraint),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも実装する
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: () => Promise.reject(new Error('テストでは使わない')),
  };
}

export function createRecordingStore(): {
  readonly store: MediaFileStore;
  readonly placeholderCounts: readonly number[];
} {
  const placeholderCounts: number[] = [];
  return {
    store: createStore(
      createTestClock(T0),
      createDatabase(createRecordingD1(placeholderCounts)),
    ),
    placeholderCounts,
  };
}

export function expectWithinBindLimit(
  placeholderCounts: readonly number[],
): void {
  expect(placeholderCounts.length).toBeGreaterThan(0);
  for (const count of placeholderCounts) {
    expect(count).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
  }
}

export function expectSplitWithinBindLimit(
  placeholderCounts: readonly number[],
): void {
  expect(placeholderCounts.length).toBeGreaterThan(1);
  expectWithinBindLimit(placeholderCounts);
}

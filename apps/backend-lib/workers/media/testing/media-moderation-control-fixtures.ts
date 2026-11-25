import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { mediaFiles } from '../../../../db/schema/media/media-files.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import type { MediaEraser, MediaFileStore } from '../../../core/media/ports.ts';
import { MESSAGE_CONTRACTS } from '../../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../core/messaging/envelope.ts';
import { systemClock } from '../../../core/time/clock.ts';
import { createMessagePublisher } from '../../messaging/queue-publisher.ts';
import { MediaFileEraser } from '../media-eraser.ts';
import { D1MediaModerationControl } from '../media-moderation-control.ts';
import { R2MediaObjectStore } from '../r2-media-object-store.ts';
import {
  after,
  createStore,
  createTestClock,
  db,
  fileIdOf,
  objectKeyOf,
  readFile,
  T0,
  USER_A,
} from './media-file-store-fixtures.ts';
import { createHookedQueue } from './media-quarantine-fixtures.ts';

// 呼び出し側の記録の代わりに、他の操作が使わない番号のファイルの記録を挿入する
const CALLER_MARK_INDEX = 90;

export const OPERATED_AT = after(60_000);

export interface ModerationControlParts {
  readonly files?: MediaFileStore;
  readonly queue?: Queue<QueueEnvelope>;
  readonly eraser?: MediaEraser;
}

export interface ModerationControlUnderTest {
  readonly control: D1MediaModerationControl;
  readonly sent: readonly QueueEnvelope[];
}

export function createModerationControl(
  parts: ModerationControlParts = {},
): ModerationControlUnderTest {
  const recording = createHookedQueue();
  const files = parts.files ?? createStore();
  const publisher = createMessagePublisher(
    parts.queue ?? recording.queue,
    MESSAGE_CONTRACTS,
    createUlidGenerator(systemClock),
    systemClock,
  );
  const clock = createTestClock(OPERATED_AT);
  return {
    control: new D1MediaModerationControl({
      db,
      files,
      publisher,
      eraser:
        parts.eraser ??
        new MediaFileEraser({
          files,
          objects: new R2MediaObjectStore(env),
          publisher,
        }),
      clock,
      ids: createUlidGenerator(clock),
      appName: 'api',
    }),
    sent: recording.sent,
  };
}

export function callerStatements(
  options: { readonly violate?: boolean } = {},
): readonly BatchItem<'sqlite'>[] {
  return [
    db.insert(mediaFiles).values({
      id: fileIdOf(CALLER_MARK_INDEX),
      objectKey:
        options.violate === true ? sql`NULL` : objectKeyOf(CALLER_MARK_INDEX),
      purpose: 'caller-mark',
      storage: 'files',
      location: 'files',
      ownerKind: 'user',
      ownerId: USER_A,
      originalFileName: 'mark.txt',
      contentType: 'text/plain',
      byteSize: 1,
      moderationStatus: 'not_required',
      createdAt: T0,
      updatedAt: T0,
    }),
  ];
}

export async function callerMarkExists(): Promise<boolean> {
  return (await readFile(CALLER_MARK_INDEX)) !== undefined;
}

// 状態を読んだ後・一括の書き込みの前に別の操作が割り込んだ状況を、最初の読み取りの直後に処理を差し込んで再現する
export function racingFileStore(race: () => Promise<void>): MediaFileStore {
  const store = createStore();
  let raced = false;
  return new Proxy(store, {
    get(target, property) {
      if (property === 'findViews') {
        return async (ids: readonly string[]) => {
          const views = await target.findViews(ids);
          if (!raced) {
            raced = true;
            await race();
          }
          return views;
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  MediaFileView,
  MediaLocation,
} from '../../../lib/core/media/media-file.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
  ModerationRecord,
} from '../../../lib/core/media/ports.ts';
import type { MessageMeta } from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ModerateImageHandler } from './moderate-image-handler.ts';
import type { ModerationConfig } from './moderation-config.ts';
import type {
  MediaIncidentReporter,
  ModerationImage,
  ModerationImagePlan,
  ModerationImageRenderer,
  ModerationImageRenderResult,
  ModerationOutcome,
} from './ports.ts';

export const LOG_CATEGORY = ['event', 'media', 'moderation'] as const;

export const FILE_ID = '01J8Z3Y7Q2M4N5P6R7S8T9V0W1';

export const OBJECT_KEY = '0123456789abcdef'.repeat(2);

export const ORIGINAL_FILE_NAME = '秘密の試作品.png';

export const STARTED_AT = new Date('2030-01-15T12:00:00.000Z');

export const DURATION_MS = 1234;

export const ORIGINAL_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

export const RENDERED_IMAGE: ModerationImage = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7]),
  format: 'jpeg',
};

export const CONFIG: ModerationConfig = {
  minConfidence: 60,
  blockedCategories: ['Explicit', 'Violence'],
};

export function viewOf(overrides: Partial<MediaFileView> = {}): MediaFileView {
  return {
    id: FILE_ID,
    objectKey: OBJECT_KEY,
    purpose: 'product-image',
    storage: 'images',
    location: 'images',
    owner: { kind: 'user', id: '01J8Z3Y7Q2M4N5P6R7S8T9V0W2' },
    originalFileName: ORIGINAL_FILE_NAME,
    contentType: 'image/png',
    byteSize: ORIGINAL_BYTES.byteLength,
    width: 1280,
    height: 720,
    stored: true,
    attached: true,
    deletedAt: null,
    eraseRequested: false,
    moderationStatus: 'pending',
    quarantineReasons: [],
    quarantined: false,
    createdAt: new Date('2030-01-15T11:59:00.000Z'),
    ...overrides,
  };
}

export function metaOf(attempts = 1): MessageMeta {
  return {
    id: 'message-1',
    type: 'media.moderate-image',
    attempts,
    sentAt: new Date('2030-01-15T11:59:30.000Z'),
  };
}

export type PortCall =
  | { readonly port: 'findViews'; readonly ids: readonly string[] }
  | {
      readonly port: 'get';
      readonly location: MediaLocation;
      readonly key: string;
    }
  | {
      readonly port: 'render';
      readonly original: Uint8Array;
      readonly plan: ModerationImagePlan;
    }
  | {
      readonly port: 'detect';
      readonly image: ModerationImage;
      readonly minConfidence: number;
    }
  | {
      readonly port: 'recordModeration';
      readonly id: string;
      readonly record: ModerationRecord;
    }
  | { readonly port: 'reconcile'; readonly fileIds: readonly string[] };

export type Incident =
  | {
      readonly kind: 'undetermined';
      readonly fileId: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'rejectedByService';
      readonly fileId: string;
      readonly reason: string;
    }
  | { readonly kind: 'misconfigured'; readonly reason: string };

export interface HarnessOptions {
  // undefinedは記録が無い場合を表す
  readonly file?: MediaFileView | undefined;
  // 保存先ごとの原本の内容。無い保存先はオブジェクトが無い
  readonly objects?: Partial<Record<MediaLocation, Uint8Array>>;
  readonly render?: ModerationImageRenderResult;
  readonly outcome?: ModerationOutcome;
  // 条件付きの更新が、並行した重複配信に先を越されて効かなかった場合を再現する
  readonly recorded?: boolean;
  readonly moved?: number;
}

export interface Harness {
  readonly handler: ModerateImageHandler;
  readonly calls: PortCall[];
  readonly incidents: Incident[];
}

const unexpected = (name: string) => (): Promise<never> =>
  Promise.reject(new Error(`判定の処理は${name}を呼ばない`));

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function createFileStore(
  options: HarnessOptions,
  calls: PortCall[],
): MediaFileStore {
  const file = 'file' in options ? options.file : viewOf();
  return {
    findViews: (ids) => {
      calls.push({ port: 'findViews', ids });
      return Promise.resolve(
        new Map(
          file === undefined || !ids.includes(file.id)
            ? []
            : [[file.id, file] as const],
        ),
      );
    },
    recordModeration: (id, record) => {
      calls.push({ port: 'recordModeration', id, record });
      return Promise.resolve(options.recorded ?? true);
    },
    insertReceiving: unexpected('insertReceiving'),
    markStored: unexpected('markStored'),
    attach: unexpected('attach'),
    markDeleted: unexpected('markDeleted'),
    markEraseRequested: unexpected('markEraseRequested'),
    remove: unexpected('remove'),
    addReasons: unexpected('addReasons'),
    removeReasons: unexpected('removeReasons'),
    updateLocation: unexpected('updateLocation'),
    findIdsOwnedBy: unexpected('findIdsOwnedBy'),
    findOwnerIds: unexpected('findOwnerIds'),
    findOwnedImageIdsByReason: unexpected('findOwnedImageIdsByReason'),
    findEraseCandidates: unexpected('findEraseCandidates'),
    findModerationRequeueCandidates: unexpected(
      'findModerationRequeueCandidates',
    ),
    findLocationMismatches: unexpected('findLocationMismatches'),
    listQuarantined: unexpected('listQuarantined'),
  };
}

function createObjectStore(
  options: HarnessOptions,
  calls: PortCall[],
): MediaObjectStore {
  const objects = options.objects ?? { images: ORIGINAL_BYTES };
  return {
    get: (location, key) => {
      calls.push({ port: 'get', location, key });
      const bytes = key === OBJECT_KEY ? objects[location] : undefined;
      return Promise.resolve(
        bytes === undefined
          ? undefined
          : {
              body: streamOf(bytes),
              size: bytes.byteLength,
              contentType: undefined,
            },
      );
    },
    putIfAbsent: unexpected('putIfAbsent'),
    exists: unexpected('exists'),
    delete: unexpected('delete'),
    copy: unexpected('copy'),
  };
}

function createIncidentReporter(incidents: Incident[]): MediaIncidentReporter {
  return {
    undetermined: (fileId, reason) => {
      incidents.push({ kind: 'undetermined', fileId, reason });
    },
    rejectedByService: (fileId, reason) => {
      incidents.push({ kind: 'rejectedByService', fileId, reason });
    },
    misconfigured: (reason) => {
      incidents.push({ kind: 'misconfigured', reason });
    },
  };
}

// 開始と終了の2回の読み取りで所要時間がDURATION_MSになる時計
function createClock(): Clock {
  let reads = 0;
  return {
    now: () => {
      reads += 1;
      return new Date(STARTED_AT.getTime() + (reads > 1 ? DURATION_MS : 0));
    },
  };
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const calls: PortCall[] = [];
  const incidents: Incident[] = [];
  const renderer: ModerationImageRenderer = {
    render: (input) => {
      calls.push({ port: 'render', ...input });
      return Promise.resolve(
        options.render ?? { ok: true, image: RENDERED_IMAGE },
      );
    },
  };
  return {
    handler: new ModerateImageHandler({
      files: createFileStore(options, calls),
      objects: createObjectStore(options, calls),
      renderer,
      provider: {
        detect: (image, minConfidence) => {
          calls.push({ port: 'detect', image, minConfidence });
          return Promise.resolve(
            options.outcome ?? { kind: 'labels', labels: [] },
          );
        },
      },
      incidents: createIncidentReporter(incidents),
      relocator: {
        reconcile: (fileIds) => {
          calls.push({ port: 'reconcile', fileIds });
          return Promise.resolve({ moved: options.moved ?? 0 });
        },
      },
      config: CONFIG,
      clock: createClock(),
    }),
    calls,
    incidents,
  };
}

export function portsOf(calls: readonly PortCall[]): string[] {
  return calls.map(({ port }) => port);
}

export function recordsOf(calls: readonly PortCall[]): ModerationRecord[] {
  return calls.flatMap((call) =>
    call.port === 'recordModeration' ? [call.record] : [],
  );
}

export function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const records: LogRecord[] = [];

export function startLogCapture(): void {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
}

export function stopLogCapture(): void {
  resetSync();
}

export function clearCapturedLogs(): void {
  records.length = 0;
}

export function handlerLogs(): LogRecord[] {
  const expected = LOG_CATEGORY.join('.');
  return records.filter((record) => record.category.join('.') === expected);
}

export function resultLog(): LogRecord {
  const logs = handlerLogs();
  const [log] = logs;
  if (logs.length !== 1 || log === undefined) {
    throw new Error(`結果のログが1件ではありません: ${String(logs.length)}件`);
  }
  return log;
}

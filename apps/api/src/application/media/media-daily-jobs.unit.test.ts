import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import {
  MODERATE_IMAGE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from '../../../lib/core/media/media-messages.ts';
import type {
  MediaEraser,
  MediaFileStore,
} from '../../../lib/core/media/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import {
  fileIdOf,
  InMemoryMediaFileStore,
  RecordingEraser,
  RecordingPublisher,
} from '../../../test/support/media-daily-job-fakes.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../test/support/media-file-view.ts';
import {
  ExpiredFileErasureJob,
  LocationReconciliationJob,
  MEDIA_DAILY_JOB_LIMIT,
  MEDIA_JOB_TYPES,
  MediaDailyJobError,
  type MediaJobMessagePublisher,
  MODERATION_PENDING_TIMEOUT_MS,
  ModerationRequeueJob,
  SOFT_DELETED_RETENTION_MS,
  UNATTACHED_RETENTION_MS,
} from './media-daily-jobs.ts';

const SCHEDULED_TIME = new Date('2026-11-02T12:21:00.000Z');
const SOFT_DELETED_BOUNDARY = new Date('2026-10-20T12:21:00.000Z');
const UNATTACHED_BOUNDARY = new Date('2026-11-01T12:21:00.000Z');
const PENDING_BOUNDARY = new Date('2026-11-02T11:21:00.000Z');
const SECOND_MS = 1000;

const CONTEXT: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: toBusinessDateTime(SCHEDULED_TIME),
};

const ERASURE_CATEGORY = 'api.media.expired-file-erasure';
const REQUEUE_CATEGORY = 'api.media.moderation-requeue';
const RECONCILIATION_CATEGORY = 'api.media.location-reconciliation';

function shifted(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

function attachedFile(
  serial: number,
  overrides: Partial<MediaFileView> = {},
): MediaFileView {
  return mediaFileViewOf({
    id: fileIdOf(serial),
    attached: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function unattachedFile(serial: number, createdAt: Date): MediaFileView {
  return attachedFile(serial, { attached: false, createdAt });
}

function softDeletedFile(serial: number, deletedAt: Date): MediaFileView {
  return attachedFile(serial, { deletedAt });
}

function pendingImage(
  serial: number,
  createdAt: Date,
  overrides: Partial<MediaFileView> = {},
): MediaFileView {
  return imageFileViewOf({
    id: fileIdOf(serial),
    attached: true,
    location: 'images',
    moderationStatus: 'pending',
    quarantineReasons: [],
    quarantined: false,
    createdAt,
    ...overrides,
  });
}

function placedImage(
  serial: number,
  location: MediaFileView['location'],
  reasons: MediaFileView['quarantineReasons'],
): MediaFileView {
  return imageFileViewOf({
    id: fileIdOf(serial),
    attached: true,
    location,
    moderationStatus: 'passed',
    quarantineReasons: reasons,
    quarantined: reasons.length > 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function serials(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => from + index);
}

interface Jobs {
  readonly store: InMemoryMediaFileStore;
  readonly eraser: RecordingEraser;
  readonly publisher: RecordingPublisher;
  readonly erasure: ScheduledJobHandler;
  readonly requeue: ScheduledJobHandler;
  readonly reconciliation: ScheduledJobHandler;
}

function jobsOf(files: readonly MediaFileView[]): Jobs {
  const store = new InMemoryMediaFileStore(files);
  const eraser = new RecordingEraser(store);
  const publisher = new RecordingPublisher();
  return {
    store,
    eraser,
    publisher,
    erasure: new ExpiredFileErasureJob(store.asStore(), eraser),
    requeue: new ModerationRequeueJob(store.asStore(), publisher),
    reconciliation: new LocationReconciliationJob(store.asStore(), publisher),
  };
}

async function failureOf(run: Promise<void>): Promise<unknown> {
  return run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

const records: LogRecord[] = [];

function logsOf(category: string, level: LogRecord['level']): unknown[] {
  return records
    .filter(
      (record) =>
        record.category.join('.') === category && record.level === level,
    )
    .map(({ properties }) => properties);
}

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('日次バッチの定数', () => {
  test('1回の上限は1,000件、論理削除の保持は13日、未紐付けの保持は24時間、判定待ちの期限は1時間である', () => {
    expect(MEDIA_DAILY_JOB_LIMIT).toBe(1000);
    expect(SOFT_DELETED_RETENTION_MS).toBe(13 * 24 * 3_600_000);
    expect(UNATTACHED_RETENTION_MS).toBe(24 * 3_600_000);
    expect(MODERATION_PENDING_TIMEOUT_MS).toBe(3_600_000);
  });
});

describe('ExpiredFileErasureJob', () => {
  test('予定時刻から論理削除の13日前(その時刻を含む)と未紐付けの24時間前を境に、上限より1件多く候補を照会する', async () => {
    const { store, erasure } = jobsOf([]);

    await erasure.run(CONTEXT);

    expect(store.eraseCandidateCalls).toEqual([
      {
        deletedBefore: shifted(SOFT_DELETED_BOUNDARY, 1),
        unattachedCreatedBefore: UNATTACHED_BOUNDARY,
        limit: 1001,
      },
    ]);
  });

  test('論理削除から13日を1秒過ぎたものと13日ちょうどのものを消し、13日に1秒足りないものを残す', async () => {
    const { store, eraser, erasure } = jobsOf([
      softDeletedFile(1, shifted(SOFT_DELETED_BOUNDARY, -SECOND_MS)),
      softDeletedFile(2, SOFT_DELETED_BOUNDARY),
      softDeletedFile(3, shifted(SOFT_DELETED_BOUNDARY, SECOND_MS)),
    ]);

    await erasure.run(CONTEXT);

    expect(eraser.calls).toEqual([[fileIdOf(1), fileIdOf(2)]]);
    expect(store.ids()).toEqual([fileIdOf(3)]);
  });

  test('アップロードから24時間を1秒過ぎた未紐付けのファイルを消し、24時間ちょうどと24時間に1秒足りないもの、古くても紐付け済みのものを残す', async () => {
    const { store, eraser, erasure } = jobsOf([
      unattachedFile(1, shifted(UNATTACHED_BOUNDARY, -SECOND_MS)),
      unattachedFile(2, UNATTACHED_BOUNDARY),
      unattachedFile(3, shifted(UNATTACHED_BOUNDARY, SECOND_MS)),
      attachedFile(4),
    ]);

    await erasure.run(CONTEXT);

    expect(eraser.calls).toEqual([[fileIdOf(1)]]);
    expect(store.ids()).toEqual([fileIdOf(2), fileIdOf(3), fileIdOf(4)]);
  });

  test('保存が完了しなかった未紐付けの記録も、24時間を過ぎれば同じく消す', async () => {
    const { store, erasure } = jobsOf([
      attachedFile(1, {
        attached: false,
        stored: false,
        createdAt: shifted(UNATTACHED_BOUNDARY, -SECOND_MS),
      }),
    ]);

    await erasure.run(CONTEXT);

    expect(store.ids()).toEqual([]);
  });

  test('削除待ちのファイルは紐付け済みで作成されたばかりでも、日時によらず消す', async () => {
    const { store, eraser, erasure } = jobsOf([
      attachedFile(1, {
        eraseRequested: true,
        createdAt: shifted(SCHEDULED_TIME, -SECOND_MS),
      }),
      attachedFile(2),
    ]);

    await erasure.run(CONTEXT);

    expect(eraser.calls).toEqual([[fileIdOf(1)]]);
    expect(store.ids()).toEqual([fileIdOf(2)]);
  });

  test('候補が上限より多ければ先頭の1,000件だけを消し、件数と残りがあることをinfoのログに出す', async () => {
    const { store, eraser, erasure } = jobsOf(
      serials(1, 1001).map((serial) =>
        attachedFile(serial, { eraseRequested: true }),
      ),
    );

    await erasure.run(CONTEXT);

    expect(eraser.calls).toHaveLength(1);
    expect(eraser.calls[0]).toEqual(serials(1, 1000).map(fileIdOf));
    expect(store.ids()).toEqual([fileIdOf(1001)]);
    expect(logsOf(ERASURE_CATEGORY, 'info')).toEqual([
      { found: 1000, erased: 1000, hasMore: true },
    ]);
  });

  test('候補が上限ちょうどなら全てを消し、残りが無いことをログに出す', async () => {
    const { store, erasure } = jobsOf(
      serials(1, 1000).map((serial) =>
        attachedFile(serial, { eraseRequested: true }),
      ),
    );

    await erasure.run(CONTEXT);

    expect(store.ids()).toEqual([]);
    expect(logsOf(ERASURE_CATEGORY, 'info')).toEqual([
      { found: 1000, erased: 1000, hasMore: false },
    ]);
  });

  test('候補が無ければ物理削除を呼ばず、0件の要約を出す', async () => {
    const { eraser, erasure } = jobsOf([attachedFile(1)]);

    await erasure.run(CONTEXT);

    expect(eraser.calls).toEqual([]);
    expect(logsOf(ERASURE_CATEGORY, 'info')).toEqual([
      { found: 0, erased: 0, hasMore: false },
    ]);
  });

  test('物理削除が失敗すれば要約を出さずに例外を伝え、次の起動は前回の結果によらず同じ候補を消し直す', async () => {
    const failure = new Error('R2に到達できません');
    const { store, eraser, erasure } = jobsOf([
      attachedFile(1, { eraseRequested: true }),
      softDeletedFile(2, shifted(SOFT_DELETED_BOUNDARY, -SECOND_MS)),
    ]);
    eraser.failure = failure;

    const error = await failureOf(erasure.run(CONTEXT));

    expect(error).toBe(failure);
    expect(logsOf(ERASURE_CATEGORY, 'info')).toEqual([]);

    eraser.failure = undefined;
    await erasure.run(CONTEXT);

    expect(eraser.calls).toEqual([
      [fileIdOf(1), fileIdOf(2)],
      [fileIdOf(1), fileIdOf(2)],
    ]);
    expect(store.ids()).toEqual([]);
  });

  test('候補の照会が失敗すれば物理削除を呼ばずに例外を伝える', async () => {
    const failure = new Error('D1に到達できません');
    const { store, eraser, erasure } = jobsOf([
      attachedFile(1, { eraseRequested: true }),
    ]);
    store.failures.eraseCandidates = failure;

    const error = await failureOf(erasure.run(CONTEXT));

    expect(error).toBe(failure);
    expect(eraser.calls).toEqual([]);
  });

  test('同じ日に2回起動しても、2回目は消し終えた候補を見つけずに終わる', async () => {
    const { eraser, erasure } = jobsOf([
      attachedFile(1, { eraseRequested: true }),
    ]);

    await erasure.run(CONTEXT);
    await erasure.run(CONTEXT);

    expect(eraser.calls).toEqual([[fileIdOf(1)]]);
    expect(logsOf(ERASURE_CATEGORY, 'info')).toEqual([
      { found: 1, erased: 1, hasMore: false },
      { found: 0, erased: 0, hasMore: false },
    ]);
  });
});

describe('ModerationRequeueJob', () => {
  test('予定時刻の1時間前を境に、上限より1件多く再依頼の候補を照会する', async () => {
    const { store, requeue } = jobsOf([]);

    await requeue.run(CONTEXT);

    expect(store.moderationRequeueCalls).toEqual([
      { pendingCreatedBefore: PENDING_BOUNDARY, limit: 1001 },
    ]);
  });

  test('作成から1時間を1秒過ぎた判定待ちの画像の判定を依頼し直し、1時間ちょうどと1時間に1秒足りないものは依頼しない', async () => {
    const { publisher, requeue } = jobsOf([
      pendingImage(1, shifted(PENDING_BOUNDARY, -SECOND_MS)),
      pendingImage(2, PENDING_BOUNDARY),
      pendingImage(3, shifted(PENDING_BOUNDARY, SECOND_MS)),
    ]);

    await requeue.run(CONTEXT);

    expect(publisher.published).toEqual([
      { type: MODERATE_IMAGE_MESSAGE.type, body: { fileId: fileIdOf(1) } },
    ]);
  });

  test('未判定の画像は作成されたばかりでも依頼し直し、判定済み・論理削除・削除待ちの画像は依頼しない', async () => {
    const old = shifted(PENDING_BOUNDARY, -SECOND_MS);
    const { publisher, requeue } = jobsOf([
      pendingImage(1, shifted(SCHEDULED_TIME, -SECOND_MS), {
        moderationStatus: 'undetermined',
      }),
      pendingImage(2, old, { moderationStatus: 'passed' }),
      pendingImage(3, old, { deletedAt: old }),
      pendingImage(4, old, { eraseRequested: true }),
      pendingImage(5, old, {
        moderationStatus: 'undetermined',
        deletedAt: old,
      }),
    ]);

    await requeue.run(CONTEXT);

    expect(publisher.published).toEqual([
      { type: MODERATE_IMAGE_MESSAGE.type, body: { fileId: fileIdOf(1) } },
    ]);
  });

  test('候補が上限より多ければ先頭の1,000件だけを依頼し、件数と残りがあることをinfoのログに出す', async () => {
    const old = shifted(PENDING_BOUNDARY, -SECOND_MS);
    const { publisher, requeue } = jobsOf(
      serials(1, 1001).map((serial) => pendingImage(serial, old)),
    );

    await requeue.run(CONTEXT);

    expect(publisher.published.map(({ body }) => body)).toEqual(
      serials(1, 1000).map((serial) => ({ fileId: fileIdOf(serial) })),
    );
    expect(logsOf(REQUEUE_CATEGORY, 'info')).toEqual([
      { found: 1000, requested: 1000, failed: 0, hasMore: true },
    ]);
  });

  test('1件の送信が失敗しても残りの依頼を続け、失敗をerrorのログに出して最後に例外で伝える', async () => {
    const old = shifted(PENDING_BOUNDARY, -SECOND_MS);
    const failure = new Error('Queueに到達できません');
    const { publisher, requeue } = jobsOf(
      serials(1, 3).map((serial) => pendingImage(serial, old)),
    );
    publisher.failWhen = ({ body }) =>
      (body as { fileId: string }).fileId === fileIdOf(2) ? failure : undefined;

    const error = await failureOf(requeue.run(CONTEXT));

    expect(publisher.published.map(({ body }) => body)).toEqual([
      { fileId: fileIdOf(1) },
      { fileId: fileIdOf(3) },
    ]);
    expect(logsOf(REQUEUE_CATEGORY, 'error')).toEqual([
      { error: failure, fileId: fileIdOf(2) },
    ]);
    expect(logsOf(REQUEUE_CATEGORY, 'info')).toEqual([
      { found: 3, requested: 2, failed: 1, hasMore: false },
    ]);
    expect(error).toBeInstanceOf(MediaDailyJobError);
    expect((error as Error).cause).toBe(failure);
    expect((error as Error).message).toBe(
      '判定の再依頼で1件の送信に失敗しました',
    );
  });

  test('候補の照会が失敗すれば何も送らずに例外を伝える', async () => {
    const failure = new Error('D1に到達できません');
    const { store, publisher, requeue } = jobsOf([
      pendingImage(1, shifted(PENDING_BOUNDARY, -SECOND_MS)),
    ]);
    store.failures.moderationRequeue = failure;

    const error = await failureOf(requeue.run(CONTEXT));

    expect(error).toBe(failure);
    expect(publisher.attempts).toEqual([]);
  });

  test('同じ日に2回起動すると、判定の済んでいない画像を前回の送信によらず再び依頼する', async () => {
    const { publisher, requeue } = jobsOf([
      pendingImage(1, shifted(PENDING_BOUNDARY, -SECOND_MS)),
    ]);

    await requeue.run(CONTEXT);
    await requeue.run(CONTEXT);

    expect(publisher.published.map(({ body }) => body)).toEqual([
      { fileId: fileIdOf(1) },
      { fileId: fileIdOf(1) },
    ]);
  });
});

describe('LocationReconciliationJob', () => {
  test('上限より1件多く保存先の食い違いを照会する', async () => {
    const { store, reconciliation } = jobsOf([]);

    await reconciliation.run(CONTEXT);

    expect(store.locationMismatchLimits).toEqual([1001]);
  });

  test('理由があるのに画像用のバケットにある画像と、理由が無いのに隔離バケットにある画像の移動を依頼し、保存先の合う画像とファイル用の用途は依頼しない', async () => {
    const { publisher, reconciliation } = jobsOf([
      placedImage(1, 'images', ['auto']),
      placedImage(2, 'quarantine', []),
      placedImage(3, 'images', []),
      placedImage(4, 'quarantine', ['admin_action']),
      attachedFile(5),
    ]);

    await reconciliation.run(CONTEXT);

    expect(publisher.published).toEqual([
      {
        type: RELOCATE_FILES_MESSAGE.type,
        body: { fileIds: [fileIdOf(1), fileIdOf(2)] },
      },
    ]);
  });

  test('食い違いを25件ずつのメッセージに分けて依頼する', async () => {
    const { publisher, reconciliation } = jobsOf(
      serials(1, 51).map((serial) => placedImage(serial, 'quarantine', [])),
    );

    await reconciliation.run(CONTEXT);

    expect(publisher.published.map(({ body }) => body)).toEqual([
      { fileIds: serials(1, 25).map(fileIdOf) },
      { fileIds: serials(26, 25).map(fileIdOf) },
      { fileIds: [fileIdOf(51)] },
    ]);
    expect(logsOf(RECONCILIATION_CATEGORY, 'info')).toEqual([
      { found: 51, requested: 51, failed: 0, hasMore: false },
    ]);
  });

  test('食い違いが上限より多ければ先頭の1,000件を40通で依頼し、残りがあることをログに出す', async () => {
    const { publisher, reconciliation } = jobsOf(
      serials(1, 1001).map((serial) => placedImage(serial, 'images', ['auto'])),
    );

    await reconciliation.run(CONTEXT);

    expect(publisher.published).toHaveLength(40);
    expect(
      publisher.published.flatMap(
        ({ body }) => (body as { fileIds: string[] }).fileIds,
      ),
    ).toEqual(serials(1, 1000).map(fileIdOf));
    expect(logsOf(RECONCILIATION_CATEGORY, 'info')).toEqual([
      { found: 1000, requested: 1000, failed: 0, hasMore: true },
    ]);
  });

  test('1通の送信が失敗しても残りの依頼を続け、失敗をerrorのログに出して最後に例外で伝える', async () => {
    const failure = new Error('Queueに到達できません');
    const { publisher, reconciliation } = jobsOf(
      serials(1, 51).map((serial) => placedImage(serial, 'quarantine', [])),
    );
    publisher.failWhen = ({ body }) =>
      (body as { fileIds: string[] }).fileIds.includes(fileIdOf(26))
        ? failure
        : undefined;

    const error = await failureOf(reconciliation.run(CONTEXT));

    expect(publisher.published.map(({ body }) => body)).toEqual([
      { fileIds: serials(1, 25).map(fileIdOf) },
      { fileIds: [fileIdOf(51)] },
    ]);
    expect(logsOf(RECONCILIATION_CATEGORY, 'error')).toEqual([
      { error: failure, fileIds: serials(26, 25).map(fileIdOf) },
    ]);
    expect(logsOf(RECONCILIATION_CATEGORY, 'info')).toEqual([
      { found: 51, requested: 26, failed: 25, hasMore: false },
    ]);
    expect(error).toBeInstanceOf(MediaDailyJobError);
    expect((error as Error).cause).toBe(failure);
    expect((error as Error).message).toBe(
      '保存先の照合で25件の移動の依頼に失敗しました',
    );
  });

  test('照会が失敗すれば何も送らずに例外を伝える', async () => {
    const failure = new Error('D1に到達できません');
    const { store, publisher, reconciliation } = jobsOf([
      placedImage(1, 'quarantine', []),
    ]);
    store.failures.locationMismatches = failure;

    const error = await failureOf(reconciliation.run(CONTEXT));

    expect(error).toBe(failure);
    expect(publisher.attempts).toEqual([]);
  });

  test('同じ日に2回起動すると、まだ食い違う画像を前回の送信によらず再び依頼する', async () => {
    const { publisher, reconciliation } = jobsOf([
      placedImage(1, 'images', ['auto']),
    ]);

    await reconciliation.run(CONTEXT);
    await reconciliation.run(CONTEXT);

    expect(publisher.published.map(({ body }) => body)).toEqual([
      { fileIds: [fileIdOf(1)] },
      { fileIds: [fileIdOf(1)] },
    ]);
  });
});

describe('ジョブの独立性', () => {
  function mixedFiles(): MediaFileView[] {
    return [
      attachedFile(1, { eraseRequested: true }),
      pendingImage(2, shifted(PENDING_BOUNDARY, -SECOND_MS)),
      placedImage(3, 'quarantine', []),
    ];
  }

  test('物理削除のジョブが失敗しても、続く判定の再依頼と保存先の照合はそれぞれの対象を依頼する', async () => {
    const { eraser, publisher, erasure, requeue, reconciliation } =
      jobsOf(mixedFiles());
    eraser.failure = new Error('R2に到達できません');

    const errors = [
      await failureOf(erasure.run(CONTEXT)),
      await failureOf(requeue.run(CONTEXT)),
      await failureOf(reconciliation.run(CONTEXT)),
    ];

    expect(errors[0]).toBe(eraser.failure);
    expect(errors.slice(1)).toEqual([undefined, undefined]);
    expect(publisher.published).toEqual([
      { type: MODERATE_IMAGE_MESSAGE.type, body: { fileId: fileIdOf(2) } },
      { type: RELOCATE_FILES_MESSAGE.type, body: { fileIds: [fileIdOf(3)] } },
    ]);
  });

  test('判定の再依頼のジョブが失敗しても、前の物理削除の結果は変わらず、続く保存先の照合は依頼する', async () => {
    const { store, publisher, erasure, requeue, reconciliation } =
      jobsOf(mixedFiles());
    const failure = new Error('Queueに到達できません');
    publisher.failWhen = ({ type }) =>
      type === MODERATE_IMAGE_MESSAGE.type ? failure : undefined;

    const errors = [
      await failureOf(erasure.run(CONTEXT)),
      await failureOf(requeue.run(CONTEXT)),
      await failureOf(reconciliation.run(CONTEXT)),
    ];

    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeInstanceOf(MediaDailyJobError);
    expect(errors[2]).toBeUndefined();
    expect(store.ids()).toEqual([fileIdOf(2), fileIdOf(3)]);
    expect(publisher.published).toEqual([
      { type: RELOCATE_FILES_MESSAGE.type, body: { fileIds: [fileIdOf(3)] } },
    ]);
  });
});

describe('ジョブの束縛', () => {
  test('識別子に束縛すると、コンテナがストア・物理削除・送信の部品を注入した3つのジョブを返す', async () => {
    const { store, eraser, publisher } = jobsOf([
      attachedFile(1, { eraseRequested: true }),
      pendingImage(2, shifted(PENDING_BOUNDARY, -SECOND_MS)),
      placedImage(3, 'images', ['auto']),
    ]);
    const container = new Container({ defaultScope: 'Transient' });
    container
      .bind<MediaFileStore>(MEDIA_TYPES.MediaFileStore)
      .toConstantValue(store.asStore());
    container
      .bind<MediaEraser>(MEDIA_TYPES.MediaEraser)
      .toConstantValue(eraser);
    container
      .bind<MediaJobMessagePublisher>(PLATFORM_TYPES.MessagePublisher)
      .toConstantValue(publisher);
    container
      .bind<ScheduledJobHandler>(MEDIA_JOB_TYPES.ExpiredFileErasureJob)
      .to(ExpiredFileErasureJob);
    container
      .bind<ScheduledJobHandler>(MEDIA_JOB_TYPES.ModerationRequeueJob)
      .to(ModerationRequeueJob);
    container
      .bind<ScheduledJobHandler>(MEDIA_JOB_TYPES.LocationReconciliationJob)
      .to(LocationReconciliationJob);

    for (const identifier of [
      MEDIA_JOB_TYPES.ExpiredFileErasureJob,
      MEDIA_JOB_TYPES.ModerationRequeueJob,
      MEDIA_JOB_TYPES.LocationReconciliationJob,
    ]) {
      await container.get<ScheduledJobHandler>(identifier).run(CONTEXT);
    }

    expect(eraser.calls).toEqual([[fileIdOf(1)]]);
    expect(publisher.published.map(({ type }) => type)).toEqual([
      MODERATE_IMAGE_MESSAGE.type,
      RELOCATE_FILES_MESSAGE.type,
    ]);
  });

  test('3つの識別子は名前空間mediaの共有シンボルである', () => {
    expect<Readonly<Record<string, symbol>>>(MEDIA_JOB_TYPES).toEqual({
      ExpiredFileErasureJob: Symbol.for('media.ExpiredFileErasureJob'),
      ModerationRequeueJob: Symbol.for('media.ModerationRequeueJob'),
      LocationReconciliationJob: Symbol.for('media.LocationReconciliationJob'),
    });
  });
});

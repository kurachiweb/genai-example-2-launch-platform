import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createUlidGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { MediaLocation } from '../../../lib/core/media/media-file.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
} from '../../../lib/core/media/ports.ts';
import { MESSAGE_CONTRACTS } from '../../../lib/core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../../lib/core/messaging/envelope.ts';
import { systemClock } from '../../../lib/core/time/clock.ts';
import { R2MediaObjectStore } from '../../../lib/workers/media/r2-media-object-store.ts';
import {
  createStore,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
  readFile,
  T0,
} from '../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  clearMediaState,
  filePurposeRow,
  listObjectKeys,
  purgeMessagesOf,
  putObject,
} from '../../../lib/workers/media/testing/media-operations-fixtures.ts';
import { createRecordingQueue } from '../../../lib/workers/media/testing/upload-receiver-fixtures.ts';
import {
  createMessagePublisher,
  type MessagePublisher,
} from '../../../lib/workers/messaging/queue-publisher.ts';
import { MediaFileRelocator } from './file-relocator.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearMediaState();
});

type Step = 'exists' | 'get' | 'copy' | 'delete' | 'publish' | 'updateLocation';

interface Harness {
  readonly relocator: MediaFileRelocator;
  readonly sent: readonly QueueEnvelope[];
  readonly steps: readonly Step[];
}

class InjectedFailure extends Error {
  override readonly name = 'InjectedFailure';
}

// 移動の各段階の呼び出しの順序を記録し、指定した段階を1回目だけ失敗させる
function createHarness(failOn?: Step): Harness {
  const steps: Step[] = [];
  let failed = false;
  const record = (step: Step): void => {
    steps.push(step);
    if (step === failOn && !failed) {
      failed = true;
      throw new InjectedFailure(`${step}で失敗させる`);
    }
  };
  const recording = createRecordingQueue();
  const baseObjects = new R2MediaObjectStore(env);
  const baseFiles = createStore();
  const basePublisher = createMessagePublisher(
    recording.queue,
    MESSAGE_CONTRACTS,
    createUlidGenerator(systemClock),
    systemClock,
  );
  const objects: MediaObjectStore = {
    putIfAbsent: (...args) => baseObjects.putIfAbsent(...args),
    get: async (...args) => {
      const object = await baseObjects.get(...args);
      record('get');
      return object;
    },
    exists: async (...args) => {
      const present = await baseObjects.exists(...args);
      record('exists');
      return present;
    },
    delete: async (...args) => {
      await baseObjects.delete(...args);
      record('delete');
    },
    copy: async (...args) => {
      const result = await baseObjects.copy(...args);
      record('copy');
      return result;
    },
  };
  const files = withFileStoreOverrides(baseFiles, {
    updateLocation: async (...args) => {
      record('updateLocation');
      return baseFiles.updateLocation(...args);
    },
  });
  const publisher: MessagePublisher = {
    publish: async (contract, body, options) => {
      record('publish');
      return basePublisher.publish(contract, body, options);
    },
  };
  return {
    relocator: new MediaFileRelocator({ files, objects, publisher }),
    sent: recording.sent,
    steps,
  };
}

// ストアのメソッドはクラスのプロトタイプにあり展開では写らないため、差し替えたメソッド以外は元のストアへ委ねる
function withFileStoreOverrides(
  store: MediaFileStore,
  overrides: Partial<MediaFileStore>,
): MediaFileStore {
  return new Proxy(store, {
    get: (target, property, receiver) => {
      const override: unknown = Reflect.get(overrides, property);
      if (override !== undefined) {
        return override;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

async function readObjectText(
  location: MediaLocation,
  index: number,
): Promise<string | undefined> {
  const bucket = {
    images: env.IMAGES_BUCKET,
    files: env.FILES_BUCKET,
    quarantine: env.QUARANTINE_BUCKET,
  }[location];
  const object = await bucket.get(objectKeyOf(index));
  return object === null ? undefined : object.text();
}

async function locationOf(index: number): Promise<string | undefined> {
  return (await readFile(index))?.location;
}

async function snapshot(indexes: readonly number[]) {
  return Promise.all(
    indexes.map(async (index) => ({
      index,
      location: await locationOf(index),
      images: await readObjectText('images', index),
      quarantine: await readObjectText('quarantine', index),
      files: await readObjectText('files', index),
    })),
  );
}

async function arrangeQuarantineTarget(index: number): Promise<void> {
  await insertFile(index);
  await insertReason(index, 'auto');
  await putObject('images', index, `original-${String(index)}`);
}

async function arrangeRestoreTarget(index: number): Promise<void> {
  await insertFile(index, { location: 'quarantine' });
  await putObject('quarantine', index, `original-${String(index)}`);
}

describe('MediaFileRelocator.reconcile', () => {
  test('理由を持つ画像を画像用非公開バケットから隔離バケットへ移し、パージを依頼する', async () => {
    await arrangeQuarantineTarget(1);
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 1 });
    expect(await snapshot([1])).toEqual([
      {
        index: 1,
        location: 'quarantine',
        images: undefined,
        quarantine: 'original-1',
        files: undefined,
      },
    ]);
    expect(purgeMessagesOf(harness.sent)).toEqual([[objectKeyOf(1)]]);
  });

  test('パージの依頼を、元のバケットからの削除の後、保存先の記録の更新より前に送る', async () => {
    await arrangeQuarantineTarget(1);
    const harness = createHarness();

    await harness.relocator.reconcile([fileIdOf(1)]);

    expect(harness.steps).toEqual([
      'exists',
      'copy',
      'delete',
      'publish',
      'updateLocation',
    ]);
  });

  test('理由が無くなった画像を隔離バケットから画像用非公開バケットへ戻し、パージを依頼しない', async () => {
    await arrangeRestoreTarget(1);
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 1 });
    expect(await snapshot([1])).toEqual([
      {
        index: 1,
        location: 'images',
        images: 'original-1',
        quarantine: undefined,
        files: undefined,
      },
    ]);
    expect(harness.sent).toEqual([]);
  });

  test('目的の保存先に既にあれば元を読まずに写すのを省き、目的の側の内容を残して元を消す', async () => {
    await arrangeQuarantineTarget(1);
    await putObject('quarantine', 1, 'already-copied-1');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 1 });
    expect(harness.steps).not.toContain('copy');
    expect(harness.steps).not.toContain('get');
    expect(await snapshot([1])).toEqual([
      {
        index: 1,
        location: 'quarantine',
        images: undefined,
        quarantine: 'already-copied-1',
        files: undefined,
      },
    ]);
    expect(purgeMessagesOf(harness.sent)).toEqual([[objectKeyOf(1)]]);
  });

  test('元に無く目的の保存先にあれば、パージを依頼して記録の保存先を目的の値にする', async () => {
    await insertFile(1);
    await insertReason(1, 'auto');
    await putObject('quarantine', 1, 'original-1');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 1 });
    expect(await snapshot([1])).toEqual([
      {
        index: 1,
        location: 'quarantine',
        images: undefined,
        quarantine: 'original-1',
        files: undefined,
      },
    ]);
    expect(purgeMessagesOf(harness.sent)).toEqual([[objectKeyOf(1)]]);
  });

  test('元にも目的の保存先にも無ければ、記録の保存先だけを目的の値にしてパージを依頼しない', async () => {
    await insertFile(1);
    await insertReason(1, 'auto');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 1 });
    expect(await locationOf(1)).toBe('quarantine');
    expect(await listObjectKeys('images')).toEqual([]);
    expect(await listObjectKeys('quarantine')).toEqual([]);
    expect(harness.steps).not.toContain('delete');
    expect(harness.sent).toEqual([]);
  });

  test('削除待ちの画像は理由と保存先が食い違っていても動かさない', async () => {
    await insertFile(1, { eraseRequestedAt: T0 });
    await insertReason(1, 'auto');
    await putObject('images', 1, 'original-1');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 0 });
    expect(await snapshot([1])).toEqual([
      {
        index: 1,
        location: 'images',
        images: 'original-1',
        quarantine: undefined,
        files: undefined,
      },
    ]);
    expect(harness.steps).toEqual([]);
    expect(harness.sent).toEqual([]);
  });

  test('保存が完了していない画像は、受付の書き込みと食い違わないよう動かさない', async () => {
    await insertFile(1, { storedAt: null });
    await insertReason(1, 'user_suspended');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 0 });
    expect(await locationOf(1)).toBe('images');
    expect(harness.steps).toEqual([]);
  });

  test('目的の保存先と記録の保存先が同じファイル・ファイル用の用途・存在しない識別子では何もしない', async () => {
    await insertFile(1);
    await putObject('images', 1, 'original-1');
    await insertFile(2, { location: 'quarantine' });
    await insertReason(2, 'admin_action');
    await putObject('quarantine', 2, 'original-2');
    await insertFile(3, filePurposeRow());
    await putObject('files', 3, 'original-3');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([
      fileIdOf(1),
      fileIdOf(2),
      fileIdOf(3),
      fileIdOf(99),
    ]);

    expect(result).toEqual({ moved: 0 });
    expect(harness.steps).toEqual([]);
    expect(harness.sent).toEqual([]);
    expect(await snapshot([1, 2, 3])).toEqual([
      {
        index: 1,
        location: 'images',
        images: 'original-1',
        quarantine: undefined,
        files: undefined,
      },
      {
        index: 2,
        location: 'quarantine',
        images: undefined,
        quarantine: 'original-2',
        files: undefined,
      },
      {
        index: 3,
        location: 'files',
        images: undefined,
        quarantine: undefined,
        files: 'original-3',
      },
    ]);
  });

  test('論理削除済みの画像も目的の保存先へそろえる', async () => {
    await insertFile(1, { deletedAt: T0 });
    await insertReason(1, 'product_hidden');
    await putObject('images', 1, 'original-1');
    const harness = createHarness();

    const result = await harness.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 1 });
    expect(await locationOf(1)).toBe('quarantine');
  });

  test('複数の画像の隔離と復元をまとめて行い、画像用非公開バケットから出たものだけを1件のパージの依頼にまとめる', async () => {
    await arrangeQuarantineTarget(1);
    await arrangeQuarantineTarget(2);
    await arrangeRestoreTarget(3);
    const harness = createHarness();

    const result = await harness.relocator.reconcile([
      fileIdOf(1),
      fileIdOf(2),
      fileIdOf(3),
    ]);

    expect(result).toEqual({ moved: 3 });
    expect(
      purgeMessagesOf(harness.sent).map((keys) => keys.toSorted()),
    ).toEqual([[objectKeyOf(1), objectKeyOf(2)]]);
    expect((await snapshot([1, 2, 3])).map((each) => each.location)).toEqual([
      'quarantine',
      'quarantine',
      'images',
    ]);
  });

  test('同じ識別子を重複して渡しても1回だけ移す', async () => {
    await arrangeQuarantineTarget(1);
    const harness = createHarness();

    const result = await harness.relocator.reconcile([
      fileIdOf(1),
      fileIdOf(1),
    ]);

    expect(result).toEqual({ moved: 1 });
    expect(purgeMessagesOf(harness.sent)).toEqual([[objectKeyOf(1)]]);
  });

  test('重複して配信されても2回目は何もせず、結果が変わらない', async () => {
    await arrangeQuarantineTarget(1);
    await createHarness().relocator.reconcile([fileIdOf(1)]);
    const before = await snapshot([1]);
    const second = createHarness();

    const result = await second.relocator.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 0 });
    expect(second.sent).toEqual([]);
    expect(await snapshot([1])).toEqual(before);
  });

  test.each<[string, Step]>([
    ['コピーの後(元の削除)', 'delete'],
    ['元の削除の後(パージの依頼の送信)', 'publish'],
    ['パージの依頼の送信の後(記録の更新)', 'updateLocation'],
  ])(
    '隔離の移動を%sで失敗させても、再実行で途中で止めなかった場合と同じ結果になる',
    async (_label, failOn) => {
      await arrangeQuarantineTarget(1);
      await arrangeQuarantineTarget(2);
      const interrupted = createHarness(failOn);

      await expect(
        interrupted.relocator.reconcile([fileIdOf(1), fileIdOf(2)]),
      ).rejects.toThrow(InjectedFailure);
      const retried = createHarness();
      const result = await retried.relocator.reconcile([
        fileIdOf(1),
        fileIdOf(2),
      ]);

      expect(result).toEqual({ moved: 2 });
      expect(await snapshot([1, 2])).toEqual([
        {
          index: 1,
          location: 'quarantine',
          images: undefined,
          quarantine: 'original-1',
          files: undefined,
        },
        {
          index: 2,
          location: 'quarantine',
          images: undefined,
          quarantine: 'original-2',
          files: undefined,
        },
      ]);
      expect(
        purgeMessagesOf(retried.sent).map((keys) => keys.toSorted()),
      ).toEqual([[objectKeyOf(1), objectKeyOf(2)]]);
    },
  );

  test.each<[string, Step]>([
    ['コピーの後(元の削除)', 'delete'],
    ['記録の更新', 'updateLocation'],
  ])(
    '復元の移動を%sで失敗させても、再実行で画像用非公開バケットへ戻る',
    async (_label, failOn) => {
      await arrangeRestoreTarget(1);
      const interrupted = createHarness(failOn);

      await expect(
        interrupted.relocator.reconcile([fileIdOf(1)]),
      ).rejects.toThrow(InjectedFailure);
      const retried = createHarness();
      const result = await retried.relocator.reconcile([fileIdOf(1)]);

      expect(result).toEqual({ moved: 1 });
      expect(await snapshot([1])).toEqual([
        {
          index: 1,
          location: 'images',
          images: 'original-1',
          quarantine: undefined,
          files: undefined,
        },
      ]);
      expect(retried.sent).toEqual([]);
    },
  );

  test('移動の途中で記録の保存先が変わっていれば記録を上書きせず、移した件数に数えない', async () => {
    await arrangeQuarantineTarget(1);
    const files = createStore();
    const racing = new MediaFileRelocator({
      files: withFileStoreOverrides(files, {
        updateLocation: async (id, from, to) => {
          await files.updateLocation(id, 'images', 'files');
          return files.updateLocation(id, from, to);
        },
      }),
      objects: new R2MediaObjectStore(env),
      publisher: createMessagePublisher(
        createRecordingQueue().queue,
        MESSAGE_CONTRACTS,
        createUlidGenerator(systemClock),
        systemClock,
      ),
    });

    const result = await racing.reconcile([fileIdOf(1)]);

    expect(result).toEqual({ moved: 0 });
    expect(await locationOf(1)).toBe('files');
  });
});
